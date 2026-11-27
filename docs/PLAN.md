# SiteBefore idea plan

## Summary

SiteBefore should sell a better path to booking, not another booking system. Start with independent nail salons in Niagara and the Greater Toronto Area: show the owner a private, mobile-first redesign of their own site before asking for payment, then publish one page that links to the scheduler they already use. Mission Winning LLC should approve the offer, pilot channel and price before any building starts.

## Current state

- **Baseline:** `Snedz/sitebefore` default branch `main` at `17a2184`, refreshed from origin and reviewed with complete local history. The two main commits are `9b02fb3` (initial commit) and `17a2184` (Nov. 15, 2026: offer, salon pilot and sample).
- **What exists:** [README](../README.md) describes an Astro 5 static site with `/` (offer), `/sample/` (labelled fictional example) and `/shenail/` (Niagara salon pilot). `src/pages/` routes pass JSON from `src/data/` to `Offer.astro` or `Preview.astro`. The preview already shows services, prices, hours and booking/contact links; Shenail hands off to LimeOrder. The root sells a broader front office and links to an external Google Form for a short call. Source notes disagree about whether intake is configured; actual delivery to the founder was not tested. Front-office functions are offer copy, not implemented workflows. No pilot result is claimed.
- **Existing research/specs:** No `docs/`, `AGENTS.md`, spec, plan or automated test suite on `main` at review. The [unmerged `no-call-flow` review](https://github.com/Snedz/sitebefore/blob/no-call-flow/REVIEW.md) found that the old offer obscures the product and the redesign still hides its proof behind a heavy intake. Keep its strongest ideas: show a labelled example immediately, minimize intake and quote a fixed price. Its [README](https://github.com/Snedz/sitebefore/blob/no-call-flow/README.md) proposes a free preview, CAD 599 publish and CAD 149/month Care; checkout was not wired on that branch. The referenced external `MissionWinning/67` spec and separately referenced Monday launch plan were unavailable for review; ask Snowden to reconcile any binding decisions before launch.
- **Unmerged implementation:** The [Agency OS branch at `cc35bce`](https://github.com/Snedz/sitebefore/tree/cc35bce) already has a redesigned storefront and fictional Juniper garage sample, evidence-backed drafts and approval, shareable buyer previews, sandbox/demo checkout, order tracking, and workflow tests. Its launch SKU is 599 in the prospect's selected USD/CAD currency. Hosted review uses server routes, libSQL and sandbox Stripe; publishing and domain handoff are manual. The branch's README, scope and file layout were reviewed, but its checkout/workflow was not run for this baseline. Reuse the work selectively; don't merge it just to run the first pilot.
- **Quick health check on `main`:** Node 22.23.5; `npm run build` exited 0 and Astro reported `3 page(s) built in 657ms`. All three expected HTML outputs were nonempty. `npm test` exited 1 with `Missing script: "test"`; there is no test suite on this branch, not a failing application test. No visual, live intake, scheduler transaction or production deployment verification.

## Research findings

- **Who has the problem:** The first buyer is an owner/operator at a single-location nail salon with an active business listing and an existing bookable link, but a mobile site that hides prices, policies or the next step. Their customer needs to confirm the service, price, location and availability quickly. Qualify this with a manual phone audit and owner interviews; do not assume poor conversion from appearance alone. [BrightLocal's 2025 survey](https://www.brightlocal.com/research/consumer-search-behavior/) of 1,000 US consumers found 45% defaulted to Google for local search and 15% started in Maps. This supports testing the listing-to-booking journey, not a Canadian demand or conversion estimate. Use [Statistics Canada's business counts](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3310109501) as a starting point for sizing later, not as a count of pilot-ready salons.
- **The default alternative is good enough for many salons:** A Google Business Profile can [link straight to booking](https://support.google.com/business/answer/6218037?hl=en). Salons may already direct customers there from Maps or social. A separate site is worth buying only if it makes choices and trust clearer without slowing the simplest path; don't sell it to a salon whose listing and booking profile already do that well.

Pricing below reflects vendor pages at review (November 2026), not quotes. Currency, regional pricing, processing fees and billing terms differ; use CAD only where the Canadian vendor page identifies the market.

| Alternative | Published signal | What it means for SiteBefore |
| --- | --- | --- |
| [Durable](https://durable.com/pricing) | Free preview; Launch displayed at $25/month monthly or $22/month billed yearly, with site, CRM and bookings | Closest DIY alternative to “preview first.” Differentiate on a human-checked redesign of this specific salon and a done-for-you handoff, not preview generation alone. |
| [Wix](https://www.wix.com/plans), [Squarespace](https://www.squarespace.com/pricing) / [Acuity](https://www.squarespace.com/scheduling) | Wix has free entry and puts scheduling and services on Core and above; confirm Canadian checkout for rates. Squarespace Basic showed $25/month monthly or $19/month billed annually; Acuity is a separate scheduling offering. | Owners can get polish and booking from an incumbent; do not compete on editor breadth. |
| [GoDaddy Airo](https://www.godaddy.com/en-ca/airo), [10Web](https://10web.io/pricing-platform/) | Airo starts with 50 free AI credits/month; plan/credits govern use. 10Web offers free branded hosting and AI Starter at $10/month billed $120 annually. | Cheap generation and hosting make a generic AI website difficult to sell at a premium. |
| [Hibu](https://hibu.com/digital-marketing/pricing), [Thryv](https://www.thryv.com/pricing/) | Hibu quotes managed packages with typical 6–12 month terms. Thryv lists $99/month Starter with an AI builder and $399/month Signature with a custom site. | Managed alternatives bundle listings, reviews and marketing. Test a narrower, transparent one-time offer rather than matching those retainers. |
| [Square Appointments Canada](https://squareup.com/ca/en/appointments/pricing), [Fresha](https://www.fresha.com/pricing), [Vagaro Canada](https://support.vagaro.com/hc/en-us/articles/22781768988187-Vagaro-Plans-Pricing-and-Premium-Features) | Square CA lists CAD 0/35/85 per month; Fresha displays $19.95/month independent, $14.95/bookable teammate per month and a 20% one-time new marketplace client fee (minimum $6); Vagaro lists CAD 35/month base. | Use official booking links, not a scheduler migration. Fresha also sells a website add-on; qualify owners who need more than the booking provider's existing profile. |

**Platform and policy:** This is a web project, with no hackathon or native Android requirement found in the repository; no track rules or Play Store policy apply to the proposal. On public customer sites, verify canonical URLs, facts and eligibility for [Google's LocalBusiness markup](https://developers.google.com/search/docs/appearance/structured-data/local-business); don't promise rankings or attach [self-serving review-star markup](https://developers.google.com/search/docs/appearance/structured-data/review-snippet). Use authorized review excerpts only; don't gate or incentivize [Google reviews](https://support.google.com/contributionpolicy/answer/7400114?hl=en). Require access controls for real previews; [`noindex`](https://developers.google.com/search/docs/crawling-indexing/block-indexing) is a crawler instruction, not access control. Review [CASL](https://crtc.gc.ca/eng/internet/anti/reg.htm) before sending commercial outreach (document lawful consent, identify sender and provide unsubscribe where required) and [Canadian privacy obligations](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/) before collecting owner contacts. Use [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/) as a design target.

## Reuse candidates

GitHub repositories opened and metadata cross-checked via GitHub search. Stars are snapshot counts; activity is the latest repository push date reported by GitHub, not a release date.

| GitHub repository | License | Stars | Last activity (UTC) | How we would use it |
| --- | --- | ---: | --- | --- |
| [withastro/astro](https://github.com/withastro/astro) | [MIT (core)](https://github.com/withastro/astro/blob/main/LICENSE) | 64,266 | 2026-11-27 | Keep the existing JSON-to-static-HTML pipeline. Use official [sitemap integration](https://docs.astro.build/en/guides/integrations-guide/sitemap/) if needed for live customer routes only. |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Apache-2.0 | 101,204 | 2026-11-27 | Add a small mobile/desktop browser suite for intake, protected-preview access and booking-link handoff. Stub external scheduler navigation in automation; separately check the real destination by hand. |
| [google/schema-dts](https://github.com/google/schema-dts) | Apache-2.0 | 1,265 | 2026-11-01 | If structured-data generation grows, use its types to check approved `NailSalon`/`LocalBusiness` JSON-LD on live pages; no runtime dependency is needed for the first pilot. |
| [arthelokyo/astrowind](https://github.com/arthelokyo/astrowind) | MIT | 6,157 | 2026-09-12 | Reference or adapt a small metadata/layout component with attribution if needed. Don't replace the existing templates with the full theme; this repository's v1 is in maintenance mode. |
| [dequelabs/axe-core](https://github.com/dequelabs/axe-core) | MPL-2.0 (file-level copyleft) | 7,899 | 2026-11-25 | Optional unmodified test-only accessibility scan of intake and templates; keep manual keyboard, contrast and touch checks. Avoid distributing modified covered files without reviewing obligations. |
| [plausible/analytics](https://github.com/plausible/analytics) | AGPL-3.0 (network copyleft for covered software) | 29,957 | 2026-11-27 | Defer. If approved after the pilot, evaluate the hosted service for aggregate booking-link events. Don't vendor or fork the server for this pilot; review consent, terms and licensing first. |

## Options considered

| Direction | Upside | Downside | Decision |
| --- | --- | --- | --- |
| **Keep current direction:** websites plus recurring front-office roles | Larger recurring revenue potential and more services per client | Too many jobs to prove at once; inbox, reviews, outreach and ads multiply operational and compliance costs | Defer role automation until a repeat need is demonstrated. |
| **Preview-first salon launch service:** one page, existing scheduler, fixed fee | Uses the current template and pilot context; tests demand and fulfillment before adding infrastructure | Manual previews cost time; buyers may be happy with Maps/Fresha or DIY | **Pick.** Fastest credible paid test with reversible scope. |
| **Productize Agency OS now:** self-serve or operator platform spanning verticals | Existing branch already models approvals and payment | Hosting, tokens, payment state and operator workflow add overhead ahead of confirmed volume; garage demo doesn't validate salon demand | Keep as an option when manual steps become a measured bottleneck. |
| **Audit only or fold into an existing agency service** | Cheapest to deliver; no publishing operation | Harder to show the proposed solution and test whether owners will pay to launch | Fallback if owners value the diagnosis but don't want a site. |

## Final idea

**See your redesigned salon site before you pay. If you like it, we publish it on your domain and keep the booking system you already use.** Start with one niche and one locality cluster. Show a fictional before/after on the storefront and invite a URL plus a reply address; no call required. An operator checks the current mobile booking path, prepares a short audit and a private concept, and gets sign-off on the exact copy, prices, images and booking destination. The paid package is one page, one revision, domain setup and an export/handoff. Test **CAD 599 one-time**, subject to owner approval; preview is free, and hosting, tax, refund terms and any exclusions must be explicit. No recurring plan in the first offer.

Reuse the static renderer plus the best storefront/proof and approval ideas from the unmerged branches. Use an approved intake channel, protected preview delivery and a manual invoice/payment process initially; no new checkout service, scheduler APIs, patient/client records, automated outreach, review requests or ad management. Measure the shopper's path to the provider's booking screen and the salon's willingness to pay separately; a booking click is not a booking.

## Milestones

### Milestone 1 — Validate willingness to pay and ship a concierge pilot

Timebox: two weeks after owner approval, run by one operator. The thresholds below are proposed decision rules for a small pilot, not forecasts.

1. **Recruit and baseline.** Qualify 10 independent nail salons with live booking destinations and at least one concrete mobile friction point. Use referrals, inbound interest or another owner-approved consent-based channel; record the source and permission before sending individual previews. Capture the baseline tap count and where a customer starting on the existing homepage can find service prices and the appropriate booking screen.
2. **Show the product.** Put a labelled fictional before/after and one primary intake action on the landing page. Deliver three owner-authorized private concepts with 2–3 evidence-backed findings each. Record the exact draft approved, the reason for accept/decline and operator time from intake through approval, revision and handoff.
3. **Sell and fulfill.** Quote the approved fixed price without a mandatory call. On approval and payment, publish one approved site on a business-controlled domain, with a copy of the site and handoff notes. Recheck the booking destination from a phone without creating a real appointment; review aggregate bookings with the owner only if available and authorized.

**Acceptance criteria**

- One fictional demo is plainly labelled; intake delivers a real test submission, with no accidental marketing opt-in. Three real concepts use verified facts and authorized assets, are access-controlled, labelled and kept out of search and public sitemaps; draft data is removed per the agreed retention period.
- On each preview and the published site, the target booking screen is reachable by one clearly labelled tap from the mobile landing page (any subsequent scheduler steps are separate). Spot-check on a phone and keyboard; record the baseline and pilot tap count. Verify the destination, factual details, canonical URL and live indexability for the published page.
- Record 10 qualified businesses, three reviewed previews, at least one paid launch at the agreed price and no more than six operator hours on the paid launch from valid intake to handoff (excluding buyer wait). The pilot log includes objections and time on unpaid previews so margin can be estimated honestly. No uplift claim without booking evidence and a meaningful baseline.
- If no owner pays or manual time exceeds the cap, pause new engineering. Review whether the barrier was price, targeting, weak differentiation or fulfillment cost before narrowing, repricing or stopping.

### Later milestones

- **M2 — Make delivery repeatable:** After the pilot gate passes, serve five more salons, track contribution after unpaid previews and handoff, and standardize the evidence checklist, template and operator workflow. Add browser smoke checks. Evaluate importing the Agency OS approval/order pieces only if manual work is a demonstrated bottleneck.
- **M3 — Expand only on evidence:** Consider hosted checkout and an optional care package if buyers ask and the margin supports it. Test one adjacent appointment vertical after salon delivery is repeatable. Keep external booking and human release approval.

## Risks

- **Low willingness to pay:** Free listings, direct booking pages and inexpensive builders may be sufficient. Test a real price, not just positive comments on previews.
- **Free preview economics:** Track failed and unpaid work, operator time and domain/support costs, not just time on the winning site. Limit scope and one revision; pause when the timebox is missed.
- **Booking attribution and dependence:** Provider links, fees and flows can change. Check links at release; treat event counts as clicks unless provider/owner evidence supports a booking outcome.
- **Trust and compliance:** Approval, licensed assets and accurate claims are non-negotiable. Use approved contact channels, minimize personal data and protect/revoke access to real concepts. Have the owner review jurisdiction, taxes and retention before collecting money or sending outreach.
- **Branch divergence and unresolved specs:** Static `main`, no-call, and Agency OS differ on offer, architecture and payment. External spec/launch notes, actual intake delivery and the unmerged checkout were not verified. Don't infer that any alternate branch is ready for production.

## Open decisions for the owner

1. Approve Niagara/GTA nail salons and the first ten prospect sources? Is Shenail authorized to participate or must all public proof remain fictional?
2. Approve CAD 599, one revision and no monthly commitment? Who pays for hosting/domain, and what are the tax, refund and handoff terms?
3. Who handles intake, fact/asset approval, publishing and support? What access, retention and messaging rules should they follow?
4. Can you share any binding external spec/launch decisions? Should we selectively reuse the Agency OS work or keep the market pilot entirely manual?
5. Are one paid launch and six operator hours the right initial go/no-go bar?

## Recommendation

**Build, after owner approval:** Run the concierge pilot in this repo. Reuse the static renderer, sell one outcome and keep the scheduler external. Don't merge Agency OS or build the front-office suite until a paid pilot and its delivery economics justify the next investment.
