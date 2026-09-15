'use strict';

// QZMAX 3.18.8 — Fast AI Generator + Conditional Web Grounding
//
// The QZMAX Library is stored content and never enters this function.
// Normal AI Generator requests use ONE free AI provider plus deterministic
// QZMAX structural validation. Current/recent topics are automatically
// grounded with Tavily first, then generated from that evidence.
// Providers are genuine fallbacks only; there is no mandatory model committee.
// Document, Source Link and School modes keep the same free provider pool.

const MAX_BATCH = 20;
const MAX_OPTIONS = 8;
const MAX_PROMPT_CHARS = 60000;
const STANDARD_AI_BUDGET_MS = 32000;
const WEB_GROUNDED_BUDGET_MS = 42000;
const SOURCE_MODE_BUDGET_MS = 42000;
const PROVIDER_CALL_MAX_MS = 15000;

const MODELS = {
  geminiSearch: process.env.GEMINI_SEARCH_MODEL || 'gemini-2.5-flash',
  gemini: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  groqQwen: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
  groqCompound: process.env.GROQ_COMPOUND_MODEL || 'groq/compound',
  groqOss20: process.env.GROQ_GPT_OSS_20B_MODEL || 'openai/gpt-oss-20b',
  groqOss120: process.env.GROQ_GPT_OSS_120B_MODEL || 'openai/gpt-oss-120b',
  cerebras: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
  mistral: process.env.MISTRAL_MODEL || 'mistral-small-latest',
  nvidia: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b',
  sambanova: process.env.SAMBANOVA_MODEL || 'gpt-oss-120b',
  cloudflare: process.env.CLOUDFLARE_MODEL || '@cf/zai-org/glm-4.7-flash',
  openrouter: process.env.OPENROUTER_MODEL || 'openrouter/free',
};

const CUSTOM_DEFAULT_ORDER = [
  'gemini',
  'groq_oss120',
  'cloudflare',
  'mistral',
  'cerebras',
  'nvidia',
  'sambanova',
  'openrouter',
];

const STRICT_DEFAULT_ORDER = [
  'gemini',
  'groq_oss120',
  'cloudflare',
  'mistral',
  'cerebras',
  'nvidia',
  'sambanova',
  'openrouter',
  'local',
];


const ROUTE_COOLDOWNS = new Map();

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalizeRouteName(name) {
  const n = String(name || '').trim().toLowerCase();
  const aliases = {
    google_search:'gemini_search', gemini_search:'gemini_search',
    groq_compound:'groq_compound',
    groq:'groq_qwen', groq_qwen:'groq_qwen',
    cerebras:'cerebras',
    groq_oss20:'groq_oss20', groq_gpt_oss_20b:'groq_oss20',
    mistral:'mistral',
    nvidia:'nvidia', nvidia_nim:'nvidia',
    sambanova:'sambanova',
    cloudflare:'cloudflare',
    openrouter:'openrouter',
    groq_oss120:'groq_oss120', groq_gpt_oss_120b:'groq_oss120',
    gemini:'gemini',
    local:'local',
  };
  return aliases[n] || '';
}

function parseProviderOrder(request) {
  const customAI = request?.sourceType === 'ai' || request?.preferSearch === true;
  let order = (customAI ? CUSTOM_DEFAULT_ORDER : STRICT_DEFAULT_ORDER).slice();

  const raw = String(process.env.AI_PROVIDER_ORDER || '').trim();
  if (raw) {
    const parsed = raw.split(',').map(normalizeRouteName).filter(Boolean);
    if (parsed.length) order = [...new Set(parsed)];
  }

  if (!customAI) {
    order = order.filter(route => !['gemini_search','groq_compound'].includes(route));
  }

  const nonLocal = order.filter(route => route !== 'local');
  // AI Generator always starts from the preferred primary provider. The route
  // moves only after a real failure/cooldown. Source-grounded retry passes may
  // still rotate so a long document does not repeatedly hit one free quota.
  const attempt = Math.max(0, Number(request?.generationAttempt) || 0);
  if (!customAI && nonLocal.length && attempt) {
    const shift = attempt % nonLocal.length;
    order = nonLocal.slice(shift).concat(nonLocal.slice(0, shift));
  } else {
    order = nonLocal;
  }

  if (!customAI) order.push('local');
  return [...new Set(order)];
}

function routeProvider(route) {
  return {
    gemini_search:'Google Gemini Search',
    groq_compound:'Groq Web Search',
    groq_qwen:'Groq',
    cerebras:'Cerebras',
    groq_oss20:'Groq',
    mistral:'Mistral',
    nvidia:'NVIDIA NIM',
    sambanova:'SambaNova',
    cloudflare:'Cloudflare',
    openrouter:'OpenRouter Free',
    groq_oss120:'Groq',
    gemini:'Google Gemini',
    local:'Local Source Fallback',
  }[route] || route;
}

function routeModel(route) {
  return {
    gemini_search:MODELS.geminiSearch,
    groq_compound:MODELS.groqCompound,
    groq_qwen:MODELS.groqQwen,
    cerebras:MODELS.cerebras,
    groq_oss20:MODELS.groqOss20,
    mistral:MODELS.mistral,
    nvidia:MODELS.nvidia,
    sambanova:MODELS.sambanova,
    cloudflare:MODELS.cloudflare,
    openrouter:MODELS.openrouter,
    groq_oss120:MODELS.groqOss120,
    gemini:MODELS.gemini,
    local:'source-fallback',
  }[route] || '';
}

function configuredRoutes() {
  return {
    tavily_verification: !!process.env.TAVILY_API_KEY,
    tavily_extract: !!process.env.TAVILY_API_KEY,
    gemini_search: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    groq_compound: !!process.env.GROQ_API_KEY,
    groq_qwen: !!process.env.GROQ_API_KEY,
    cerebras: !!process.env.CEREBRAS_API_KEY,
    groq_oss20: !!process.env.GROQ_API_KEY,
    mistral: !!process.env.MISTRAL_API_KEY,
    nvidia: !!process.env.NVIDIA_API_KEY,
    sambanova: !!process.env.SAMBANOVA_API_KEY,
    cloudflare: !!(process.env.CLOUDFLARE_ACCOUNT_ID && (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AUTH_TOKEN)),
    openrouter: !!process.env.OPENROUTER_API_KEY,
    groq_oss120: !!process.env.GROQ_API_KEY,
    gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    local: true,
  };
}

function routeOnCooldown(route) {
  const until = ROUTE_COOLDOWNS.get(route) || 0;
  if (until <= Date.now()) {
    ROUTE_COOLDOWNS.delete(route);
    return false;
  }
  return true;
}

function markRouteCooldown(route, err) {
  if (!err || ![429, 503, 529].includes(err.status)) return;
  const requestedMs = Number(err.retryAfter || 0) * 1000;
  const fallbackMs = err.status === 429 ? 30000 : 12000;
  ROUTE_COOLDOWNS.set(
    route,
    Date.now() + Math.max(4000, Math.min(120000, requestedMs || fallbackMs))
  );
}

function stripCodeFences(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractBalancedJson(text) {
  const src = stripCodeFences(text);
  if (!src) throw new Error('Empty AI response.');
  try { return JSON.parse(src); } catch (_) {}

  const firstArray = src.indexOf('[');
  const lastArray = src.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    try { return JSON.parse(src.slice(firstArray, lastArray + 1)); } catch (_) {}
  }

  const firstObj = src.indexOf('{');
  const lastObj = src.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) {
    try { return JSON.parse(src.slice(firstObj, lastObj + 1)); } catch (_) {}
  }
  throw new Error('AI returned invalid JSON.');
}

