# QZMAX Anti-Cheat Investigation

## What the reported helper app is doing
A second app can read the visible question and options, send that text/image to an AI model, and suggest an answer. In a normal browser there is no reliable way to prevent another application, accessibility service, camera, screenshot tool or external device from seeing what is visibly displayed.

The existing speed-based scoring already reduces the advantage of a helper that takes about 10 seconds, because a human who knows the answer can score sooner.

## More important issue found in the current architecture
QZMAX currently writes the host's complete question objects into `rooms/{code}/state`. Player clients read that same room state.

Those question objects can include the answer key (`correct` / `correctIndexes` / accepted typed answers) and explanation before reveal. A technically capable player therefore may not even need OCR or an AI screen reader: browser developer tools or a custom client could inspect Firebase data directly.

This is a more important security issue than the 10-second visual AI helper.

## Recommended secure architecture
### 1. Split public question state from private answer keys
Public player room state should contain only:
- question text
- visible options
- media
- question type
- timer / start time
- question index

It must NOT contain:
- correct answer index(es)
- accepted typed answers
- explanations that reveal the answer
- private scoring metadata

### 2. Store answer keys in a host-only location
Example:
`privateRooms/{hostUid}/{code}/answerKeys/{questionIndex}`

Firebase Realtime Database Security Rules must enforce that only the authenticated host UID can read this path. Merely hiding it in JavaScript is not security.

An alternative is keeping the key only in a server-side function / trusted backend.

### 3. Score in a trusted context
Preferred options:
- a Netlify / Firebase server function validates submitted answers against the private key; or
- the authenticated host performs scoring while the private key remains host-readable only.

Players should never receive the answer key before reveal.

### 4. Publish the answer only at reveal
When the host reaches Reveal, QZMAX can publish a safe `reveal` payload containing the correct answer and explanation.

## Optional additional defences
### Per-player option shuffling
Each player can receive the same answers in a different order. The submission stores a stable option ID rather than a visible A/B/C/D position. This prevents simple scripts that assume a shared answer letter, although an AI that reads the full page can still reason about the content.

### Suspicious-behaviour telemetry
QZMAX could flag patterns for the host rather than automatically punish players, for example:
- repeated answers at a very similar 9–12 second delay
- unusually high accuracy combined with consistent delayed responses
- repeated tab / visibility changes (weak signal only)

These indicators are not proof of cheating and should not automatically remove points.

### Stronger late-answer score decay
A host-selectable competitive mode could reduce points more aggressively after (for example) 8–10 seconds. This makes slow AI assistance less rewarding, but it can unfairly affect legitimate slower readers, so it should remain optional.

## What browsers cannot reliably block
QZMAX cannot reliably prevent:
- screenshots
- screen recording
- a second physical phone/camera
- operating-system accessibility tools
- another app reading pixels with user permission

Trying to block copy/paste, right-click or keyboard shortcuts provides little real security and harms normal users.

## Recommended priority
1. **Private answer-key architecture + Firebase security rules** — highest priority.
2. **Server/host-trusted scoring**.
3. **Optional per-player answer-order shuffling**.
4. Host-facing suspicious-pattern telemetry if required.

This should be treated as a separate security release because it changes the Firebase data model and should be tested carefully against live scoring, host recovery, exams and reconnect behaviour.
