// Seals the private watch price table (data/private/watch-quotes.json, git-ignored) into
// data/watch-prices.sealed.json: one copy for this machine's CASE_SECRET (.env.local) and
// one for the deployment's (.wallets/vercel.env), so both servers can open it and nobody
// else can read it. Run after changing the private data: npm run prices:seal

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { checkWatchTable, openWatchTable, sealWatchTable } from "../lib/assets/privateWatchPrices";

const SOURCE = "data/private/watch-quotes.json";
const TARGET = "data/watch-prices.sealed.json";
const DEPLOY_ENV = ".wallets/vercel.env";

/** CASE_SECRET from a KEY=value file, without printing it. */
function secretIn(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split("\n").find((item) => item.startsWith("CASE_SECRET="));
  return line?.slice("CASE_SECRET=".length).trim().replace(/^"|"$/g, "") || undefined;
}

const table = checkWatchTable(JSON.parse(readFileSync(SOURCE, "utf8")));
const secrets = [...new Set([process.env.CASE_SECRET, secretIn(DEPLOY_ENV)].filter((secret): secret is string => Boolean(secret)))];
if (secrets.length === 0) throw new Error("No CASE_SECRET in .env.local or .wallets/vercel.env");

const copies = secrets.map((secret) => sealWatchTable(table, secret));
// Each server must open its own copy before the file is written.
for (const secret of secrets) {
  if (openWatchTable(copies, secret)?.watches.length !== table.watches.length) throw new Error("A sealed copy did not open again");
}
const note = "Sealed private watch price table (AES-256-GCM, one copy per server secret). Made by scripts/seal-watch-prices.ts from a file that is never committed.";
writeFileSync(TARGET, `${JSON.stringify({ note, copies }, null, 2)}\n`);
console.log(`Sealed ${table.watches.length} watches into ${TARGET} for ${secrets.length} server secret(s).`);