function normalizeQuestionPayload(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
  if (parsed && Array.isArray(parsed.items)) return parsed.items;
  if (parsed && parsed.response) {
    if (Array.isArray(parsed.response)) return parsed.response;
    if (Array.isArray(parsed.response.questions)) return parsed.response.questions;
  }
  return [];
}

function normalizedIndexArray(item, optionsLength) {
  const raw = Array.isArray(item.correctIndexes)
    ? item.correctIndexes
    : Array.isArray(item.correct_indices)
      ? item.correct_indices
      : [];
  return [...new Set(raw.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < optionsLength))]
    .sort((a, b) => a - b);
}


function cleanDocumentQuestionFraming(value) {
  let q = String(value || '').trim();
  const patterns = [
    /^(?:according\s+to|based\s+on)\s+(?:the\s+)?(?:source|text|document|passage|material|uploaded\s+document)\s*[:,\-–—]?\s*/i,
    /^from\s+(?:the\s+)?(?:source|text|document|passage|material|uploaded\s+document)\s*[:,\-–—]?\s*/i,
    /^(?:as\s+stated|as\s+described|as\s+mentioned)\s+in\s+(?:the\s+)?(?:source|text|document|passage)\s*[:,\-–—]?\s*/i,
    /^(?:حسب|بحسب)\s+(?:المصدر|النص|الوثيقة|المستند)\s*[،,:؛\-–—]?\s*/u,
    /^وفق[ًااً]+\s+(?:للمصدر|للنص|للوثيقة|للمستند)\s*[،,:؛\-–—]?\s*/u,
    /^استناد[ًااً]+\s+(?:إلى|الى)\s+(?:المصدر|النص|الوثيقة|المستند)\s*[،,:؛\-–—]?\s*/u,
    /^من\s+(?:المصدر|النص|الوثيقة|المستند)\s*[،,:؛\-–—]?\s*/u
  ];
  for (const pattern of patterns) q = q.replace(pattern, '').trim();
  return q;
}


const LINK_EVIDENCE_STOPWORDS = new Set([
  'what','which','who','whom','whose','when','where','why','how','does','did','was','were','are','is',
  'the','a','an','of','to','in','on','for','from','with','and','or','as','by','at','into','about',
  'after','before','this','that','these','those','according','source','page','link',
  'ما','ماذا','من','متى','أين','اين','كيف','لماذا','هل','هو','هي','في','إلى','الى','على','عن','مع','و','أو','او','الذي','التي','هذا','هذه'
]);

function linkEvidenceTokens(value) {
  return normalizeEvidenceText(value)
    .split(' ')
    .filter(t => t.length >= 3 && !LINK_EVIDENCE_STOPWORDS.has(t));
}

function splitLinkEvidenceUnits(source) {
  return String(source || '')
    .replace(/\r/g,'')
    .split(/\n+|(?<=[.!?؟])\s+/u)
    .map(s => s.replace(/^#{1,6}\s+/,'').replace(/\s+/g,' ').trim())
    .filter(s => s.length >= 35 && s.length <= 700);
}

function recoverLinkEvidence(raw, question, options, request) {
  if (request.questionType !== 'multiple_choice') return '';

  const idx = Number.parseInt(raw?.correctIndex,10);
  if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) return '';

  const answerNorm = normalizeEvidenceText(options[idx]);
  if (answerNorm.length < 2) return '';

  const qTokens = linkEvidenceTokens(question);
  let best = null;

  for (const unit of splitLinkEvidenceUnits(request.sourceEvidenceText || '')) {
    const unitNorm = normalizeEvidenceText(unit);
    if (!unitNorm.includes(answerNorm)) continue;

    let overlap = 0;
    for (const token of qTokens) if (unitNorm.includes(token)) overlap++;

    const minOverlap = qTokens.length >= 4 ? 2 : 1;
    if (overlap < minOverlap) continue;

    const score = overlap * 10 + Math.min(10, answerNorm.length / 4);
    if (!best || score > best.score) best = {unit,score};
  }

  return best ? best.unit.slice(0,600) : '';
}

function validateQuestions(items, request) {
  const { count, optsPerQ, questionType } = request;
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw || typeof raw.question !== 'string') continue;
    let question = raw.question.trim();
    if (request.sourceType === 'document' || request.sourceType === 'link') {
      question = cleanDocumentQuestionFraming(question);
    }
    const options = Array.isArray(raw.options) ? raw.options.map(v => String(v).trim()).filter(Boolean) : [];
    if (!question || options.length < 2) continue;
    if (new Set(options.map(v => v.toLocaleLowerCase())).size !== options.length) continue;

    const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim() : '';
    let sourceEvidence = typeof raw.sourceEvidence === 'string' ? raw.sourceEvidence.trim().slice(0, 600) : '';
    const sourcePage = raw.sourcePage == null ? '' : String(raw.sourcePage).trim().slice(0, 80);
    const sourceId = raw.sourceId == null ? '' : String(raw.sourceId).trim().slice(0, 30);
    const sourceUrl = raw.sourceUrl == null ? '' : String(raw.sourceUrl).trim().slice(0, 1000);
    const sourceTitle = raw.sourceTitle == null ? '' : String(raw.sourceTitle).trim().slice(0, 300);
    const category = raw.category == null ? '' : String(raw.category).trim().slice(0, 120);
    const factKey = raw.factKey == null ? '' : String(raw.factKey).trim().slice(0, 240);

    if (request.sourceType === 'link') {
      const sourceNorm = normalizeEvidenceText(request.sourceEvidenceText || '');
      let evidenceNorm = normalizeEvidenceText(sourceEvidence);

      if (evidenceNorm.length < 18 || !sourceNorm || !sourceNorm.includes(evidenceNorm)) {
        const recovered = recoverLinkEvidence(raw, question, options, request);
        if (!recovered) continue;
        sourceEvidence = recovered;
        evidenceNorm = normalizeEvidenceText(sourceEvidence);
      }

      if (evidenceNorm.length < 18 || !sourceNorm.includes(evidenceNorm)) continue;
    }

    if (questionType === 'true_false') {
      const correctIndex = Number.parseInt(raw.correctIndex, 10);
      if (options.length !== 2 || ![0, 1].includes(correctIndex)) continue;
      out.push({ question, options, correctIndex, explanation, sourceEvidence, sourcePage, sourceId, sourceUrl, sourceTitle, category, factKey });
    } else if (questionType === 'multiple_correct') {
      if (options.length > MAX_OPTIONS) continue;
      const correctIndexes = normalizedIndexArray(raw, options.length);
      if (correctIndexes.length < 2) continue;
      out.push({
        question,
        options,
        correctIndexes,
        correctIndex: correctIndexes[0],
        explanation,
        sourceEvidence,
        sourcePage,
        sourceId,
        sourceUrl,
        sourceTitle,
        category,
        factKey,
      });
    } else {
      const correctIndex = Number.parseInt(raw.correctIndex, 10);
      if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) continue;
      if (optsPerQ >= 2 && options.length > MAX_OPTIONS) continue;
      out.push({ question, options, correctIndex, explanation, sourceEvidence, sourcePage, sourceId, sourceUrl, sourceTitle, category, factKey });
    }
    if (out.length >= count) break;
  }
  return out;
}

