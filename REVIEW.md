# SiteBefore landing page — blunt design review

**Reviewed:** 2026-11-16  
**Versions:** `main` / production (sitebefore.com) vs branch `no-call-flow` (PR #1)  
**Screenshots:** `artifacts/screenshots/` (main and no-call-flow, desktop 1440px and mobile 390px)

## 5-second first impression

| Version | What you feel in 5 seconds |
|--------|----------------------------|
| **main / production** | A long B2B services brochure for something called a “front office.” You are not sure if this is software, an agency, or a staffing pitch. |
| **no-call-flow** | A generic 2018 SaaS template: dark gradient hero, white form card, numbered step boxes. Closer to the real product, but it still looks like a weekend landing page, not something you would trust with your business URL. |

**Verdict:** The founder is right. Neither version reads as premium or inevitable. `no-call-flow` fixes copy and pricing honesty but makes the visual problem worse by cramming a five-field form into the hero and keeping the same dated visual language as main.

---

## What this is and who it is for

**Good (no-call-flow):** The headline finally says “see your new site before you pay.” Fixed CAD prices on the page match the business model.

**Bad (both):**

- **main** still leads with “booking and reviews — run like a front office,” four monthly “roles” (Front Desk, Reputation Manager, etc.), and **“pricing on a short call.”** That contradicts the no-call, productized offer and scares off nail-salon and contractor owners who want a website, not a virtual office team.
- **no-call-flow** explains the flow in too many words before showing anything. A visitor must read five step cards to understand what they get. There is **no visual of a preview or audit** — the core product is invisible.

**Reference gap:** [Durable](https://durable.co) and [Carrd](https://carrd.co) show the output immediately (templates, live demos). [Linear](https://linear.app) and [Stripe](https://stripe.com) communicate one sharp idea above the fold with product UI in frame one. We communicate with paragraphs.

---

## Visual design

### Typography

- Georgia serif headlines + system sans body reads **small-law-firm circa 2015**, not modern product.
- Headline sizes are modest; nothing anchors the eye. Section titles all use the same underline-border pattern — monotonous.

### Color and atmosphere

- Navy → teal diagonal gradient on the hero is the visual cliché of “bootstrap SaaS.” It fights the warm paper/cream sections below instead of bridging them.
- Teal pills on white cards have **no depth, no motion, no craft** — flat boxes in a grid.

### Spacing and hierarchy

- Everything is `max-width: 920px` center column with equal-weight cards. **No focal point** beyond the form.
- Hero form is visually heavy (labels, checkbox, three inputs) and **competes with the headline** instead of supporting one action: paste URL.

### Imagery and product proof

- **Zero** screenshots, mock browsers, or preview frames on the marketing page (ironically, the repo already renders beautiful preview pages at `/sample` and `/shenail`).
- No before/after story. The promise is abstract.

**Reference gap:** [Framer](https://www.framer.com) and [Webflow](https://webflow.com) homepages are built around **showing the thing you will get**. We ask for trust with text alone.

---

## Trust

**Strengths (no-call-flow):**

- Fixed prices, no fake testimonials (correct choice).
- CASL footer, unsubscribe path, “AI says it’s AI,” no calls — aligned with spec.

**Weaknesses:**

- Placeholder `[FOUNDER: physical mailing address]` visible on the public footer **signals “not finished.”**
- “Online checkout opens soon” on the pricing section **undermines the $599 publish offer** — reads as vaporware.
- No operator face needed (founder doesn’t want calls), but there should be **tangible product evidence** (example audit, example preview labelled as example).

**Reference gap:** [Stripe](https://stripe.com) trust comes from polished UI and precise copy, not trust badges. We have neither polish nor product chrome.

---

## Conversion path

| Step | Issue |
|------|--------|
| Arrive | No single obvious action except “read.” |
| Hero | **Five fields + legal checkbox** before value — high friction for a “free preview.” |
| Middle | Five “how it works” steps + separate “How we work” trust grid — **duplicate section energy**, scroll fatigue. |
| Pricing | Three CTAs all jump to `#start` with intent flags — clever, but visitor must re-read the form. |
| Submit | Google Form `no-cors` POST is fine technically; success state is plain text in the hero. |

**Ideal path (for this audience):** Paste URL → see what happens (example) → email → done. Current path: read essay → fill form in gradient box.

---

## Copy quality

- **main:** Jargon-heavy (“front office,” “roles,” “workflows,” pilot salon paragraph). Sounds like an internal strategy doc.
- **no-call-flow:** Clearer and more honest, but still **too long** in hero subhead and step cards. Repeats “no calls” six times — necessary legally/emotionally, but should live in FAQ once.

---

## Mobile

- Sticky header + tall hero form = **first screen is almost entirely form fields**, not promise.
- Card grids stack fine, but typography doesn’t scale up for mobile heroes — feels cramped.
- Touch targets on checkbox + small notes are acceptable but not delightful.

---

## Performance

- Static Astro, no external fonts, no images on landing page — **fast by default** (good).
- Opportunity: add **one** optimized inline SVG or lightweight mock (no hero photography) without hurting LCP.

---

## main vs no-call-flow summary

| Dimension | main | no-call-flow |
|-----------|------|----------------|
| Offer clarity | Poor (wrong product story) | Better |
| Visual quality | Dated | Same dated shell |
| Trust | Calls for pricing | Fixed prices, but “checkout soon” |
| Conversion | Book-a-call energy | Heavy form hero |
| Product demo | None | None |

`no-call-flow` is a **copy/spec upgrade in the same bad outfit.** That is why it can feel *worse*: the gap between promise (“see your new site”) and presentation (generic template, no preview) is more obvious.

---

## References — what “good” looks like here

1. **Linear** — One line value prop, dark/light discipline, product UI as hero art, ruthless brevity.
2. **Stripe** — Typographic confidence, whitespace, pricing that looks final, no “coming soon.”
3. **Framer** — Instant understanding: design → publish. Show the canvas.
4. **Durable** — “Type your business name, get a site” — **immediate output preview**, dead simple intake.
5. **Carrd** — Proof by gallery; fixed low prices; no enterprise fog.

**What to steal for SiteBefore:** one hero action (URL), a labelled **example** before/after, three steps max, pricing cards that look like you can click pay today (even if checkout is email-linked for now), FAQ for objections, footer compliance without looking broken.

---

## Redesign direction (this branch)

The follow-up commit on `no-call-flow` should:

1. Hero: promise + single URL field; full intake below the fold with URL carried through.
2. Example audit + preview cards (clearly marked **Example**).
3. Three-step how-it-works; pricing; short FAQ; trim repeated trust bullets.
4. Visual system: calm neutral base, one accent, modern sans hierarchy, subtle borders — no gradient hero template.
5. Keep Google Form intake wiring unchanged.

Done right, a contractor or salon owner should think: **“Oh — I paste my site and they show me a better one. $599 if I want it live. No phone call.”** in under ten seconds.