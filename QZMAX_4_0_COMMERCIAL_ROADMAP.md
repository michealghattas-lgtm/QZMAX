# QZMAX 4.0 Commercial Roadmap

## Phase 1 — completed in 4.0.0
- Event-driven Firebase player state.
- Event-driven Host Setup roster.
- Event-driven live answer counts.
- Event-driven Exam participation counts.
- Local performance diagnostics/export.
- Major WebP asset optimisation.

## Phase 2 — Firebase data model and security
- Split lightweight public live state from full question payloads.
- Publish only the current player-facing question in the live path.
- Review and harden Firebase Realtime Database Security Rules.
- Define automatic room/session retention and cleanup.
- Add production/staging Firebase separation.

## Phase 3 — backend commercialisation
- Convert/prepare the AI API for the chosen production host (VentraIP Node.js is a candidate).
- Require a verified host Firebase ID token for AI/API calls.
- Add per-account API rate limiting and usage quotas.
- Move the primary AI provider to predictable paid billing while retaining controlled fallbacks.
- Add server-side structured error logging.

## Phase 4 — product and billing
- Subscription plans and entitlements.
- Stripe Checkout/customer portal/webhooks.
- Usage meters and account plan display.
- Email verification, account deletion and support/contact workflows.
- Terms, Privacy Policy, cancellation/refund wording and data-retention policy.

## Phase 5 — capacity certification
- Automated 10/25/50/100-player load tests.
- Test venue-style shared Wi-Fi and mobile-network scenarios.
- Publish only the player/session limits that pass the load test with acceptable p95 latency and zero scoring loss.

## Hosting note
Do not purchase VentraIP hosting solely for Phase 1. The current Netlify deployment can remain active while the Firebase/data-model work is completed. Once the API contract is stable, QZMAX can be migrated to VentraIP cPanel/Node.js with Firebase retained for Authentication + Realtime Database.
