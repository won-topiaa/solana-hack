// Settles an HEI on devnet after a simulated number of years and appraisal: the
// homeowner pays each holder its share and the issuer burns that holder's shares.
import { runHeiSettlement } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(request, (deps, body) => runHeiSettlement(deps, { token: body.token, years: body.years, growth: body.growth }), { showErrors: true });
}
