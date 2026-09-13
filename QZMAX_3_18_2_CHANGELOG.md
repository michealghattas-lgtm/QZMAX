# QZMAX 3.18.2 — Live Answer Reliability + AI Generator Reliability

## Live session reliability

- Player answers now use a confirmed Firebase write path instead of displaying a success message before the write result is known.
- The player UI now shows `Saving your answer…` while the write is pending and only shows `Answer locked in` after Firebase confirms the submission.
- Failed/timed-out writes are retried with an idempotent `submissionId`; a verification read checks whether a timed-out write actually arrived before another retry.
- The original answer-selection timestamp and `timeMs` are captured before network retries so slow connectivity does not reduce a player's speed score.
- Host scoring accepts only submissions selected within the question time window (with a small 500 ms UI/clock-jitter allowance).
- Time-up reveal now includes a short finalisation window for in-flight writes.
- A post-reveal reconciliation pass re-reads answers and re-scores the current question if a valid in-time answer arrived just after the first reveal snapshot.
- Going to the leaderboard performs one more reconciliation so the leaderboard uses the latest confirmed in-time submissions.
- Player reveal screens refresh after reconciliation through the state `lastReconciledAt` marker.

## AI Generator reliability

- Netlify-side AI working budget increased from 24 seconds to 50 seconds.
- Browser AI request timeout increased to 56 seconds for AI Generator requests.
- Generator/provider call timeout increased to 12 seconds; Tavily evidence search can use up to 8 seconds when budget permits.
- Independent QA now returns compact candidate-index decisions instead of copying complete question objects. This removes a major source of false rejections caused by harmless formatting differences.
- Web evidence anchoring is less brittle: QZMAX still requires a valid Tavily source, but can anchor a generated supporting phrase back to actual text from that selected source before independent QA.
- Approved questions are preserved. If some candidates fail QA, QZMAX performs one targeted repair pass for only the missing questions instead of throwing away the whole batch.
- Successful responses expose accepted/repair counts in diagnostic response headers.
- Free-provider fallback architecture remains in place; no paid model requirement was introduced.

## Regression protections retained

- QZMAX Library remains completely separate from AI Generator.
- Arabic/English Bible canonical topic mapping from 3.18.1 is retained.
- Puzzle Mode continues to deduplicate stored puzzles by `puzzleKey`, not generic semantic question text.
