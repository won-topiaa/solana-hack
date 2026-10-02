// The user's message (and optional photo) to the agent. A turn may call the model
// several times and, after an approval, wait for devnet, so it may run for minutes.
import { postMessage } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(request, (deps, body) => postMessage(deps, { token: body.token, text: body.text, photo: body.photo }));
}
