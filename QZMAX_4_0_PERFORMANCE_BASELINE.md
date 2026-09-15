# QZMAX 4.0 — Performance Baseline

## Why this release matters
Prior to 4.0.0, every player performed one full room-state read every second. Host lobby, live-question and exam screens also used recurring database reads. This was simple and reliable during development, but it multiplied Firebase traffic as the number of concurrent players increased.

QZMAX 4.0.0 changes those paths to Firebase realtime listeners. A listener receives an initial snapshot and is then notified only when the watched data changes.

## Read-frequency comparison
A 15-minute player session previously triggered about 900 timer-driven room-state reads per player (1 read/second), even while the room state was unchanged.

A typical 20-question live session changes room phase/state only tens of times. Exact traffic depends on host actions and question formats, but event-driven delivery should reduce repeated room-state fetches by well over 90% in a normal live game.

This is an architectural traffic reduction, not a claim about Firebase billing. Firebase bills according to the actual transferred data and plan terms in force at the time.

## Static asset baseline
Measured against the 3.18.9 packaged source assets:

| Asset group | Before | QZMAX 4.0 production references |
|---|---:|---:|
| 13 principal UI/marketing assets | 9,315,161 bytes | 1,639,818 bytes |
| Reduction |  | 82.4% |
| `index.html` raw | — | ~628 KB |
| `index.html` gzip | — | ~143 KB |

The HTML size is acceptable for this phase; large artwork was the easiest high-value network win.

## New in-app metrics
Host Dashboard → **⚡ Performance** provides a browser-local snapshot of:
- Firebase connection state.
- Current active player count.
- Current room-state JSON size.
- Local navigation timing.
- Resource transfer bytes.
- Largest loaded resources.
- Realtime callback counts.
- Answer-propagation p50/p95 observed while this host page is open.

## Commercial load-test gates
Before publishing a commercial capacity claim, test at:
- 10 simultaneous players.
- 25 simultaneous players.
- 50 simultaneous players.
- 100 simultaneous players.

Recommended initial acceptance targets:
- Player join: < 2 seconds p95.
- New question visible: < 1 second p95 after host state change.
- Answer arrival at host: < 750 ms p95 on a normal broadband/Wi-Fi test.
- Reveal/leaderboard transition: < 1 second p95.
- Player removal: < 1 second p95.
- Lost/duplicate accepted answers: 0 in the controlled test.

These targets are internal engineering goals, not yet commercial guarantees.

## Known remaining scaling item
The current `rooms/{code}/state` still contains the complete `questions` array. Realtime listeners eliminate repeated unchanged reads, but any state change can still deliver a relatively large state snapshot to every connected player.

Commercial Foundation Phase 2 should split:
- small public live state,
- current question,
- full quiz/question bank,
- private/scoring data,
into separate paths so live state updates are lightweight.
