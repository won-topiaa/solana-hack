// With the user's own wallet as the homeowner: prepares the settlement payment for the
// wallet to sign (the simulated money it is missing is minted to it first, on devnet).
import { prepareHeiSettlement } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(request, (deps, body) => prepareHeiSettlement(deps, { token: body.token, scenario: body.scenario }), { showErrors: true });
}
