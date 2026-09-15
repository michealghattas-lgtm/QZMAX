# QZMAX 4.0.0 — Commercial Foundation Phase 1

## Purpose
QZMAX 4.0.0 begins the commercial hardening work without changing the proven quiz-generation behaviour or the live-game UX.

## Firebase efficiency
- Removed the player's fixed 1-second `state` polling loop.
- Player room-state changes now arrive through Firebase Realtime Database `onValue()` listeners.
- Player membership/removal remains protected by the dedicated per-player membership listener introduced in 3.18.9.
- Removed the Host Setup 1.8-second database polling loop.
- Host lobby player count, roster and teams now update through realtime listeners.
- Removed the live-question 0.9-second answer/player polling loop.
- Host answer counts and “everyone answered” detection now update directly from realtime answer/player listeners.
- Removed the Exam 1.2-second players/answers/state polling loop.
- Exam participation and saved-answer counts now update through realtime listeners.
- Added explicit realtime-listener cleanup during screen/session transitions to prevent stale listeners.

## Performance diagnostics
A new **⚡ Performance** screen is available from the Host Dashboard. It reports locally observed diagnostics including:
- Firebase connected/reconnecting state.
- Event-driven architecture status.
- Active room player count.
- Current room-state snapshot size.
- Page load and DOMContentLoaded timing when available.
- Browser resource transfer size.
- Largest transferred resources.
- Realtime callback count.
- Observed answer-propagation p50/p95 on the current host device.
- Export-to-JSON for support/load-test captures.

The diagnostics remain local to the browser unless the host explicitly exports the JSON file.

## Asset delivery optimisation
The large QZMAX PNG presentation assets now have WebP production equivalents and the running app references the WebP versions.

For the 13 principal UI assets changed in this release:
- Previous PNG total: ~8.88 MiB / 9.32 MB.
- New WebP total: ~1.56 MiB / 1.64 MB.
- Approximate byte reduction: **82.4%**.

Notable examples:
- `background-home`: ~2.50 MiB → ~96 KiB.
- `background-players`: ~2.48 MiB → ~76 KiB.
- `feature-ai-powered`: ~530 KiB → ~137 KiB.
- `feature-live-interactive`: ~499 KiB → ~126 KiB.

Original PNG files are retained in the full source package for compatibility/source preservation, but the app no longer references them during normal delivery.

## AI generation
No functional AI-generation route changes were made. `netlify/functions/generate.js` only reports QZMAX version 4.0.0.

## Preserved features
All 3.18.9 behaviour is retained, including:
- Full-screen adaptive player layout.
- Host player management/removal and reliable player eviction.
- Bright Mode fixes.
- Stable player reveal refresh.
- Young Learners Years 1–4.
- Brain Puzzles & Riddles close-choice mode.
- Session reset, rankings, teams and exam mode.

## Next commercial phase
The next efficiency change should split the complete question bank away from the frequently changing room state so player state listeners receive a much smaller payload. After that, QZMAX should be load-tested at 10 / 25 / 50 / 100 concurrent players before a published commercial player limit is set.
