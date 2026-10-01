// Talk to the agent in the terminal (milestone M3: goal intake only).
// Usage: npm run agent:chat                               interactive; type "exit" to stop
//        npm run agent:chat -- "first message" "second"     replays the given messages
// Needs GEMINI_API_KEY in .env.local (optional GEMINI_MODEL). The key is on the
// paid tier; still use made-up personas when recording demos.

import { createInterface } from "node:readline/promises";
import { createGeminiClient, DEFAULT_GEMINI_MODEL } from "../lib/agent/gemini";
import { createCaseFile, resolveApproval, sendUserMessage, type AgentDeps, type TurnResult } from "../lib/agent/orchestrator";
import { AGENT_TOOLS } from "../lib/agent/tools";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set. Add it to .env.local (see .env.example).");
    process.exit(1);
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const deps: AgentDeps = { llm: createGeminiClient({ apiKey, model }), tools: AGENT_TOOLS };
  console.log(`Model: ${model}. Development chat: use made-up personas for demos.\n`);

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

    let turn: TurnResult = await sendUserMessage(caseFile, text, deps);
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
