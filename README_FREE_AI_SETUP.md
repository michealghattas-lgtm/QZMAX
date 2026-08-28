# QZMAX 3.9.0 — Free AI Router

This update replaces the single-provider AI backend with a free-only fallback router.

Default route:

1. Groq Free
2. Cloudflare Workers AI Free (if configured)
3. Gemini Free (if configured)
4. QZMAX source-only local fallback

No paid AI provider is included.

## Important reality about free AI

No external free AI API is unlimited. Each provider can apply request/token/daily quotas. This update avoids depending on one provider and gives QZMAX a final no-API source fallback, but it cannot guarantee unlimited LLM-quality generation.

The local fallback only works when QZMAX has source material, such as Trusted Knowledge/Wikipedia or an uploaded document. It deliberately produces simpler source-grounded questions.

---

# What is included

```
QZMAX_3_9_0_FREE_AI_ROUTER/
├── index.html
├── assets/
├── netlify/
│   └── functions/
│       └── generate.js
├── .env.example
└── README_FREE_AI_SETUP.md
```

The `assets/` folder is the same deployment-ready external-asset structure used by QZMAX 3.8.5.

## Frontend fixes included in 3.9.0

- Modern Standard Arabic True/False now uses `صحيح / خطأ`.
- Egyptian Simple Arabic True/False now uses `صح / غلط`.
- True/False validation no longer requires the provider to literally return the English words `True` and `False`.
- Duplicate fingerprinting is now Unicode-aware, so Arabic question text is not stripped out during duplicate checks.

---

# Step 1 — Back up the live repository

Before replacing files, create a copy of your current repository or make sure your latest GitHub commit is clean so you can revert quickly.

---

# Step 2 — Create a free Groq API key

Groq should be your main provider for this version.

1. Create/sign in to a Groq developer account.
2. Open the API Keys section in the Groq Console.
3. Create a new API key for QZMAX.
4. Copy it somewhere safe.
5. Do NOT put the key in `index.html` or GitHub.

Recommended model used by this package:

`qwen/qwen3.8-27b`

The model can be changed later with the `GROQ_MODEL` Netlify environment variable without editing the code.

---

# Step 3 — Add the Groq key to Netlify

In Netlify:

1. Open your QZMAX project.
2. Go to **Project configuration** / **Site configuration**.
3. Open **Environment variables**.
4. Add:

```
GROQ_API_KEY = your_real_groq_key
```

5. Save it.

Your key remains server-side in the Netlify Function.

For the first live test, this is the only new key you need.

---

# Step 4 — Keep your Gemini key

If your Netlify project already has:

```
GEMINI_API_KEY
```

leave it there.

Gemini is no longer the primary provider. If its free quota has been exhausted, the router simply moves on rather than making QZMAX dependent on it.

The code also recognizes `GOOGLE_API_KEY` if that is the name used by your older backend.

---

# Step 5 — Optional: enable Cloudflare Workers AI free fallback

You can skip this initially. Groq + Gemini + local fallback will still work.

If you want the extra fallback:

1. Create/sign in to a Cloudflare account.
2. Open Workers AI.
3. Choose the REST API setup option.
4. Copy your **Account ID**.
5. Create a Workers AI API token.
6. In Netlify add:

```
CLOUDFLARE_ACCOUNT_ID = your_account_id
CLOUDFLARE_API_TOKEN = your_api_token
```

This package uses the free-eligible model:

`@cf/zai-org/glm-4.7-flash`

Do not enable a paid Workers plan if your goal is to remain free-only. Once the free allocation is exhausted, that route should fail and QZMAX will continue to the next fallback.

---

# Step 6 — Replace the QZMAX files in your local GitHub repository

Using GitHub Desktop, open your local QZMAX repository folder.

Replace:

```
index.html
```

with the new `index.html` from this package.

Then replace:

```
netlify/functions/generate.js
```

with the new `generate.js` from this package.

The new backend is dependency-free and uses Node's built-in `fetch`, so you do not need to install an AI SDK.

If your current repository already has the QZMAX 3.8.5 `/assets/` folder, you can leave it as-is because the packaged assets are the same. Copying this package's `/assets/` folder over it is also fine.

DO NOT delete your existing `netlify.toml`, Firebase configuration, or unrelated Netlify functions.

---

# Step 7 — Optional provider order setting

The built-in order is already:

```
groq,cloudflare,gemini,local
```

You normally do not need to add anything.

If you want to control it from Netlify, add:

```
AI_PROVIDER_ORDER = groq,cloudflare,gemini,local
```

Examples:

Groq then Gemini only:

```
AI_PROVIDER_ORDER = groq,gemini,local
```

Cloudflare first:

```
AI_PROVIDER_ORDER = cloudflare,groq,gemini,local
```

The router automatically skips a provider whose credentials are missing.

---

# Step 8 — Commit and deploy

In GitHub Desktop:

1. Review the changes.
2. Commit with a message such as:

`QZMAX 3.9.0 - Free AI Router`

3. Push to GitHub.
4. Netlify should automatically create a new deploy.
5. Wait for the deploy to show **Published**.

Because the Netlify Function changed, a fresh deployment is required after adding/changing environment variables.

---

# Step 9 — Test the router

Start with a Trusted Knowledge quiz:

- Topic: Ancient Egypt
- Language: English
- Format: Multiple Choice
- Questions: 10
- Options: 4

Then try 30 questions. QZMAX generates larger requests in batches, so this checks multiple backend calls.

Also test:

- Arabic Multiple Choice
- Egyptian Simple Arabic Multiple Choice
- Arabic True / False
- Egyptian Simple Arabic True / False
- Select Multiple
- My Document with a TXT/DOCX/PDF source

## Checking which provider handled the request

Open Netlify -> Functions / Logs and look for lines such as:

```
[QZMAX AI] provider=groq ...
```

or:

```
[QZMAX AI] provider=cloudflare ...
[QZMAX AI] provider=gemini ...
[QZMAX AI] provider=local ...
```

The function also returns an `X-QZMAX-AI-Provider` response header for successful requests.

---

# What happens when a quota is reached

Example:

```
Groq -> 429 / unavailable
       ↓
Cloudflare -> try
       ↓
Gemini -> try
       ↓
Local source fallback -> try
```

A temporary Groq 429/503 is retried once when there is enough request time remaining. If it still fails, the next provider is tried.

The local fallback does not call any AI API. It creates simpler source-grounded questions directly from the Wikipedia/document excerpt QZMAX already retrieved.

---

# If you receive an error after deployment

Check these in order:

1. `GROQ_API_KEY` exists in Netlify and has no extra spaces.
2. A fresh Netlify deploy occurred after adding the variable.
3. `netlify/functions/generate.js` exists in GitHub.
4. Netlify Functions logs show the `generate` invocation.
5. Trusted Knowledge actually retrieved a source before generation.
6. Try a 5-question quiz to rule out token/rate-limit pressure.
7. If using Cloudflare, confirm both the Account ID and API token are present.

For temporary troubleshooting only, set:

```
QZMAX_AI_DEBUG = 1
```

This makes the final backend error include provider failure details. Turn it back to `0` afterward.

---

# Current free-service references checked for this build

- Groq API: https://console.groq.com/docs/api-reference
- Groq rate limits: https://console.groq.com/docs/rate-limits
- Cloudflare Workers AI pricing/free allocation: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Cloudflare GLM-4.7-Flash: https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- Gemini Generate Content REST API: https://ai.google.dev/api/generate-content

These services can change their free limits or available models, which is why the QZMAX router uses environment-variable model overrides rather than hard-wiring the product to one provider forever.
