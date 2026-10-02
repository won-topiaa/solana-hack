// The transaction the user's wallet signs to approve the pending step. Nothing is sent
// here; the signed transaction comes back with the approval. May send the wallet a
// little devnet SOL for the fee first.
import { prepareApprovalSignature } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handle(request, (deps, body) => prepareApprovalSignature(deps, { token: body.token, approvalId: body.approvalId }), { showErrors: true });
}
