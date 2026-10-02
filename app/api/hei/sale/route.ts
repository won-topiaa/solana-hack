// Partner steps for an issued HEI on devnet (simulated partner): KYC, the payment to
// the homeowner at closing, and the primary sale. About ten transactions.
import { runHeiSale } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(request, (deps, body) => runHeiSale(deps, { token: body.token }), { showErrors: true });
}
