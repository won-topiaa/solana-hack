// Shared by the devnet scripts: calls the agent's tools in order, the way the agent
// does after the user approved each step, and prints what each tool shows the user.

import type { AgentTool } from "../lib/agent/tools";
import type { CaseFile } from "../lib/agent/types";

export function createStepRunner(tools: AgentTool[], today: string, now: Date) {
  return async (caseFile: CaseFile, name: string, args: Record<string, unknown> = {}): Promise<CaseFile> => {
    const tool = tools.find((item) => item.declaration.name === name);
    if (!tool) throw new Error(`No tool ${name}`);
    const outcome = await tool.run(args, { caseFile, today, now });
    const output = outcome.output as { display?: string; problem?: string; problems?: string[] };
    console.log(`\n[${name}]\n${output.display ?? output.problem ?? output.problems?.join(" ") ?? JSON.stringify(output)}`);
    if (output.problem || output.problems) throw new Error(`${name} stopped`);
    return outcome.caseFile;
  };
}
