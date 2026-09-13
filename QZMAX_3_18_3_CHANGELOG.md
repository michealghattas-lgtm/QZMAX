# QZMAX 3.18.3 — Fast AI Generator + Conditional Web Grounding

## Why this release exists

3.18.2 still routed every AI Generator request through Tavily research, AI generation, an independent AI QA pass, and sometimes a repair pass. That made simple requests such as 10–20 General Knowledge questions unnecessarily slow and vulnerable to Netlify timeouts.

## AI Generator changes

- Standard/stable topics now use one free AI provider for generation, followed by deterministic QZMAX validation.
- Normal/stable AI backend batch size increased from 10 to 20 questions so a 20-question quiz can be requested in one model call. Web Grounded requests stay at smaller 10-question passes because they include fresh evidence retrieval.
- Tavily search is no longer mandatory for ordinary General Knowledge, History, Science, Film, Music, Sport, Bible, etc.
- Current/recent requests automatically use Web Grounded mode. Current Affairs always qualifies; latest/today/recent/news/current-year/present/ongoing and similar time-sensitive scopes also trigger it.
- Web Grounded mode is Tavily evidence -> one generator -> source-anchor and structural validation.
- The mandatory independent-model QA stage and same-request repair stage are removed from active AI Generator orchestration.
- Free provider order remains Gemini -> Groq GPT-OSS 120B -> Cloudflare -> Mistral -> reserve providers, but the next provider is called only after a real failure or unusable result.
- A useful partial batch is returned immediately and retained; the browser requests only the missing amount.
- Standard AI server budget is 32 seconds; Web Grounded mode is 42 seconds. Provider calls are capped at 15 seconds.
- Browser timeout is 37 seconds for Standard AI and 47 seconds for Web Grounded AI.
- User-facing progress/status copy no longer advertises mandatory research or independent QA for stable topics.
- Standard questions use the `QZMAX AI` badge. Time-sensitive evidence-backed questions use `Web Grounded`.

## Accuracy safeguards retained

- The generation prompt requires established/high-confidence facts and instructs the model to replace uncertain or ambiguous questions before returning JSON.
- QZMAX checks JSON structure, option uniqueness, correct-answer indexes, requested format, General Knowledge coverage categories, and frontend duplicate/fact keys.
- Current/recent Web Grounded questions must still anchor to a Tavily source/evidence record.
- QZMAX Library remains completely separate and is never silently used to fill AI shortfalls.

## Reliability retained from 3.18.2

- Firebase-confirmed player answer submissions.
- Automatic safe retry of failed/timed-out answer writes.
- Original answer selection time preserved across retries.
- Host response-finalisation window and score reconciliation before leaderboard.

## Mock integration checks

- Standard 20-question AI request: one Gemini call, zero Tavily calls.
- Current Affairs request: one Tavily search then one Gemini call, no independent reviewer call.
- Simulated Gemini failure: Groq fallback successfully returns the batch.
