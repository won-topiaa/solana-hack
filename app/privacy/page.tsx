// What the demo does with the data people give it. Linked from the footer, and named as
// the privacy policy in the Plaid Identity Verification template (Plaid asks for one).
import type { Metadata } from "next";
import { AppFooter, AppHeader } from "@/components/AppHeader";
import { Frame } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy · Ownflow" };

const SECTIONS: { title: string; text: string[] }[] = [
  {
    title: "A demo, so use made-up details",
    text: [
      "Ownflow is a hackathon demo on Solana devnet. Tokens and test dollars have no value, and the partners are simulated. Please do not enter your real name, address, serial numbers or documents.",
    ],
  },
  {
    title: "Your case stays in your browser",
    text: [
      "The server keeps no case. Each answer carries the case back to your browser sealed with AES-256-GCM, and your browser sends it with the next request; the browser can neither read nor change it. Closing the tab or choosing Start over ends the case.",
      "Server logs record errors without the contents of a case. The hosting's firewall counts requests per IP address to limit abuse.",
    ],
  },
  {
    title: "Services that see what a step needs",
    text: [
      "Google Gemini API: your messages and the photos you upload, to run the conversation and read watch photos. Our key is on the paid tier, under which Google does not use prompts to improve its products and keeps them only for a limited time to detect abuse.",
      "RentCast: a home address you give, to look up its records and value, only where the RentCast lookup is turned on; the public demo uses made-up homes.",
      "Plaid (sandbox only): the mortgage lookup and the investors' identity check use Plaid's test data and Plaid's published test identity, never yours.",
    ],
  },
  {
    title: "What goes on-chain",
    text: [
      "Only hashes, versions, amounts, token metadata and wallet addresses are written to Solana devnet, which is public. Personal data never goes on-chain: an address or a serial number appears only as a keyed hash whose key stays in your sealed case.",
      "If you connect your own wallet, its public address is tied to your case and appears in the transactions it signs.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <>
      <AppHeader />
      <main className="flex-1">
        <Frame className="border-t">
          <div className="border-b border-neutral-800 px-6 py-14 text-center sm:px-10">
            <h1 className="text-[40px] font-semibold tracking-[-2px] text-neutral-100">Privacy</h1>
            <p className="mx-auto mt-3 max-w-[640px] text-neutral-400">What this demo does with the information you give it. Last updated October 3, 2026.</p>
          </div>
          {SECTIONS.map((section) => (
            <section key={section.title} className="border-b border-neutral-800 px-6 py-8 last:border-b-0 sm:px-10">
              <h2 className="mb-3 text-xl font-semibold tracking-[-0.5px] text-neutral-100">{section.title}</h2>
              <div className="max-w-[760px] space-y-3 text-sm leading-relaxed text-neutral-400">
                {section.text.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </Frame>
      </main>
      <AppFooter />
    </>
  );
}
