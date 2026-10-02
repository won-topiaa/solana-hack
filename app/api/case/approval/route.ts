// The user's yes or no to the action waiting for approval (an on-chain step, a bank
// connection, a registry check). After a yes the action runs, which may take a while.
import { postApproval } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(request, (deps, body) => postApproval(deps, { token: body.token, approvalId: body.approvalId, approved: body.approved }));
}
