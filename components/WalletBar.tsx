"use client";

// Connects the user's own wallet to the case: the wallet signs a short message that names
// the case and the address (no money moves), and the server checks it. From then on the
// user's wallet signs the receipt, receives the watch token or the closing payment, and
// signs the HEI settlement payment. Without it the server's demo wallet stands in.

import type { WalletState } from "@solana/kit-plugin-wallet";
import { useConnectedWallet, useIsWalletReady, useWallets } from "@solana/kit-plugin-wallet/react";
import { Wallet } from "lucide-react";
import { useState } from "react";
import type { CaseView } from "@/lib/web/view";
import { callApi, postJson, storeCase, type CaseReplyJson } from "./caseStore";
import { shortAddress, signTextWithWallet, walletClient } from "./wallet";

const TESTNET_MODE_HELP = "https://docs.phantom.com/developer-powertools/testnet-mode";

type UiWallet = WalletState["wallets"][number];

type Props = { token: string; view: CaseView; busy: boolean; onError: (message: string | null) => void };

export function WalletBar({ token, view, busy, onError }: Props) {
  const ready = useIsWalletReady(walletClient);
  const wallets = useWallets(walletClient);
  const connected = useConnectedWallet(walletClient);
  const [working, setWorking] = useState<string | null>(null);
  const disabled = busy || Boolean(working);

  async function connect(wallet: UiWallet) {
    onError(null);
    setWorking("Connecting…");
    try {
      await walletClient.wallet.connect(wallet);
      const address = walletClient.wallet.getState().connected?.account.address;
      if (!address) throw new Error("The wallet did not share an account");
      const challenge = await postJson<CaseReplyJson & { message: string }>("/api/case/wallet", { action: "challenge", token, address });
      setWorking("Sign the message in your wallet (no money moves)…");
      const signature = await signTextWithWallet(challenge.message);
      storeCase(await callApi("/api/case/wallet", { action: "connect", token: challenge.token, signature }));
    } catch (error) {
      if ((error as Error).name !== "AbortError") onError(error instanceof Error ? error.message : "The wallet could not be connected");
    } finally {
      setWorking(null);
    }
  }

  /** The case already names this wallet; the app just needs the wallet app connected to sign. */
  async function reconnect(wallet: UiWallet) {
    onError(null);
    setWorking("Connecting…");
    try {
      await walletClient.wallet.connect(wallet);
    } catch (error) {
      if ((error as Error).name !== "AbortError") onError(error instanceof Error ? error.message : "The wallet could not be connected");
    } finally {
      setWorking(null);
    }
  }

  async function switchToDemoWallet() {
    onError(null);
    setWorking("Switching…");
    try {
      storeCase(await callApi("/api/case/wallet", { action: "disconnect", token }));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not switch wallets");
    } finally {
      setWorking(null);
    }
  }

  if (view.wallet) {
    const otherAccount = connected && connected.account.address !== view.wallet.address;
    const needsConnect = ready && !working && (!connected || otherAccount);
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-violet-200">
          <Wallet size={13} />
          Your wallet {shortAddress(view.wallet.address)}
        </span>
        {otherAccount && <span className="text-amber-300">Your wallet app is on another account: switch to {shortAddress(view.wallet.address)}</span>}
        {working && <span className="animate-pulse text-neutral-400">{working}</span>}
        {needsConnect &&
          wallets.map((wallet) => (
            <button
              key={wallet.name}
              type="button"
              disabled={disabled}
              onClick={() => void reconnect(wallet)}
              className="rounded-full border border-neutral-700 px-2.5 py-1 text-neutral-200 transition hover:border-neutral-500 hover:text-white disabled:opacity-50"
            >
              Reconnect {wallet.name}
            </button>
          ))}
        {!view.wallet.locked && (
          <button type="button" disabled={disabled} onClick={() => void switchToDemoWallet()} className="text-neutral-400 transition hover:text-white disabled:opacity-50">
            Use the demo wallet
          </button>
        )}
      </div>
    );
  }

  const locked = view.onchain.length > 0;
  if (locked) return <span className="text-xs text-neutral-500">Demo wallet (the on-chain records name it)</span>;
  if (!ready) return null;
  if (working) return <span className="animate-pulse text-xs text-neutral-400">{working}</span>;
  if (wallets.length === 0) {
    return (
      <span className="text-xs text-neutral-500">
        Demo wallet signs for you. To use your own:{" "}
        <a href={TESTNET_MODE_HELP} target="_blank" rel="noreferrer" className="underline decoration-neutral-600 underline-offset-2 hover:text-white">
          turn on Testnet Mode in Phantom
        </a>{" "}
        and reload.
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-neutral-500">Demo wallet signs for you, or</span>
      {wallets.map((wallet) => (
        <button
          key={wallet.name}
          type="button"
          disabled={disabled}
          onClick={() => void connect(wallet)}
          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-700 px-2.5 py-1 text-neutral-200 transition hover:border-neutral-500 hover:text-white disabled:opacity-50"
        >
          <Wallet size={13} />
          Connect {wallet.name} (devnet)
        </button>
      ))}
    </div>
  );
}
