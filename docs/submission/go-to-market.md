# Ownflow: go-to-market, demand validation and distribution

For the Colosseum Crypto World's Fair submission (Solana track). Every figure below is quoted from
the source linked next to it (checked October 2026). What Ownflow has built is described as built;
what comes next is marked as a plan.

## For the submission form (short answers)

**Go-to-market strategy.** Start where the money and the confusion are: US homeowners locked into
low mortgage rates who need cash. They hold $11.7 trillion in tappable equity (ICE, Q2 2026) and
increasingly use second liens instead of refinancing. Ownflow is the neutral comparison layer in
front of HELOCs, home equity loans and home equity investments (HEIs), which regulators and states
now scrutinize. Revenue comes from a flat fee per completed case that does not depend on which
provider wins, plus a platform fee from licensed issuers whose HEIs are tokenized on Solana with
on-chain KYC and pay-and-burn settlement. Watches follow as a second lane.

**Demand validation.** Market signals: HELOC balances have risen 17 quarters in a row to $459B
(NY Fed, Q2 2026); second liens were 54% of equity withdrawals (ICE, Q1 2026); LendingTree's home
equity revenue grew 15% year over year (Q2 2026). The HEI market is small but growing ($2–3B,
CFPB) and has drawn warnings that it is costly and marketed as "not a loan", which is the gap a
neutral comparison fills. Product validation so far: the full flow runs on Solana devnet with a real
Phantom wallet and Plaid's identity verification sandbox. Next: homeowner interviews, a broker pilot
and a waitlist, with the metrics below.

**Distribution plan.** (1) Independent mortgage brokers (over 13,000 broker businesses in UWM's
channel alone) who need a neutral way to show clients every option; (2) search and content around
"HEI vs HELOC" decisions, with the calculator as the hook; (3) licensed HEI issuers and investors,
who get KYC-gated tokens, delivery-versus-payment and pay-and-burn settlement on Solana; (4) the
Solana ecosystem: Phantom (15 million monthly users) and the 850,000+ RWA holders on Solana.

---

## 1. Why now

### Homeowners need cash, and the usual way out is closed

