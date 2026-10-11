// With the user's own wallet as the borrower: builds the repayment for the wallet to sign.
import { prepareWatchLoanRepayment } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(request, (deps, body) => prepareWatchLoanRepayment(deps, { token: body.token }), { showErrors: true });
}
