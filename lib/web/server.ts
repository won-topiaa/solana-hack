// Server side of the web app: the services (built once per server process) and the
// JSON answer of every API route. Only the route handlers in app/api import this.
// CASE_SECRET seals the case tokens; the other settings are in lib/agent/services.ts.

import "server-only";
import { createAgentServices } from "../agent/services";
import { describeChainError } from "../chain/solana";
import { BadRequest, type CaseReply, type WebDeps } from "./handlers";

let services: Promise<WebDeps> | null = null;

async function build(): Promise<WebDeps> {
  const secret = process.env.CASE_SECRET;
  if (!secret) throw new Error("CASE_SECRET is not set. Set a long random value in .env.local, or in the hosting's environment variables (see .env.example).");
  const built = await createAgentServices();
  // The web app shows tool results in its panel, so the agent keeps its replies short.
  return { agent: { ...built.agent, channel: "web" }, registry: built.registry, secret, hei: built.hei };
}

export function webDeps(): Promise<WebDeps> {
  // A failed start is not kept, so fixing .env.local and retrying works without a restart.
  services ??= build().catch((error: unknown) => {
    services = null;
    throw error;
  });
  return services;
}

type Action = (deps: WebDeps, body: Record<string, unknown>) => CaseReply | Promise<CaseReply>;

/**
 * Runs one action for a JSON request. A BadRequest answers 400 with its message.
 * Other errors answer 500; `showErrors` passes their message on (devnet steps,
 * whose messages carry only transaction ids and addresses), otherwise a plain sentence.
 */
export async function handle(request: Request, action: Action, options: { showErrors?: boolean } = {}): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The request body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "The request body must be a JSON object" }, { status: 400 });
  let deps: WebDeps;
  try {
    deps = await webDeps();
  } catch (error) {
    // A setup problem (a missing or malformed setting). These messages name the setting,
    // never its value, so the deployer can see what to fix.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[api setup] ${message}`);
    return Response.json({ error: `The server is not set up: ${message}` }, { status: 503 });
  }
  try {
    return Response.json(await action(deps, body as Record<string, unknown>));
  } catch (error) {
    if (error instanceof BadRequest) return Response.json({ error: error.message }, { status: 400 });
    const message = describeChainError(error);
    // Our own error messages carry no case contents, so the message alone is logged.
    console.error(`[api ${new URL(request.url).pathname}] ${message}`);
    return Response.json({ error: options.showErrors ? message : "Something went wrong on the server. Please try again." }, { status: 500 });
  }
}
