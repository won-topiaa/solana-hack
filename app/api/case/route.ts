// Starts a case: empty, or a made-up demo persona with its goal and assets loaded.
import { startCase } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export async function POST(request: Request) {
  return handle(request, (deps, body) => startCase(deps, { persona: body.persona }));
}