function schemaInstruction({ count, optsPerQ, questionType }) {
  const common = [
    `Return exactly ${count} quiz questions.`,
    'Return ONLY one valid JSON object with a top-level array named "questions".',
    'Every question object must contain: question, options, correctIndex, explanation.',
    'Keep question stems and options concise. Keep each explanation to one short sentence (about 35 words or fewer) so large quiz batches return quickly.',
    'When source material is supplied, include sourceEvidence as a short exact supporting phrase copied from the source.',
    'When web evidence IDs are supplied, also include sourceId, sourceUrl and sourceTitle exactly as provided for the source that proves the answer.',
    'Do not wrap JSON in Markdown fences.',
  ];

  if (Array.isArray(arguments[0]?.coverageCategories) && arguments[0].coverageCategories.length) {
    common.push('Every question must contain a category field exactly matching one of these values: '+arguments[0].coverageCategories.join(' | ')+'.');
    common.push('Use each requested category once before repeating a category.');
  }

  if (questionType === 'multiple_correct') {
    common.push(`Each question must contain exactly ${optsPerQ} options.`);
    common.push('Each question must contain correctIndexes with at least TWO zero-based correct indexes, plus correctIndex equal to the first correctIndexes value.');
  } else if (questionType === 'true_false') {
    common.push('Each question must contain exactly two options in the order requested by the user prompt and correctIndex must be 0 or 1.');
  } else {
    common.push(`Each question must contain exactly ${optsPerQ} options and exactly one correctIndex.`);
  }
  return common.join('\n');
}

function brainPuzzleSystemInstruction(request) {
  const s = request?.structuredScope || {};
  const combined = [s.category, s.topic, request?.originalTopic, request?.topic]
    .filter(Boolean).join(' ').toLowerCase();
  if (!/(brain puzzles|brain puzzle|riddles|riddle|brain teasers|brain teaser|lateral thinking)/.test(combined)) return '';
  const language = String(request?.questionLanguage || 'the requested language').trim();
  return [
    'RIDDLE / BRAIN-TEASER QUALITY GATE:',
    'Keep each puzzle concise and solvable from its own clues.',
    'For multiple-choice items, every distractor must be a plausible near-miss in the SAME answer class as the correct answer, not random filler.',
    'Each wrong option should satisfy some clues but fail at least one decisive clue; exactly one option must satisfy the complete riddle.',
    'Keep answer choices naturally similar in wording, specificity and length so the correct answer is not visually obvious.',
    'Silently test every option against every clue. If more than one answer is defensible, rewrite the riddle or the options before returning JSON.',
    'Prefer original wording and fresh clue combinations instead of reproducing distinctive published riddles.',
    'For wordplay, create a puzzle that works natively in '+language+'; do not translate English-only spelling or sound tricks that stop working in the requested language.'
  ].join(' ');
}

function buildMessages(request) {
  const system = [
    'You are the QZMAX quiz-generation engine.',
    'Follow the current host scope, language, format, difficulty, coverage, and same-topic fact-avoidance instructions in the user prompt exactly.',
    'Never infer subject matter from prior requests; only the current request is authoritative.',
    'For ordinary AI generation, use established knowledge and silently self-check every question before returning it. If you are not highly confident that exactly one configured answer is defensible, replace that question with a safer fact.',
    brainPuzzleSystemInstruction(request),
    'Never invent a fact that is not supported when the prompt contains source material or a web evidence pack.',
    structuredScopeText(request) ? 'STRUCTURED HOST SCOPE — TREAT EVERY POPULATED FIELD AS REQUIRED: '+structuredScopeText(request) : '',
    'When generating from supplied source material, write natural stand-alone question stems. Never start visible questions with "According to the source", "According to the text", "According to the document", "Based on the source", "From the text", or equivalent source-referencing phrases.',
    schemaInstruction(request),
  ].filter(Boolean).join('\n\n');

  const userPrompt = String(request.topic || request.originalTopic || '').slice(0, MAX_PROMPT_CHARS);
  return [
    { role: 'system', content: system },
    { role: 'user', content: userPrompt },
  ];
}