- "47.5 million mortgage holders hold $11.7 trillion in tappable equity, averaging approximately
  $212,000 per borrower." Mortgage holder equity "hit $18 trillion in Q2, a new all-time high."
  ([ICE Mortgage Monitor, Aug 10, 2026](https://ir.theice.com/press/news-details/2026/ICE-Mortgage-Monitor-Mortgage-Holder-Equity-Climbs-to-Record-18-Trillion-as-Annual-Home-Price-Growth-Reaches-14-Month-High/default.aspx))
- Rate lock-in: 19.2% of outstanding first-lien mortgages carry a rate below 3% and 29.9% a rate of
  3–3.99% (Q2 2026; [FHFA National Mortgage Database](https://www.fhfa.gov/data/national-mortgage-database-aggregate-statistics)),
  while "the 30-year fixed-rate mortgage averaged 7.28% as of October 1, 2026"
  ([Freddie Mac PMMS](https://www.freddiemac.com/pmms)). A cash-out refinance would give that up.
- So owners borrow behind their first mortgage: "Second liens accounted for 54% of equity
  withdrawals … as borrowers with low fixed-rate mortgages … opt for second liens rather than
  refinancing" ([ICE Mortgage Monitor, June 2026](https://mortgagetech.ice.com/publicdocs/mortgage/IMT-ICE-Mortgage_Monitor_June_2026_xfsrgggme.pdf)).
  "HELOC balances rose by $13 billion totaling $459 billion" in Q2 2026, the 17th consecutive
  quarterly increase ([New York Fed, Aug 11, 2026](https://www.newyorkfed.org/newsevents/news/research/2026/20260811)).
- Not everyone can carry a monthly payment: in the Federal Reserve's 2025 survey, 63% would cover a
  $400 emergency expense with cash or its equivalent, and among credit applicants "one-third were
  either denied credit or approved for less credit than they requested"
  ([Federal Reserve SHED, May 13, 2026](https://www.federalreserve.gov/newsevents/pressreleases/other20260513a.htm)).
  For them, an HEI (no monthly payment) is a real option, and its cost is the hardest to judge.

### HEIs need a neutral comparison

- The CFPB: "Under many contracts, the settlement amount grows at a rate of 19.5-22% per year in the
  early years, which is substantially higher than interest rates on most home-secured credit", and
  "Companies often claim that home equity contracts are "not a loan," have "no interest," and involve
  "no debt."" The market's "total volume [is] estimated to be between $2 billion to $3 billion"
  ([CFPB Issue Spotlight, Jan 15, 2025](https://www.consumerfinance.gov/data-research/research-reports/issue-spotlight-home-equity-contracts-market-overview/)).
- States are treating HEIs as mortgage credit: Maryland (2023,
  [Ch. 568](https://mgaleg.maryland.gov/2023RS/chapters_noln/Ch_568_hb1150T.pdf)), Illinois (2025),
  Connecticut (2025, [P.A. 25-115](https://cga.ct.gov/2025/act/Pa/pdf/2025PA-00115-R00SB-01257-PA.PDF))
  and Maine (2026). Massachusetts' Attorney General sued an HEI provider in 2025, alleging the product
  is "an unlawful reverse mortgage loan"
  ([Mass. AGO, Feb 20, 2025](https://www.mass.gov/news/ag-campbell-files-nation-leading-state-enforcement-action-against-home-equity-investment-company-alleging-violations-of-consumer-protections-mortgage-laws)).
- Ownflow's answer is built in: every path is costed by the same code, an HEI's cost is shown for
  each price scenario next to a HELOC's and a home equity loan's, and fixed published rules decide
  (a borrower repaying within three years is sent to a HELOC first). The investor return cap and the
  payback curve are shown before anything is signed, next to the CFPB's finding on how fast the amount
  owed grows in many contracts.

### Tokenization is moving from pilots to products, and home equity is already its largest consumer asset

- On public chains, distributed real-world assets total $38.61B, up from $19.22B in January 2026
  ([rwa.xyz](https://app.rwa.xyz/), accessed Oct 3, 2026). Tokenized Treasuries alone were about
  $100 million at the start of 2023 ([CoinDesk, Oct 30, 2023](https://www.coindesk.com/markets/2023/10/30/tokenized-us-treasury-market-grows-nearly-600-to-698m-as-cryptos-rwa-race-intensifies))
  and are $14.75B today (rwa.xyz).
- Home equity leads consumer assets on-chain: the Figure HELOC Token shows a total value of
  $23,399,762,228 ([rwa.xyz](https://app.rwa.xyz/assets/FIGR_HELOC)). HEIs, the no-payment alternative,
  have no comparable on-chain market yet.
- BlackRock's Larry Fink: "Every stock, every bond, every fund—every asset—can be tokenized. If they
  are, it will revolutionize investing." And: "One day, I expect tokenized funds will become as
  familiar to investors as ETFs—provided we crack one critical problem: identity verification."
  ([2025 Chairman's Letter](https://www.blackrock.com/corporate/investor-relations/2025-larry-fink-annual-chairmans-letter)).
  In 2026: "we believe that tokenization today may be roughly where the internet was in 1996"
  ([2026 Chairman's Letter](https://www.blackrock.com/corporate/investor-relations/larry-fink-annual-chairmans-letter)).
  Ownflow's KYC is exactly that piece: Solana Attestation Service attestations, read from the chain
  before a share account opens.
- Forecasts: Citi Institute projects tokenized assets to reach "$5.5 trillion by 2030 in a base case
  scenario, with a bear case of $2.7 trillion and a bull case of $8.2 trillion", from about $17 billion
  today ([Citi GPS, Tokenization 2030](https://www.citigroup.com/rcs/citigpa/storage/public/Citi_Institute_GPS_Report_Tokenization_2030.pdf)).
- Access is still institutional: BlackRock's BUIDL fund has a $5,000,000 minimum
  ([rwa.xyz](https://app.rwa.xyz/)). An Ownflow HEI share is one millionth of a home's value at
  settlement (about $0.67 for a $1M home), sold only to KYC-attested wallets.
- Solana is where these institutions are building: $4.29B in distributed RWAs, third among chains,
  with 851,272 RWA holders ([rwa.xyz, Solana](https://app.rwa.xyz/networks/solana)). BUIDL added a
  Solana share class in March 2025 ([Securitize](https://investors.securitize.io/news/news-details/2025/BlackRock-and-Securitize-Debut-New-BUIDL-Share-Class-on-Solana-Network-03-25-2025/default.aspx));
  "Solana Attestation Service (SAS) is now live on Solana mainnet" (May 2025) with KYC providers such
  as Civic and Sumsub ([Solana](https://solana.com/news/solana-attestation-service)); PayPal USD and
  Paxos USDG run on the same Token-2022 program and extensions Ownflow uses.

### Watches: a large asset base with expensive liquidity

- "Preowned watch sales reached $22 billion in 2021, accounting for nearly one-third of the overall
  $75 billion luxury watch market" ([BCG, Mar 9, 2023](https://www.bcg.com/publications/2023/luxury-watch-market-trends)).
- Cash from a watch is costly and opaque: one watch lender quotes interest "on average, 3-8% per
  month" ([Borro](https://borro.com/faq/)); marketplace fees run up to 15% under $1,000
  ([eBay](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822)). Ownflow puts
  dealer, marketplace and loan side by side, and lets an owner keep a favorite watch.

## 2. Customer and offer

| Who | What they get | What we can show today (devnet) |
|---|---|---|
| Homeowners who need cash and cannot or will not take a monthly payment | Every path compared by fixed rules; an HEI only when it wins; a receipt on-chain; settlement terms shown as a curve | Persona B: HEI recommended at a $0 budget; HELOC wins for a 2-year horizon (persona B2) |
| Watch owners | Dealer, marketplace and loan compared; keep the watch you love; optional vault + 1-of-1 token | Persona A: loan on one watch + dealer sale of the other |
| Licensed HEI issuers | Token-2022 shares with frozen-by-default accounts, SAS KYC check before thawing, delivery-versus-payment sales, pay-and-burn settlement | The partner page runs all of it on devnet |
| Investors | Fractional exposure to home values, KYC once (attestation reused across deals) | KYC attestations reused across sales |

## 3. Business model (plan)

- **Neutral fee per completed case.** The CFPB's advisory opinion on comparison platforms says an
  operator violates RESPA §8 when it presents providers "non-neutrally" while paid for referrals, and
  that "a higher fee for including one settlement service provider … can be evidence of an illegal
  referral fee arrangement" ([88 FR, Feb 13, 2023](https://www.govinfo.gov/content/pkg/FR-2023-02-13/html/2023-02910.htm)).
  Ownflow's ranking is fixed code and the receipt records it, so a flat fee that is the same for
  every provider fits the model.
- **Issuer platform fee** for HEIs tokenized through Ownflow's rails (KYC attestations, primary sale,
  settlement), charged to the licensed issuer, not the homeowner.
- **Watch lane**: a flat fee per completed sale or vault intake through partner dealers and vaults.

## 4. Demand validation

**Market evidence (above):** record tappable equity, rate lock-in pushing owners to second liens,
17 straight quarters of HELOC growth, an HEI market with regulators' warnings, and LendingTree's
home equity revenue up 15% year over year to $34.9 million in Q2 2026, "an 11% increase in volume…
and a 4% increase in revenue earned per consumer"
([LendingTree 10-Q](https://www.sec.gov/Archives/edgar/data/1434621/000162828026050633/tree-63026xer.htm)).
Research on shopping backs a comparison tool: borrowers who shop too little pay at least $1,000 more
(Woodward & Hall, *AER* 2012), and the UK CMA found that digital comparison tools "make it easier for
people to shop around, and improve competition" ([CMA, 2017](https://www.gov.uk/cma-cases/digital-comparison-tools-market-study)).

**Product evidence (built):** the full flow works end to end on Solana devnet, including with a real
Phantom wallet signing the receipt and the settlement payment, and Plaid's identity verification
sandbox behind on-chain KYC attestations.

**Next (plan, first 6 weeks after the hackathon):**

| Test | Target |
|---|---|
| 20 interviews with homeowners who looked at a HELOC or an HEI in the last year | 10+ say they would use a neutral comparison before signing |
| A pilot with 3 independent mortgage brokers using Ownflow with clients | 30 cases run; brokers keep using it after 2 weeks |
| Waitlist from "HEI vs HELOC" search content and the live calculator | 500 sign-ups; 10% complete a full comparison |
| Talks with 2 licensed HEI issuers about tokenized settlement rails | 1 letter of intent for a sandbox issuance |

## 5. Distribution

1. **Independent mortgage brokers.** "Approximately 2 of every 10 loans are originated through the
   wholesale channel", with "over 13,000 independent broker businesses" in UWM's network alone
   ([UWM 2025 10-K](https://www.sec.gov/Archives/edgar/data/1783398/000178339826000013/uwmc-20251231.htm)).
   Brokers already sell HELOCs; Ownflow gives them a neutral, explainable comparison that includes
   HEIs, and a receipt that shows the client was shown every option.
2. **Search and content.** The decision people search for is "HEI or HELOC?". The live calculator,
   with the CFPB's warnings and state rules explained, is the hook; the agent is the product.
3. **Issuers and investors.** HEI issuers fund contracts and sell them later (the CFPB counts about
   $1.1 billion securitized by the four largest providers in ten months of 2024). Ownflow's Solana
   rails let them sell KYC-gated shares directly and settle with pay-and-burn.
4. **The Solana ecosystem.** Phantom reports "15 million monthly active users"
   ([Phantom, Jan 2025](https://phantom.com/learn/blog/phantom-series-c)); Solana counts 851,272 RWA
   holders (rwa.xyz). Ownflow already connects Phantom and checks KYC with the Solana Attestation
   Service, so any SAS KYC provider can plug in.

## 6. Compliance path

Ownflow is a connector: a licensed partner issues the HEI, holds the contract and services it, and
states' mortgage rules apply where they treat HEIs as credit. Investor tokens are expected to be
securities, so they would be offered under an exemption chosen with counsel, to KYC-attested wallets
only. Personal data stays off-chain; only hashes go on-chain.

## 7. Risks we take seriously

- Tokenization does not create liquidity by itself: Citi notes it "cannot fundamentally alter the
  underlying liquidity profile or long-duration nature of many private market investments"
  (Citi GPS 2026), and a study of 58 tokenized US rental homes found "property ownership changes about
  once yearly" (Swinkels, *Financial Innovation* 2023). Ownflow focuses on primary sale and settlement,
  not on a promise of secondary trading.
- Adoption of token-based platforms "exhibits an S-curve: it starts slow" (Cong, Li & Wang, *RFS*
  2021), so the plan starts with brokers and issuers, not retail token trading.
- The BIS finds that with tokenisation "the most valuable gains would involve the largest challenges"
  ([BIS Bulletin 72, 2023](https://www.bis.org/publ/bisbull72.htm)): illiquid assets like homes are
  both the opportunity and the hard part. And off-chain operations are "not any more transparent than
  in traditional legacy systems" ([Fed FEDS Notes, 2024](https://www.federalreserve.gov/econres/notes/feds-notes/tokenized-assets-on-public-blockchains-how-transparent-is-the-blockchain-20240403.html)),
  so the issuer's off-chain servicing needs its own disclosure.
- HEI regulation is moving (state laws above; a 2025 federal appeals decision on whether an HEI is a
  reverse mortgage was later dismissed), so issuance stays with licensed partners.

## 8. Roadmap (plan)

| When | Milestone |
|---|---|
| Q4 2026 | Validation tests above; mainnet pilot of KYC attestations with a SAS KYC provider; broker pilot |
| H1 2027 | First issuer partner: sandbox HEI issuance with on-chain KYC, primary sale in USDC, settlement |
| H2 2027 | Watch lane with a vault partner; more states; open SDK for issuers (attestation check, pay-and-burn) |

## Research behind the design

- Caplin, Chan, Freeman & Tracy, *Housing Partnerships* (MIT Press, 1997): the original proposal for
  investor equity stakes in homes, the ancestor of HEIs.
- Shiller & Weiss, "Home Equity Insurance", *Journal of Real Estate Finance and Economics* 19(1),
  1999, doi:10.1023/A:1007779229387: who bears house-price risk.
- Greenwald, Landvoigt & Van Nieuwerburgh, "Financial Fragility with SAM?", *Journal of Finance*
  76(2), 2021, doi:10.1111/jofi.12992: shared-appreciation contracts and systemic risk.
- Cong & He, "Blockchain Disruption and Smart Contracts", *Review of Financial Studies* 32(5), 2019,
  doi:10.1093/rfs/hhz007: smart contracts "can mitigate informational asymmetry and improve welfare
  and consumer surplus through enhanced entry and competition".
- Agur, Villegas-Bauer, Mancini-Griffoli & Martinez Peria, "Tokenization and Financial Market
  Inefficiencies", IMF Fintech Note, 2025, doi:10.5089/9798400298905.063.
- Kreppmeier, Laschinger, Steininger & Dorfleitner, *Journal of Banking & Finance* 154, 2023,
  doi:10.1016/j.jbankfin.2023.106940: real estate tokens give "broad real estate ownership to many
  small investors".

Not investment or financial advice. Ownflow is a demo on Solana devnet.
