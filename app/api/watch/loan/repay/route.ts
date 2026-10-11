// The watch loan's repayment into the lender's account (the user's signed payment, or the
// demo wallet's), then the watch's release (simulated).
import { runWatchLoanRepay } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(request, (deps, body) => runWatchLoanRepay(deps, { token: body.token, signed: body.signed }), { showErrors: true });
}
