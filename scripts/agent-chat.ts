// Talk to the agent in the terminal: goal, assets, comparison and prepared documents.
// Usage: npm run agent:chat                               interactive; type "exit" to stop
//        npm run agent:chat -- "first message" "second"     replays the given messages
// Needs GEMINI_API_KEY in .env.local (optional GEMINI_MODEL). The key is on the
// paid tier; still use made-up personas when recording demos.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { createGeminiClient, DEFAULT_GEMINI_MODEL } from "../lib/agent/gemini";
import { createCaseFile, resolveApproval, sendUserMessage, type AgentDeps, type TurnResult } from "../lib/agent/orchestrator";
import { addPhoto, mimeTypeFromFileName } from "../lib/agent/photos";
import { createAgentTools } from "../lib/agent/tools";
import { createGeminiVision } from "../lib/integrations/vision";
import { getRegistry } from "../lib/params/load";
import { createDemoPropertySource, createMemoryStore, createRentcastSource, withCache } from "../lib/integrations/rentcast";
import { createFileStore } from "../lib/integrations/rentcastCache";
import { createPlaidSandboxSource } from "../lib/integrations/plaid";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set. Add it to .env.local (see .env.example).");
    process.exit(1);
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  // Real RentCast data when a key is set, unless PROPERTY_DATA_SOURCE=demo (for demo recordings).
  const rentcastKey = process.env.RENTCAST_API_KEY;
  const useRentcast = Boolean(rentcastKey) && process.env.PROPERTY_DATA_SOURCE !== "demo";
  const propertySource = useRentcast
    ? withCache(createRentcastSource(rentcastKey as string), createFileStore())
    : withCache(createDemoPropertySource(), createMemoryStore());
  // Plaid (sandbox test data) is offered only when both Plaid values are set.
  const { PLAID_CLIENT_ID: clientId, PLAID_SECRET: secret } = process.env;
  const mortgageSource = clientId && secret ? createPlaidSandboxSource({ clientId, secret }) : undefined;
  const deps: AgentDeps = {
    llm: createGeminiClient({ apiKey, model }),
    tools: createAgentTools({
      registry: getRegistry(),
      propertySource,
      mortgageSource,
      vision: createGeminiVision({ apiKey, model }),
    }),
  };
  console.log(`Model: ${model}. Property data: ${useRentcast ? "RentCast (cached in .cache/rentcast)" : "demo data (data/demo/properties.json)"}.`);
  console.log(`Mortgage: typed by the user${mortgageSource ? ", or Plaid sandbox (test data) after approval" : ""}.`);
  console.log("Watch photos: type /photo followed by a file path (PNG, JPEG, WEBP, HEIC).");
  console.log("Development chat: use made-up personas for demos.\n");

  const scripted = process.argv.slice(2);
  const terminal = scripted.length === 0 ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const nextMessage = async (): Promise<string | undefined> => {
    if (!terminal) {
      const text = scripted.shift();
      if (text !== undefined) console.log(`you> ${text}`);
      return text;
    }
    return terminal.question("you> ");
  };

  let caseFile = createCaseFile(`cli-${Date.now()}`);
  for (;;) {
    const text = await nextMessage();
    if (text === undefined || text.trim() === "exit") break;
    if (text.trim() === "") continue;

    let message = text;
    if (text.startsWith("/photo ")) {
      // The photo stays in the case file; the model is only told its id.
      const path = text.slice("/photo ".length).trim();
      try {
        const added = addPhoto(caseFile, { mimeType: mimeTypeFromFileName(path), bytes: readFileSync(path) });
        caseFile = added.caseFile;
        console.log(`[${added.photoId} added: ${basename(path)}]`);
        message = `I uploaded a photo (${added.photoId}).`;
      } catch (error) {
        console.log(`[photo not added: ${error instanceof Error ? error.message : String(error)}]`);
        continue;
      }
    }

    let turn: TurnResult = await sendUserMessage(caseFile, message, deps);
    while (turn.awaitingApproval) {
      console.log(`agent> ${turn.reply}`);
      // A replayed run never approves anything on its own.
      const answer = terminal ? await terminal.question(`Approve "${turn.awaitingApproval.summary}"? (y/n) `) : "n";
      turn = await resolveApproval(turn.caseFile, turn.awaitingApproval.id, answer.trim() === "y", deps);
    }
    const hadGoal = caseFile.goal !== undefined;
    caseFile = turn.caseFile;
    console.log(`agent> ${turn.reply}\n`);
    if (!hadGoal && caseFile.goal) console.log(`[goal recorded]\n${JSON.stringify(caseFile.goal, null, 2)}\n`);
  }

  terminal?.close();
  console.log(caseFile.goal ? "Final goal recorded." : "No goal recorded yet.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
