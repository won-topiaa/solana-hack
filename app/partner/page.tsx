// The partner and investor page (milestone M9): closing, primary sale and settlement
// of an issued HEI, on Solana devnet with a simulated partner.
import type { Metadata } from "next";
import { AppFooter, AppHeader } from "@/components/AppHeader";
import { PartnerConsole } from "@/components/PartnerConsole";

export const metadata: Metadata = { title: "Partner & investors · Ownflow" };

export default function PartnerPage() {
  return (
    <>
      <AppHeader />
      <main className="flex-1">
        <PartnerConsole />
      </main>
      <AppFooter />
    </>
  );
}
