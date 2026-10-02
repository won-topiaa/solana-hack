// Ties the user's own wallet (for example Phantom) to the case: "challenge" returns the
// message to sign, "connect" checks the wallet's signature over it, "disconnect" goes
// back to the demo wallet. Only possible before anything is on-chain.
import { BadRequest, walletChallenge, walletConnect, walletDisconnect } from "@/lib/web/handlers";
import { handle } from "@/lib/web/server";

export async function POST(request: Request) {
  return handle(request, (deps, body) => {
    switch (body.action) {
      case "challenge":
        return walletChallenge(deps, { token: body.token, address: body.address });
      case "connect":
        return walletConnect(deps, { token: body.token, signature: body.signature });
      case "disconnect":
        return walletDisconnect(deps, { token: body.token });
      default:
        throw new BadRequest("action must be challenge, connect or disconnect");
    }
  });
}
