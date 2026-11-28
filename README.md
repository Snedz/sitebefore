# SiteBefore

SiteBefore sells one-page websites to local businesses using a preview-first, no-call flow.

- `/` explains the launch package.
- `/sample/` shows a fictional garage and illustrative imagery. The earlier salon preview remains at `/shenail/`.
- `/agency/` is the operator workspace for prospect evidence, preview approval, pitch drafts and orders.
- `/p/<token>/` is an approved buyer preview with a test checkout and order status.

## Run the pilot locally

Use Node 22.23.4 or later. Keep the generated operator key for the current session.

```sh
npm ci
export SITEBEFORE_OPERATOR_KEY="$(openssl rand -hex 32)"
export SITEBEFORE_DEMO_CHECKOUT=1
npm run dev
```

Open `/agency/`, sign in with that key, and choose **Add fictional demo**. Review the evidence and open the internal draft. Approve the exact revision, open the share link, cancel and retry, then simulate a payment. To rehearse delivery, enter a fixture link such as `https://example.com/` as the published site URL and mark the order delivered. The buyer can revisit their link for the receipt, delivery status and published site. The local database lives under `.local/`.

For a real dossier, paste JSON containing `currency` (`USD` or `CAD`), `businessUrl` (one stable HTTPS page or listing specific to this business), and `facts`. Each fact has a `field`, `value`, `source`, `excerpt` and `checked` (YYYY-MM-DD). Required fields are `name`, `location`, `trade`, `intro` and at least one `service`; `headline` and `story` are optional. Evidence must contain the quoted wording and be no more than 30 days old at approval. The operator checks that the source is genuine, applies to the business, and supports the claim in context. Remove unsupported claims and keep raw evidence inside Agency OS.

A `service` fact can also include a `description` of up to 250 characters explaining what that service covers or how to get started. The same `excerpt` must contain the service name and description. The description appears in the draft and, once approved, in the buyer preview.

An optional `phone` fact sets a call link in the draft and approved preview. Use a public 10-digit US or Canadian business number, with optional `+1`, and quote that number in the source excerpt. Confirm the number is the intended contact destination before approval. Without a phone fact, the preview uses the existing business URL.

Approving a preview also saves the quoted price and package scope. Existing buyer links keep those terms through checkout and delivery. If the offer changes while reviewing an open draft, reload the draft before approving it.

`npm test` includes a local HTTP rehearsal with the fictional prospect and a temporary database. It checks preview approval, checkout cancellation and retry, and the buyer receipt after delivery.

## Hosted review

The Vercel build uses on-demand Astro routes for the workspace and preview while keeping the storefront static. Set these in the review environment. A review can show the storefront and sample without any configuration.

| Variable | Purpose |
| --- | --- |
| `SITEBEFORE_OPERATOR_KEY` | High-entropy, operator-only key (at least 32 characters). Rotating it invalidates operator sessions. |
| `SITEBEFORE_DB_URL`, `SITEBEFORE_DB_TOKEN` | Authenticated libSQL database scoped to this review environment. The app initializes its pilot tables on first use. |
| `SITEBEFORE_ORIGIN` | Exact HTTPS origin for buyer links and checkout callbacks. Use the fixed review hostname. |
| `STRIPE_SECRET_KEY` | Stripe sandbox restricted key with Checkout Session permissions. The app also accepts a sandbox secret key. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/stripe-webhook` on the same sandbox account. Register `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. |
| `RESEND_API_KEY` | Optional Resend sending key scoped to the dedicated sandbox/test sending domain. |
| `SITEBEFORE_EMAIL_FROM` | Optional verified sender, e.g. `SiteBefore <receipts@test-mail.example.com>` with your own sandbox/test sending domain. |

Use a dedicated, verified Resend test sending domain or subdomain, separate from production mail. Keep open and click tracking disabled for that domain, and enter only an inbox you control during Stripe sandbox checkout. Leave either email variable unset to disable sending. Demo checkout does not send email.

The signed paid webhook saves the Checkout customer email with the order and attempts a receipt using the fixed `SITEBEFORE_ORIGIN`. Marking the order delivered attempts a second email with the published URL. Agency OS shows whether each email was accepted by Resend, skipped, failed, or has an unconfirmed send. Email failures do not undo payment or delivery. Each kind is attempted at most once per order: replays do not resend, and a timeout or interrupted send is not retried automatically. Keep buyer addresses and receipt links private.

On a protected Vercel preview, the browser sign-in and the Stripe webhook are separate requests. Configure an authorized sandbox webhook URL that can reach `/api/stripe-webhook` on the review deployment. When the project uses [Vercel Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation#other-webhook-services), store the generated URL only in the sandbox webhook configuration and keep Stripe signature verification enabled.

For the hosted checkout check, approve the fictional prospect on the review hostname and complete Stripe test Checkout. Confirm that the Stripe sandbox reports a successful `204` delivery, the matching order appears on the buyer receipt, and resending that sandbox event leaves the same single order.

To test with the Stripe CLI locally, use a dedicated Stripe sandbox. The app accepts the temporary claimable sandbox key issued by the CLI as well as standard test keys. Unset `SITEBEFORE_DEMO_CHECKOUT`, use the local server origin as `SITEBEFORE_ORIGIN`, and forward the same events with `stripe listen --forward-to localhost:4321/api/stripe-webhook`. Configure the listener's signing secret as `STRIPE_WEBHOOK_SECRET`. Use a Stripe test card and check that visiting the return page alone leaves the order pending. Replay the webhook and verify the same single order reference. Test mode uses hosted Stripe Checkout. Local simulation is available only during development.

Keep prospect research and contact review private. The workspace builds a pitch draft and the operator shares the link only through an approved channel. The link grants access to whoever has it, and a preview can be revoked in the workspace before its first checkout attempt. Treat drafts as disposable. Persist and back up order records for any hosted pilot.

Before the first customer launch, verify the buyer’s business facts, final copy and image rights. Confirm ownership of the domain and booking/contact destinations. On the finished customer site check mobile layout, links and forms, canonical URL, crawl eligibility, matching business information and any applicable `LocalBusiness` markup. Keep reviews, ratings and service claims grounded in approved evidence. The operator handles revisions, domain connection and publication, then records the verified public HTTPS URL when marking the order delivered. Older delivered orders can be given their public URL while preserving their original delivery time.

```sh
npm test
npm run build
VERCEL=1 npm run build
```
