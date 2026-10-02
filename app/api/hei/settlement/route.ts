// Settles an HEI on devnet after a simulated number of years and appraisal: the
// homeowner pays into the HEI's settlement account (the user's wallet-signed payment,
// or the demo wallet), then each holder is paid its share and its shares are burned.
import { runHeiSettlement } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(request, (deps, body) => runHeiSettlement(deps, { token: body.token, scenario: body.scenario, signed: body.signed }), {
    showErrors: true,
  });
}