async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorResponse(res) {
  let data = null;
  let text = '';
  try {
    text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch (_) {}
  const message =
    data?.error?.message ||
    data?.errors?.[0]?.message ||
    data?.message ||
    text ||
    `${res.status} ${res.statusText}`;

  const err = new Error(String(message).slice(0, 1200));
  err.status = res.status;
  err.retryAfter = Number.parseFloat(res.headers.get('retry-after') || '0') || 0;
  return err;
}

async function maybeRetry(call, deadline, providerName) {
  try {
    return await call();
  } catch (err) {
    const retryable = err && [429,503,529].includes(err.status);
    const suggestedMs = Number(err?.retryAfter || 0) * 1000;
    const waitMs = Math.min(3500, Math.max(600, suggestedMs || 900));
    if (!retryable || Date.now() + waitMs + 1300 >= deadline) throw err;
    console.warn(`[QZMAX AI] ${providerName} temporary limit; one retry in ${waitMs}ms.`);
    await sleep(waitMs);
    return call();
  }
}

async function callOpenAICompatible({
  providerName, url, key, model, messages, deadline,
  responseFormat = false, extraHeaders = {}, extraBody = {}
}) {
  if (!key) throw Object.assign(new Error(`${providerName} key is not configured.`), { skip:true });
  const remaining = deadline - Date.now();
  if (remaining < 1800) throw Object.assign(new Error('Request time budget exhausted.'), { timeout:true });
  const timeout = Math.max(1600, Math.min(PROVIDER_CALL_MAX_MS, remaining - 500));

  const doCall = async () => {
    const body = {
      model,
      messages,
      temperature: 0.2,
      max_tokens: 6000,
      stream: false,
      ...extraBody,
    };
    if (responseFormat) body.response_format = { type:'json_object' };

    const res = await fetchWithTimeout(url, {
      method:'POST',
      headers:{
        'Authorization':`Bearer ${key}`,
        'Content-Type':'application/json',
        ...extraHeaders,
      },
      body:JSON.stringify(body),
    }, timeout);

    if (!res.ok) throw await readErrorResponse(res);
    const data = await res.json();
    const text =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      '';
    return normalizeQuestionPayload(extractBalancedJson(text));
  };

  return maybeRetry(doCall, deadline, providerName);
}

async function callGroq(messages, deadline, model, label, responseFormat=true) {
  return callOpenAICompatible({
    providerName:label,
    url:'https://api.groq.com/openai/v1/chat/completions',
    key:process.env.GROQ_API_KEY,
    model,
    messages,
    deadline,
    responseFormat,
  });
}

async function callCerebras(messages, deadline) {
  return callOpenAICompatible({
    providerName:'Cerebras',
    url:'https://api.cerebras.ai/v1/chat/completions',
    key:process.env.CEREBRAS_API_KEY,
    model:MODELS.cerebras,
    messages,
    deadline,
    responseFormat:false,
  });
}

async function callMistral(messages, deadline) {
  return callOpenAICompatible({
    providerName:'Mistral',
    url:'https://api.mistral.ai/v1/chat/completions',
    key:process.env.MISTRAL_API_KEY,
    model:MODELS.mistral,
    messages,
    deadline,
    responseFormat:true,
  });
}

async function callNvidia(messages, deadline) {
  return callOpenAICompatible({
    providerName:'NVIDIA NIM',
    url:'https://integrate.api.nvidia.com/v1/chat/completions',
    key:process.env.NVIDIA_API_KEY,
    model:MODELS.nvidia,
    messages,
    deadline,
    responseFormat:false,
    extraBody:{
      max_tokens:5000,
      top_p:0.85,
    },
  });
}

async function callSambaNova(messages, deadline) {
  return callOpenAICompatible({
    providerName:'SambaNova',
    url:'https://api.sambanova.ai/v1/chat/completions',
    key:process.env.SAMBANOVA_API_KEY,
    model:MODELS.sambanova,
    messages,
    deadline,
    responseFormat:true,
  });
}

async function callOpenRouter(messages, deadline) {
  const extraHeaders = { 'X-Title':'QZMAX' };
  if (process.env.QZMAX_SITE_URL) extraHeaders['HTTP-Referer'] = process.env.QZMAX_SITE_URL;
  return callOpenAICompatible({
    providerName:'OpenRouter Free',
    url:'https://openrouter.ai/api/v1/chat/completions',
    key:process.env.OPENROUTER_API_KEY,
    model:MODELS.openrouter,
    messages,
    deadline,
    responseFormat:false,
    extraHeaders,
  });
}

async function callCloudflare(messages, deadline) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AUTH_TOKEN;
  if (!accountId || !token) {
    throw Object.assign(new Error('Cloudflare Workers AI credentials are not configured.'), { skip:true });
  }

  const remaining = deadline - Date.now();
  if (remaining < 1800) throw Object.assign(new Error('Request time budget exhausted.'), { timeout:true });
  const timeout = Math.max(1600, Math.min(PROVIDER_CALL_MAX_MS, remaining - 500));
  const modelPath = MODELS.cloudflare
    .split('/')
    .map(encodeURIComponent)
    .join('/')
    .replace('%40cf','@cf');
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${modelPath}`;

  const doCall = async () => {
    const res = await fetchWithTimeout(url, {
      method:'POST',
      headers:{
        'Authorization':`Bearer ${token}`,
        'Content-Type':'application/json',
      },
      body:JSON.stringify({
        messages,
        temperature:0.2,
        max_completion_tokens:5000,
      }),
    }, timeout);

    if (!res.ok) throw await readErrorResponse(res);
    const data = await res.json();
    const result = data?.result ?? data;

    if (result && (Array.isArray(result.questions) || Array.isArray(result))) {
      return normalizeQuestionPayload(result);
    }

    const text =
      (typeof result?.response === 'string' && result.response) ||
      (typeof result?.text === 'string' && result.text) ||
      result?.choices?.[0]?.message?.content ||
      data?.response ||
      '';

    return normalizeQuestionPayload(extractBalancedJson(text));
  };

  return maybeRetry(doCall, deadline, 'Cloudflare Workers AI');
}

async function callGemini(messages, deadline, search=false) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw Object.assign(new Error('Gemini key is not configured.'), { skip:true });

  const model = search ? MODELS.geminiSearch : MODELS.gemini;
  const remaining = deadline - Date.now();
  if (remaining < 1800) throw Object.assign(new Error('Request time budget exhausted.'), { timeout:true });
  const timeout = Math.max(1600, Math.min(PROVIDER_CALL_MAX_MS, remaining - 500));
  const prompt = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const doCall = async () => {
    const body = {
      contents:[{ role:'user', parts:[{ text:prompt }] }],
      generationConfig:{
        temperature:0.2,
      },
    };

    // Search-grounded Gemini can reject strict JSON MIME mode with tools,
    // so the prompt enforces JSON and QZMAX parses the result.
    if (search) {
      body.tools = [{ google_search:{} }];
    } else {
      body.generationConfig.responseMimeType = 'application/json';
    }

    const res = await fetchWithTimeout(url, {
      method:'POST',
      headers:{
        'x-goog-api-key':key,
        'Content-Type':'application/json',
      },
      body:JSON.stringify(body),
    }, timeout);

    if (!res.ok) throw await readErrorResponse(res);
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p?.text || '').join('').trim();
    return normalizeQuestionPayload(extractBalancedJson(text));
  };

  return maybeRetry(doCall, deadline, search ? 'Gemini + Google Search' : 'Gemini');
}

function getLanguageLabels(language) {
  if (language === 'Egyptian Simple Arabic') {
    return {
      trueFalse: ['صح', 'غلط'],
      cloze: 'إيه الاختيار اللي بيكمّل الجملة دي صح؟',
      trueQuestion: 'هل الجملة دي صحيحة؟',
      multiple: 'اختار كل الإجابات اللي موجودة في العبارة دي:',
      explanation: 'الدليل:',
    };
  }
  if (language === 'Arabic') {
    return {
      trueFalse: ['صحيح', 'خطأ'],
      cloze: 'أي اختيار يُكمل العبارة التالية بشكل صحيح؟',
      trueQuestion: 'هل العبارة التالية صحيحة؟',
      multiple: 'اختر جميع الإجابات التي تظهر في العبارة التالية:',
      explanation: 'الدليل:',
    };
  }
  return {
    trueFalse: ['True', 'False'],
    cloze: 'Which option correctly completes this statement?',
    trueQuestion: 'Is this statement correct?',
    multiple: 'Select all options that appear in this statement:',
    explanation: 'Supporting evidence:',
  };
}

function extractSourceMaterial(topic) {
  const text = String(topic || '');
  const markers = ['EXTRACTED SOURCE CONTENT:','SOURCE MATERIAL:'];
  let marker = '';
  let i = -1;

  for (const candidate of markers) {
    const found = text.indexOf(candidate);
    if (found >= 0 && (i < 0 || found < i)) {
      marker = candidate;
      i = found;
    }
  }

  if (i < 0) return '';
  let source = text.slice(i + marker.length);
  const endMarkers = [
    '\n\nSAME-TOPIC FACTS ALREADY USED:',
    '\n\nDO NOT repeat',
    '\n\nCreate distinct questions',
    '\n\nGENERATION VARIATION TOKEN:',
    '\n\nReturn clean JSON',
  ];
  for (const endMarker of endMarkers) {
    const e = source.indexOf(endMarker);
    if (e >= 0) source = source.slice(0, e);
  }
  return source.replace(/\s+/g, ' ').trim().slice(0, 18000);
}

const STOPWORDS = new Set([
  'this','that','these','those','with','from','into','about','which','their','there','where','when','were','was','have','has','had','been','being','also','than','then','they','them','such','some','more','most','many','much','over','under','between','through','during','before','after','because','while','would','could','should','what','who','whose','your','ours','theirs','and','for','the','are','its','not','but','can','may','one','two','three','four','five',
  'هذا','هذه','ذلك','تلك','التي','الذي','الذين','من','إلى','على','في','عن','مع','كان','كانت','يكون','كما','وقد','بعد','قبل','بين','أو','ثم','كل','أي','هو','هي','هم','أن','إن','ما','لا','لم','لن','تم','عند','حتى','ضمن'
]);

function sentenceSplit(source) {
  return source
    .replace(/\[[^\]]{0,80}\]/g, ' ')
    .split(/(?<=[.!?؟])\s+|\s*\n+\s*/u)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 45 && s.length <= 420)
    .filter(s => /[\p{L}\p{N}]/u.test(s));
}

function candidateTerms(sentence) {
  const found = [];
  const seen = new Set();
  const add = value => {
    const v = String(value || '').trim().replace(/^[\s,;:()]+|[\s,;:()]+$/g, '');
    if (v.length < 3 || v.length > 70) return;
    const key = v.toLocaleLowerCase();
    if (seen.has(key) || STOPWORDS.has(key)) return;
    if (!/[\p{L}\p{N}]/u.test(v)) return;
    seen.add(key); found.push(v);
  };

  // Dates and numbers are usually excellent source-grounded answers.
  for (const m of sentence.matchAll(/\b(?:\d{1,4}(?:[.,]\d+)?%?|\d{4})\b/g)) add(m[0]);

  // Proper-name-like Latin phrases.
  for (const m of sentence.matchAll(/\b[A-Z][\p{L}\p{M}'’\-]*(?:\s+[A-Z][\p{L}\p{M}'’\-]*){0,3}\b/gu)) add(m[0]);

  // General Unicode words as a fallback, preferring longer content words.
  const words = sentence.match(/[\p{L}\p{M}][\p{L}\p{M}'’\-]{3,}/gu) || [];
  words.sort((a, b) => b.length - a.length);
  for (const word of words) add(word);
  return found.slice(0, 12);
}

function termKind(term) {
  return /^\d/.test(term) ? 'number' : 'text';
}

function shuffled(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sourceFallback(request) {
  const source = extractSourceMaterial(request.topic);
  if (!source) return [];
  const sentences = sentenceSplit(source);
  if (!sentences.length) return [];
  const labels = getLanguageLabels(request.questionLanguage);
  const pools = { number: [], text: [] };
  const sentenceData = sentences.map(sentence => {
    const terms = candidateTerms(sentence);
    for (const term of terms) pools[termKind(term)].push(term);
    return { sentence, terms };
  }).filter(x => x.terms.length);

  pools.number = [...new Set(pools.number)];
  pools.text = [...new Set(pools.text)];
  const out = [];

  for (let i = 0; i < sentenceData.length && out.length < request.count; i++) {
    const { sentence, terms } = sentenceData[i];
    if (request.questionType === 'true_false') {
      out.push({
        question: `${labels.trueQuestion}\n“${sentence}”`,
        options: labels.trueFalse,
        correctIndex: 0,
        explanation: `${labels.explanation} “${sentence}”`,
        sourceEvidence: sentence.slice(0, 600),
      });
      continue;
    }

    if (request.questionType === 'multiple_correct') {
      const correctTerms = [...new Set(terms)].slice(0, Math.min(2, request.optsPerQ));
      if (correctTerms.length < 2) continue;
      const kind = termKind(correctTerms[0]);
      const lowerSentence = sentence.toLocaleLowerCase();
      const distractors = shuffled(pools[kind].filter(t =>
        !correctTerms.some(c => c.toLocaleLowerCase() === t.toLocaleLowerCase()) &&
        !lowerSentence.includes(t.toLocaleLowerCase())
      )).slice(0, Math.max(0, request.optsPerQ - correctTerms.length));
      if (correctTerms.length + distractors.length < request.optsPerQ) continue;
      const tagged = [
        ...correctTerms.map(v => ({ v, c: true })),
        ...distractors.map(v => ({ v, c: false })),
      ];
      const mixed = shuffled(tagged);
      const options = mixed.map(x => x.v);
      const correctIndexes = mixed.map((x, idx) => x.c ? idx : -1).filter(idx => idx >= 0).sort((a,b)=>a-b);
      out.push({
        question: `${labels.multiple}\n“${sentence}”`,
        options,
        correctIndexes,
        correctIndex: correctIndexes[0],
        explanation: `${labels.explanation} “${sentence}”`,
        sourceEvidence: sentence.slice(0, 600),
      });
      continue;
    }

    const answer = terms[0];
    const kind = termKind(answer);
    const lowerSentence = sentence.toLocaleLowerCase();
    const distractors = shuffled(pools[kind].filter(t =>
      t.toLocaleLowerCase() !== answer.toLocaleLowerCase() &&
      !lowerSentence.includes(t.toLocaleLowerCase())
    )).slice(0, Math.max(1, request.optsPerQ - 1));
    if (distractors.length < request.optsPerQ - 1) continue;
    const blanked = sentence.replace(answer, '____');
    if (blanked === sentence) continue;
    const mixed = shuffled([answer, ...distractors.slice(0, request.optsPerQ - 1)]);
    const correctIndex = mixed.findIndex(v => v === answer);
    out.push({
      question: `${labels.cloze}\n“${blanked}”`,
      options: mixed,
      correctIndex,
      explanation: `${labels.explanation} “${sentence}”`,
      sourceEvidence: sentence.slice(0, 600),
    });
  }
  return out;
}



const TAVILY_CACHE = new Map();
const TAVILY_CACHE_TTL_MS = 15 * 60 * 1000;

function normalizeEvidenceText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function sanitizeStructuredScope(value) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const field = (name,max=240) => String(src[name] || '').replace(/\s+/g,' ').trim().slice(0,max);
  return {
    mode:field('mode',40),
    category:field('category'),
    topic:field('topic',500),
    region:field('region'),
    timePeriod:field('timePeriod'),
    focus:field('focus',600),
    difficulty:field('difficulty',80),
    year:field('year',80),
    subject:field('subject',200)
  };
}

function structuredScopeText(request) {
  const s = request?.structuredScope || {};
  return [
    s.category ? `Category: ${s.category}` : '',
    s.topic ? `Topic: ${s.topic}` : '',
    s.region ? `Country / Region: ${s.region}` : '',
    s.timePeriod ? `Time period: ${s.timePeriod}` : '',
    s.focus ? `Specific focus: ${s.focus}` : '',
    s.year ? `Year level: ${s.year}` : '',
    s.subject ? `Subject: ${s.subject}` : '',
    s.difficulty ? `Difficulty: ${s.difficulty}` : ''
  ].filter(Boolean).join(' | ');
}

function structuredSearchScope(request) {
  const s = request?.structuredScope || {};
  return [
    s.topic,
    s.category && s.category !== 'General Knowledge' ? s.category : '',
    s.region,
    s.timePeriod,
    s.focus
  ].filter(Boolean).join(' ');
}

function shouldUseWebGrounding(request) {
  if (request?.sourceType !== 'ai') return false;
  if (request?.webGrounding === true || request?.preferSearch === true) return true;

  const s = request?.structuredScope || {};
  const year = String(new Date().getUTCFullYear());
  const combined = normalizeEvidenceText([
    request?.originalTopic || request?.topic,
    s.category,
    s.topic,
    s.region,
    s.timePeriod,
    s.focus
  ].filter(Boolean).join(' '));

  if (!combined) return false;
  if (normalizeEvidenceText(s.category) === 'current affairs') return true;

  const dynamicEnglish = [
    'current affairs','latest','today','tonight','this week','this month','this year',
    'recent','recently','right now','news','breaking','live score','latest score','results today',
    'current president','current prime minister','current government','current ranking','current standings',
    'current price','market price','stock price','exchange rate','box office','ongoing','present day'
  ];
  const dynamicArabic = [
    'أخبار','اخبار','أحدث','احدث','حاليا','حاليًا','النهاردة','النهارده','اليوم','دلوقتي',
    'هذا الأسبوع','هذا الاسبوع','الشهر الحالي','السنة الحالية','السنه الحاليه','نتيجة اليوم','نتيجه اليوم',
    'الترتيب الحالي','السعر الحالي','الرئيس الحالي','رئيس الوزراء الحالي'
  ].map(normalizeEvidenceText);

  if (dynamicEnglish.some(term => combined.includes(normalizeEvidenceText(term)))) return true;
  if (dynamicArabic.some(term => combined.includes(term))) return true;

  // A host-entered current year normally signals time-sensitive content. Historical
  // ranges containing an older year are not grounded merely because they have dates.
  if (new RegExp('(?:^|\\s)'+year+'(?:\\s|$)').test(combined)) return true;
  if (/\b(?:present|present day|ongoing)\b/.test(combined)) return true;
  return false;
}

function evidencePackText(evidence) {
  return (evidence || []).map(src =>
    `[${src.id}]\nTITLE: ${src.title}\nURL: ${src.url}\nCONTENT: ${src.content}`
  ).join('\n\n---\n\n');
}

async function fetchTavilyEvidence(request, deadline) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    throw Object.assign(
      new Error('TAVILY_API_KEY is required for factual AI grounding.'),
      { status:503 }
    );
  }

  const queryParts = request.generalKnowledge && Array.isArray(request.coverageCategories) && request.coverageCategories.length
    ? [
        'reliable factual reference',
        request.coverageCategories.join(' '),
        request.structuredScope?.region || '',
        request.structuredScope?.timePeriod || ''
      ]
    : [
        structuredSearchScope(request),
        String(request.originalTopic || request.topic || '')
      ];
  const query = queryParts
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
  if (!query) throw new Error('No usable topic was supplied for web verification.');

  const cacheKey = normalizeEvidenceText(query);
  const cached = TAVILY_CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.savedAt) < TAVILY_CACHE_TTL_MS) {
    return cached.evidence;
  }

  const remaining = deadline - Date.now();
  if (remaining < 2500) throw new Error('Not enough request time remained for web verification.');

  const res = await fetchWithTimeout('https://api.tavily.com/search', {
    method:'POST',
    headers:{
      'Authorization':`Bearer ${key}`,
      'Content-Type':'application/json',
    },
    body:JSON.stringify({
      query,
      search_depth:'basic',
      max_results:10,
      topic:'general',
      include_answer:false,
      include_raw_content:false,
      include_images:false,
      auto_parameters:false,
      safe_search:true
    }),
  }, Math.max(1800, Math.min(8000, remaining - 700)));

  if (!res.ok) throw await readErrorResponse(res);
  const data = await res.json();
  const evidence = (Array.isArray(data?.results) ? data.results : [])
    .filter(r => r && r.url && (r.content || r.title))
    .slice(0, 10)
    .map((r, i) => ({
      id:`S${i+1}`,
      title:String(r.title || '').trim().slice(0, 300),
      url:String(r.url || '').trim().slice(0, 1000),
      content:String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, 2400),
      score:Number(r.score || 0)
    }))
    .filter(r => r.content.length >= 40);

  if (evidence.length < 2) {
    throw new Error('QZMAX could not find enough relevant web evidence to safely generate this topic.');
  }

  TAVILY_CACHE.set(cacheKey, {savedAt:Date.now(), evidence});
  return evidence;
}

function buildWebEvidenceMessages(baseMessages, request, evidence) {
  const pack = evidencePackText(evidence);
  const webRule = [
    'QZMAX WEB-VERIFIED MODE — MANDATORY RULES:',
    structuredScopeText(request) ? 'STRUCTURED HOST SCOPE: '+structuredScopeText(request) : '',
    'Use ONLY the WEB EVIDENCE PACK below for factual claims. Do not use memory or unsupported outside knowledge.',
    'Every question must satisfy every populated structured scope field and be directly supported by one evidence source.',
    'For EACH question return sourceId, sourceUrl, sourceTitle and sourceEvidence.',
    'sourceId/sourceUrl/sourceTitle must exactly match one source below.',
    'sourceEvidence should be a short copied supporting phrase from that source CONTENT. Exact copying is preferred; QZMAX will anchor it back to the selected source during deterministic validation.',
    'The evidence must establish the named entity and relationship asked by the question — not merely mention the same people, work, year or topic.',
    'If the evidence does not support a safe question, do not invent one.',
    'Do not infer a cast member, release year, singer, album, director, character, award, quotation or relationship unless the evidence explicitly establishes it.',
    'For translated visible answers, keep the factual identity identical to the cited source.',
    'WEB EVIDENCE PACK:',
    pack
  ].filter(Boolean).join('\n');

  return [...baseMessages, {role:'user', content:webRule}];
}

function evidenceWords(value) {
  return normalizeEvidenceText(value)
    .split(' ')
    .filter(word => word.length >= 3 && !LINK_EVIDENCE_STOPWORDS.has(word));
}

function recoverWebEvidenceSnippet(item, source) {
  const units = splitLinkEvidenceUnits(`${source.title}. ${source.content}`);
  if (!units.length) return String(source.content || '').slice(0,600);

  const requested = evidenceWords(item.sourceEvidence || '');
  const questionWords = evidenceWords(item.question || '');
  const options = Array.isArray(item.options) ? item.options : [];
  const idx = Number.parseInt(item.correctIndex,10);
  const answerWords = Number.isInteger(idx) && idx >= 0 && idx < options.length
    ? evidenceWords(options[idx])
    : [];

  let best = null;
  for (const unit of units) {
    const norm = normalizeEvidenceText(unit);
    const words = new Set(norm.split(' '));
    const quoteOverlap = requested.filter(w => words.has(w)).length;
    const qOverlap = questionWords.filter(w => words.has(w)).length;
    const aOverlap = answerWords.filter(w => words.has(w)).length;
    const score = quoteOverlap * 6 + qOverlap * 2 + aOverlap * 4;
    if (!best || score > best.score) best = {unit, score};
  }

  // Always return text copied from the selected source. The generator is
  // constrained to the evidence pack and QZMAX validates the source anchor.
  return (best && best.unit ? best.unit : String(source.content || '')).slice(0,600);
}

function attachAndValidateEvidence(items, evidence) {
  const byId = new Map(evidence.map(s => [s.id, s]));
  const byUrl = new Map(evidence.map(s => [s.url, s]));
  const accepted = [];

  for (const item of items || []) {
    const source = byId.get(String(item.sourceId || '').trim()) ||
      byUrl.get(String(item.sourceUrl || '').trim());
    if (!source) continue;

    const quote = String(item.sourceEvidence || '').trim();
    const quoteNorm = normalizeEvidenceText(quote);
    const sourceNorm = normalizeEvidenceText(`${source.title} ${source.content}`);
    const anchoredEvidence = quoteNorm.length >= 18 && sourceNorm.includes(quoteNorm)
      ? quote
      : recoverWebEvidenceSnippet(item, source);

    if (normalizeEvidenceText(anchoredEvidence).length < 18) continue;

    accepted.push({
      ...item,
      sourceId:source.id,
      sourceUrl:source.url,
      sourceTitle:source.title,
      sourceEvidence:anchoredEvidence
    });
  }
  return accepted;
}

// QZMAX 3.18.8 keeps Tavily only for current/recent AI requests. Standard AI
// generation is one provider plus deterministic QZMAX validation; fallbacks run
// only when the selected provider fails or returns no usable questions.

function normalizeCategory(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function applyCoverageGuard(items, request) {
  if (!request?.generalKnowledge || !Array.isArray(request.coverageCategories) || !request.coverageCategories.length) {
    return Array.isArray(items) ? items : [];
  }

  const allowed = new Map(
    request.coverageCategories.map(c => [normalizeCategory(c), c])
  );
  const counts = new Map();
  const maxPerCategory = Math.max(
    1,
    Math.ceil((Number(request.count)||1) / request.coverageCategories.length)
  );

  const accepted = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeCategory(item?.category);
    if (!allowed.has(key)) continue;

    const used = counts.get(key) || 0;
    if (used >= maxPerCategory) continue;

    counts.set(key, used + 1);
    accepted.push({...item, category:allowed.get(key)});
  }
  return accepted;
}

async function runProvider(route, messages, request, deadline) {
  if (route==='gemini_search') return callGemini(messages, deadline, true);
  if (route==='groq_compound') return callGroq(messages, deadline, MODELS.groqCompound, 'Groq Compound', false);
  if (route==='groq_qwen') return callGroq(messages, deadline, MODELS.groqQwen, 'Groq Qwen');
  if (route==='cerebras') return callCerebras(messages, deadline);
  if (route==='groq_oss20') return callGroq(messages, deadline, MODELS.groqOss20, 'Groq GPT-OSS 20B');
  if (route==='mistral') return callMistral(messages, deadline);
  if (route==='nvidia') return callNvidia(messages, deadline);
  if (route==='sambanova') return callSambaNova(messages, deadline);
  if (route==='cloudflare') return callCloudflare(messages, deadline);
  if (route==='openrouter') return callOpenRouter(messages, deadline);
  if (route==='groq_oss120') return callGroq(messages, deadline, MODELS.groqOss120, 'Groq GPT-OSS 120B');
  if (route==='gemini') return callGemini(messages, deadline, false);
  if (route==='local') return sourceFallback(request);
  return [];
}


const SOURCE_EXTRACT_CACHE = new Map();
const SOURCE_EXTRACT_CACHE_TTL_MS = 30 * 60 * 1000;
const SOURCE_LINK_MAX_CHARS = 220000;

function validatePublicSourceUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch (_) {
    throw Object.assign(new Error('Enter a valid public web URL.'), { status:400 });
  }

  if (!['http:','https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Source Link supports only http:// and https:// URLs.'), { status:400 });
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/,'');
  const blockedNames = new Set(['localhost','localhost.localdomain']);
  if (
    blockedNames.has(host) ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw Object.assign(new Error('Source Link requires a public internet URL.'), { status:400 });
  }

  parsed.hash = '';
  return parsed.toString();
}


function cleanExtractedSourceContent(value) {
  return String(value || '')
    .replace(/\u0000/g,'')
    // Keep Markdown headings because the frontend uses them to find focused sections.
    .replace(/!\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/<https?:\/\/[^>]+>/gi, ' ')
    .replace(/<[^>]{1,500}>/g, ' ')
    .replace(/^\s*\[[0-9]+\]\s*$/gm, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function sourceTitleFromExtract(result, rawContent, url) {
  const direct = String(result?.title || '').replace(/\s+/g,' ').trim();
  if (direct && direct.length <= 220) return direct;

  const lines = String(rawContent || '').split(/\n+/).map(v=>v.trim()).filter(Boolean).slice(0,30);
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.{3,200})$/);
    if (heading) return heading[1].replace(/\s+/g,' ').trim();
  }

  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
      .replace(/[-_]+/g,' ')
      .replace(/\.[a-z0-9]{2,5}$/i,'')
      .replace(/\s+/g,' ')
      .trim();
    if (last.length >= 3) return last.slice(0,220);
    return u.hostname.replace(/^www\./,'');
  } catch (_) {
    return 'Source page';
  }
}

async function extractSourceLink(url) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    throw Object.assign(
      new Error('TAVILY_API_KEY is required for Source Link extraction.'),
      { status:503 }
    );
  }

  const normalizedUrl = validatePublicSourceUrl(url);
  const cached = SOURCE_EXTRACT_CACHE.get(normalizedUrl);
  if (cached && Date.now() - cached.savedAt < SOURCE_EXTRACT_CACHE_TTL_MS) {
    return {...cached.data, cached:true};
  }

  const res = await fetchWithTimeout('https://api.tavily.com/extract', {
    method:'POST',
    headers:{
      'Authorization':`Bearer ${key}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      urls:[normalizedUrl],
      extract_depth:'basic',
      include_images:false
    })
  }, 12000);

  if (!res.ok) throw await readErrorResponse(res);
  const data = await res.json();
  const result = Array.isArray(data?.results) ? data.results[0] : null;
  const raw = cleanExtractedSourceContent(result?.raw_content || result?.content || '');

  if (raw.length < 120) {
    const failed = Array.isArray(data?.failed_results) ? data.failed_results[0] : null;
    const reason = failed?.error || failed?.message || 'The page returned too little usable text.';
    throw Object.assign(
      new Error(`QZMAX could not extract enough usable content from this link. ${reason}`),
      { status:422 }
    );
  }

  const truncated = raw.length > SOURCE_LINK_MAX_CHARS;
  const content = raw.slice(0, SOURCE_LINK_MAX_CHARS);
  const resolvedUrl = String(result?.url || normalizedUrl);
  let domain = '';
  try { domain = new URL(resolvedUrl).hostname.replace(/^www\./,''); } catch (_) {}

  const response = {
    url:resolvedUrl,
    domain,
    title:sourceTitleFromExtract(result,content,resolvedUrl),
    content,
    chars:content.length,
    words:(content.match(/\S+/g) || []).length,
    truncated,
    extractDepth:'basic',
    cached:false
  };

  SOURCE_EXTRACT_CACHE.set(normalizedUrl,{savedAt:Date.now(),data:response});
  return response;
}

