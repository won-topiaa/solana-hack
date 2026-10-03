// The agent's real services, built from the environment. Shared by the terminal chat
// (scripts/agent-chat.ts) and the web app (lib/web/server.ts), so both talk to the
// same model, data sources and devnet wallets.
//   GEMINI_API_KEY (required), GEMINI_MODEL; RENTCAST_API_KEY, PROPERTY_DATA_SOURCE=demo;
//   PLAID_CLIENT_ID + PLAID_SECRET (sandbox), PLAID_IDV_TEMPLATE_ID (investor KYC in Plaid's sandbox);
//   SOLANA_RPC_URL; REGISTRY_FROZEN_ON (judging period).
//   Devnet wallets: .wallets/devnet.

import type { ChainService } from "../chain/adapter";
import { createDevnetChain } from "../chain/devnet";
import type { HeiWallets } from "../chain/heiLifecycle";
import { createDevnetRpc, type DevnetRpc } from "../chain/solana";
import { loadOrCreateWallet } from "../chain/wallets";
import { createPlaidIdentitySandbox, simulatedIdentity, type IdentityVerifier } from "../integrations/identity";
import { createPlaidSandboxSource } from "../integrations/plaid";
import { createDemoPropertySource, createMemoryStore, createRentcastSource, withCache } from "../integrations/rentcast";
import { createFileStore } from "../integrations/rentcastCache";
import { createGeminiVision } from "../integrations/vision";
import { todayInNewYork } from "../params/dates";
import { freezeRegistry, getRegistry } from "../params/load";
import type { Registry } from "../params/types";
import { createGeminiClient, DEFAULT_GEMINI_MODEL } from "./gemini";
import type { AgentDeps } from "./orchestrator";
import { createAgentTools } from "./tools";

type AgentServices = {
  agent: AgentDeps;
  registry: Registry;
  chain: ChainService;
  hei: { rpc: DevnetRpc; wallets: HeiWallets; identity: IdentityVerifier };
  info: { model: string; propertyData: "rentcast" | "demo"; plaid: boolean; kyc: string };
};

type Env = Record<string, string | undefined>;

export async function createAgentServices(env: Env = process.env): Promise<AgentServices> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Set it in .env.local, or in the hosting's environment variables (see .env.example).");
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  // Real RentCast data when a key is set, unless PROPERTY_DATA_SOURCE=demo (for demo recordings).
  const rentcastKey = env.RENTCAST_API_KEY;
  const useRentcast = Boolean(rentcastKey) && env.PROPERTY_DATA_SOURCE !== "demo";
  const propertySource = useRentcast
    ? withCache(createRentcastSource(rentcastKey as string), env.VERCEL ? createMemoryStore() : createFileStore()) // Vercel's disk is read-only
    : withCache(createDemoPropertySource(), createMemoryStore());
  // Plaid (sandbox test data) is offered only when both Plaid values are set.
  const { PLAID_CLIENT_ID: clientId, PLAID_SECRET: secret } = env;
  const mortgageSource = clientId && secret ? createPlaidSandboxSource({ clientId, secret }) : undefined;
  // Investor KYC: Plaid Identity Verification (sandbox) when its template is set, else a labeled simulated check.
  const templateId = env.PLAID_IDV_TEMPLATE_ID;
  const identity = clientId && secret && templateId ? createPlaidIdentitySandbox({ clientId, secret, templateId }) : simulatedIdentity;

  // Devnet only: the issuer plays the partners; the user wallet is the homeowner or watch owner.
  const rpc = createDevnetRpc(env.SOLANA_RPC_URL || undefined);
  const [issuer, user, investor1, investor2, noKyc] = await Promise.all(
    ["issuer", "user", "investor-kyc", "investor-kyc-2", "investor-no-kyc"].map((name) => loadOrCreateWallet(name)),
  );
  // A deployment for the judging period freezes the values on one date (REGISTRY_FROZEN_ON).
  const registry = env.REGISTRY_FROZEN_ON ? freezeRegistry(getRegistry(), env.REGISTRY_FROZEN_ON, todayInNewYork()) : getRegistry();
  const chain = createDevnetChain(rpc, { issuer, user });
  return {
    agent: {
      llm: createGeminiClient({ apiKey, model }),
      tools: createAgentTools({
        registry,
        propertySource,
        mortgageSource,
        vision: createGeminiVision({ apiKey, model }),
        chain,
      }),
    },
    registry,
    chain,
    hei: {
      rpc,
      wallets: {
        issuer,
        homeowner: user,
        investors: [
          { name: "Investor 1", wallet: investor1 },
          { name: "Investor 2", wallet: investor2 },
        ],
        noKyc,
      },
      identity,
    },
    info: { model, propertyData: useRentcast ? "rentcast" : "demo", plaid: Boolean(mortgageSource), kyc: identity.label },
  };
}
