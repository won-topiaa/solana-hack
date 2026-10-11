// Lender steps for a watch loan on devnet (simulated lender): intake and authentication
// (simulated), then the loan payment to the borrower. One transaction.
import { runWatchLoanOpen } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(request, (deps, body) => runWatchLoanOpen(deps, { token: body.token }), { showErrors: true });
}