exports.handler = async function handler(event) {
  // Lightweight status endpoint — does not spend AI quota.
  if (event.httpMethod === 'GET') {
    return jsonResponse(200, {
      version:'3.18.8',
      freeOnly:true,
      standardAI:'One free AI provider + deterministic QZMAX structural validation',
      factualRetrieval:'Tavily only for current/recent AI requests + Tavily Extract for host-selected Source Links',
      sourceLinkExtraction:'Tavily Extract · exact selected page only',
      webGroundedAI:'Tavily evidence -> one generator provider -> deterministic evidence/structure validation',
      generationArchitecture:'Up to 20 questions per normal AI pass · provider fallback only on failure · partial valid results are returned immediately',
      configured:configuredRoutes(),
      aiGeneratorOrder:CUSTOM_DEFAULT_ORDER,
      strictOrder:STRICT_DEFAULT_ORDER,
    });
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode:204, headers:{'Cache-Control':'no-store'}, body:'' };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error:'Method not allowed.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return jsonResponse(400, { error:'Invalid JSON request.' });
  }

  if (body.action === 'extract_source') {
    try {
      const extracted = await extractSourceLink(body.url);
      return jsonResponse(200, extracted);
    } catch (err) {
      const status = Number(err?.status) || 502;
      return jsonResponse(
        status >= 400 && status < 600 ? status : 502,
        { error:String(err?.message || 'Could not extract this source link.').slice(0,1200) }
      );
    }
  }

  const request = {
    topic:String(body.topic || '').trim(),
    originalTopic:String(body.originalTopic || '').trim(),
    count:safeInt(body.count,10,1,MAX_BATCH),
    optsPerQ:safeInt(body.optsPerQ,4,2,MAX_OPTIONS),
    questionType:['multiple_choice','true_false','multiple_correct'].includes(body.questionType)
      ? body.questionType : 'multiple_choice',
    questionLanguage:['English','Arabic','Egyptian Simple Arabic'].includes(body.questionLanguage)
      ? body.questionLanguage : 'English',
    sourceType:String(body.sourceType || '').trim().toLowerCase(),
    sourceName:String(body.sourceName || '').trim(),
    sourceUrls:Array.isArray(body.sourceUrls)
      ? body.sourceUrls.map(v=>String(v).trim().slice(0,1200)).filter(Boolean).slice(0,2)
      : [],
    sourceEvidenceText:String(body.sourceEvidenceText || '').slice(0,20000),
    preferSearch:body.preferSearch === true,
    webGrounding:body.webGrounding === true,
    generationId:String(body.generationId || '').trim().slice(0,100),
    generationAttempt:safeInt(body.generationAttempt,0,0,1000),
    scopeInstruction:String(body.scopeInstruction || '').trim().slice(0,5000),
    structuredScope:sanitizeStructuredScope(body.structuredScope),
    difficulty:['Easy','Medium','Hard'].includes(body.difficulty) ? body.difficulty : 'Medium',
    generalKnowledge:body.generalKnowledge === true,
    coverageCategories:Array.isArray(body.coverageCategories)
      ? body.coverageCategories.map(v=>String(v).trim().slice(0,120)).filter(Boolean).slice(0,12)
      : [],
    avoidFactKeys:Array.isArray(body.avoidFactKeys)
      ? body.avoidFactKeys.map(v=>String(v).trim().slice(0,240)).filter(Boolean).slice(0,80)
      : [],
  };

  if (!request.topic) {
    return jsonResponse(400, { error:'A topic or source is required.' });
  }

  const aiGeneratorMode = request.sourceType === 'ai';
  const webGroundedMode = aiGeneratorMode && shouldUseWebGrounding(request);
  request.webGrounding = webGroundedMode;

  const budgetMs = webGroundedMode
    ? WEB_GROUNDED_BUDGET_MS
    : aiGeneratorMode
      ? STANDARD_AI_BUDGET_MS
      : SOURCE_MODE_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  let webEvidence = [];
  let messages = buildMessages(request);

  if (webGroundedMode) {
    try {
      webEvidence = await fetchTavilyEvidence(request, deadline);
      messages = buildWebEvidenceMessages(messages, request, webEvidence);
    } catch (err) {
      console.warn('[QZMAX AI] conditional web grounding failed', String(err?.message || err).slice(0,500));
      return jsonResponse(503, {
        error:'QZMAX could not gather enough fresh web evidence for this current/recent request. No unsupported questions were generated. Try again shortly or broaden the topic.',
        mode:'web-grounded',
        details:process.env.QZMAX_AI_DEBUG === '1' ? [String(err?.message || err)] : undefined
      });
    }
  }

  const order = parseProviderOrder(request);
  const errors = [];
  let bestLinkPartial = null;

  for (const route of order) {
    if (route !== 'local' && routeOnCooldown(route)) {
      errors.push(`${route}: cooling down after a recent rate limit`);
      continue;
    }

    if (Date.now() >= deadline && route !== 'local') {
      errors.push(`${route}: skipped because the Netlify function time budget was exhausted`);
      continue;
    }

    try {
      const raw = await runProvider(route, messages, request, deadline);
      const structurallyValid = applyCoverageGuard(validateQuestions(raw, request), request);

      if (structurallyValid.length) {
        const provider = routeProvider(route);
        const model = routeModel(route);

        if (aiGeneratorMode) {
          if (webGroundedMode) {
            const grounded = attachAndValidateEvidence(structurallyValid, webEvidence)
              .map(q => ({
                ...q,
                webVerified:true,
                verificationProvider:provider
              }));

            if (grounded.length) {
              console.log(`[QZMAX AI] mode=web-grounded route=${route} provider=${provider} model=${model} valid=${grounded.length}/${request.count}`);
              return jsonResponse(200, grounded.slice(0, request.count), {
                'X-QZMAX-AI-Provider':provider,
                'X-QZMAX-AI-Model':model,
                'X-QZMAX-AI-Route':route,
                'X-QZMAX-AI-Mode':'web-grounded',
                'X-QZMAX-AI-Verification':'Tavily web grounded + QZMAX structural validation',
                'X-QZMAX-AI-Accepted':`${Math.min(grounded.length,request.count)}/${request.count}`
              });
            }

            errors.push(`${route}: no candidates could be anchored to the fresh web evidence`);
            continue;
          }

          // Standard AI route: one model does the generation and its own factual
          // self-check. QZMAX then performs deterministic structure/coverage checks.
          // A second provider is used only if the first provider genuinely fails.
          console.log(`[QZMAX AI] mode=standard route=${route} provider=${provider} model=${model} valid=${structurallyValid.length}/${request.count}`);
          return jsonResponse(200, structurallyValid.slice(0, request.count), {
            'X-QZMAX-AI-Provider':provider,
            'X-QZMAX-AI-Model':model,
            'X-QZMAX-AI-Route':route,
            'X-QZMAX-AI-Mode':'standard',
            'X-QZMAX-AI-Verification':'QZMAX structural validation',
            'X-QZMAX-AI-Accepted':`${Math.min(structurallyValid.length,request.count)}/${request.count}`
          });
        }

        console.log(`[QZMAX AI] route=${route} provider=${provider} model=${model} valid=${structurallyValid.length}/${request.count}`);

        if (request.sourceType === 'link' && structurallyValid.length < request.count) {
          if (!bestLinkPartial || structurallyValid.length > bestLinkPartial.items.length) {
            bestLinkPartial = {
              items:structurallyValid.slice(),
              provider,
              model,
              route
            };
          }

          errors.push(`${route}: link-grounded partial ${structurallyValid.length}/${request.count}`);

          // Link mode is aggregated by the frontend across rotating source windows.
          // Return a useful grounded partial quickly; later passes rotate both
          // source window and free provider.
          if (structurallyValid.length >= Math.min(2, request.count)) {
            return jsonResponse(200, structurallyValid.slice(0, request.count), {
              'X-QZMAX-AI-Provider':provider,
              'X-QZMAX-AI-Model':model,
              'X-QZMAX-AI-Route':route,
              'X-QZMAX-AI-Partial':`${structurallyValid.length}/${request.count}`
            });
          }

          continue;
        }

        return jsonResponse(200, structurallyValid.slice(0, request.count), {
          'X-QZMAX-AI-Provider':provider,
          'X-QZMAX-AI-Model':model,
          'X-QZMAX-AI-Route':route
        });
      }

      errors.push(`${route}: no structurally valid questions`);
    } catch (err) {
      if (err?.skip) {
        errors.push(`${route}: not configured`);
        continue;
      }

      markRouteCooldown(route, err);
      const status = err?.status ? `HTTP ${err.status}` : '';
      errors.push(`${route}: ${status} ${String(err?.message || err).slice(0,240)}`);
      console.warn(`[QZMAX AI] ${route} failed ${status}`, String(err?.message || err).slice(0,500));
    }
  }

  if (request.sourceType === 'link' && bestLinkPartial && bestLinkPartial.items.length) {
    return jsonResponse(200, bestLinkPartial.items.slice(0, request.count), {
      'X-QZMAX-AI-Provider':bestLinkPartial.provider,
      'X-QZMAX-AI-Model':bestLinkPartial.model,
      'X-QZMAX-AI-Route':bestLinkPartial.route,
      'X-QZMAX-AI-Partial':`${bestLinkPartial.items.length}/${request.count}`
    });
  }

  return jsonResponse(503, {
    error:aiGeneratorMode
      ? (webGroundedMode
          ? 'QZMAX could not create a web-grounded batch with the available free AI providers. No unsupported questions were added. Try again shortly or broaden the topic.'
          : 'QZMAX could not generate a valid batch with the available free AI providers. Try again shortly; QZMAX will automatically use the next free route when a provider is unavailable.')
      : 'All configured free AI routes are currently unavailable or rate-limited. QZMAX kept the requested batch size unchanged. Configure additional free providers or try again shortly.',
    details:process.env.QZMAX_AI_DEBUG === '1' ? errors : undefined,
  });
};
