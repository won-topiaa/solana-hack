// Talk to the agent in the terminal: goal, assets, comparison and prepared documents.
// Usage: npm run agent:chat                               interactive; type "exit" to stop
//        npm run agent:chat -- "first message" "second"     replays the given messages
// Needs GEMINI_API_KEY in .env.local (optional GEMINI_MODEL). The key is on the
// paid tier; still use made-up personas when recording demos.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { createCaseFile, resolveApproval, sendUserMessage, type TurnResult } from "../lib/agent/orchestrator";
import { addPhoto, mimeTypeFromFileName } from "../lib/agent/photos";
import { createAgentServices } from "../lib/agent/services";

async function main() {
  let services;
  try {
    services = await createAgentServices();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const deps = services.agent;
  const { model, propertyData, plaid } = services.info;
  console.log(`Model: ${model}. Property data: ${propertyData === "rentcast" ? "RentCast (cached in .cache/rentcast)" : "demo data (data/demo/properties.json)"}.`);
  console.log(`Mortgage: typed by the user${plaid ? ", or Plaid sandbox (test data) after approval" : ""}.`);
  console.log("Watch photos: type /photo followed by a file path (PNG, JPEG, WEBP, HEIC).");
  console.log("On-chain steps: Solana devnet only, each after your approval.");
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
