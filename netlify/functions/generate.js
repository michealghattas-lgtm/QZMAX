'use strict';

// QZMAX Free AI Router — Netlify Function
// Provider order (default): Groq -> Cloudflare Workers AI -> Gemini -> local source fallback
// No provider is required. Missing credentials are skipped automatically.

const DEFAULT_ORDER = ['groq', 'cloudflare', 'gemini', 'local'];
const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
const CLOUDFLARE_MODEL = process.env.CLOUDFLARE_MODEL || '@cf/zai-org/glm-4.7-flash';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MAX_BATCH = 10;
const MAX_OPTIONS = 8;
const MAX_PROMPT_CHARS = 60000;
const GLOBAL_BUDGET_MS = 26000;

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

function parseProviderOrder() {
  const raw = String(process.env.AI_PROVIDER_ORDER || '').trim();
  if (!raw) return DEFAULT_ORDER;
  const valid = new Set(DEFAULT_ORDER);
  const out = raw.toLowerCase().split(',').map(s => s.trim()).filter(s => valid.has(s));
  if (!out.includes('local')) out.push('local');
  return out.length ? [...new Set(out)] : DEFAULT_ORDER;
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

function validateQuestions(items, { count, optsPerQ, questionType }) {
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw || typeof raw.question !== 'string') continue;
    const question = raw.question.trim();
    const options = Array.isArray(raw.options) ? raw.options.map(v => String(v).trim()).filter(Boolean) : [];
    if (!question || options.length < 2) continue;
    if (new Set(options.map(v => v.toLocaleLowerCase())).size !== options.length) continue;

    const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim() : '';
    const sourceEvidence = typeof raw.sourceEvidence === 'string' ? raw.sourceEvidence.trim().slice(0, 600) : '';
    const sourcePage = raw.sourcePage == null ? '' : String(raw.sourcePage).trim().slice(0, 80);

    if (questionType === 'true_false') {
      const correctIndex = Number.parseInt(raw.correctIndex, 10);
      if (options.length !== 2 || ![0, 1].includes(correctIndex)) continue;
      out.push({ question, options, correctIndex, explanation, sourceEvidence, sourcePage });
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
      });
    } else {
      const correctIndex = Number.parseInt(raw.correctIndex, 10);
      if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) continue;
      if (optsPerQ >= 2 && options.length > MAX_OPTIONS) continue;
      out.push({ question, options, correctIndex, explanation, sourceEvidence, sourcePage });
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
    'When source material is supplied, also include sourceEvidence as a short exact supporting phrase where practical.',
    'Do not wrap JSON in Markdown fences.',
  ];

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

function buildMessages(request) {
  const system = [
    'You are the QZMAX quiz-generation engine.',
    'Follow all factual grounding, language, format, and duplicate-avoidance instructions in the user prompt exactly.',
    'Never invent a fact that is not supported when the prompt contains source material.',
    schemaInstruction(request),
  ].join('\n\n');

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
  const message = data?.error?.message || data?.errors?.[0]?.message || data?.message || text || `${res.status} ${res.statusText}`;
  const error = new Error(String(message).slice(0, 1200));
  error.status = res.status;
  error.retryAfter = Number.parseFloat(res.headers.get('retry-after') || '0') || 0;
  return error;
}

async function maybeRetry(call, deadline, providerName) {
  try {
    return await call();
  } catch (err) {
    const retryable = err && (err.status === 429 || err.status === 503 || err.status === 529);
    const suggested = err?.retryAfter ? err.retryAfter * 1000 : 0;
    const waitMs = Math.min(5500, Math.max(750, suggested || 1200));
    if (!retryable || Date.now() + waitMs + 1500 >= deadline) throw err;
    console.warn(`[QZMAX AI] ${providerName} temporary limit; retrying once in ${waitMs}ms.`);
    await sleep(waitMs);
    return call();
  }
}

async function callGroq(messages, request, deadline) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw Object.assign(new Error('GROQ_API_KEY is not configured.'), { skip: true });
  const timeout = Math.max(2500, Math.min(12000, deadline - Date.now() - 500));

  const doCall = async () => {
    const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    }, timeout);
    if (!res.ok) throw await readErrorResponse(res);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return normalizeQuestionPayload(extractBalancedJson(text));
  };

  return maybeRetry(doCall, deadline, 'Groq');
}

async function callCloudflare(messages, request, deadline) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AUTH_TOKEN;
  if (!accountId || !token) throw Object.assign(new Error('Cloudflare Workers AI credentials are not configured.'), { skip: true });
  const timeout = Math.max(2500, Math.min(12000, deadline - Date.now() - 500));
  const modelPath = CLOUDFLARE_MODEL.split('/').map(encodeURIComponent).join('/').replace('%40cf', '@cf');
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${modelPath}`;

  const doCall = async () => {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        temperature: 0.2,
        max_completion_tokens: 5000,
      }),
    }, timeout);
    if (!res.ok) throw await readErrorResponse(res);
    const data = await res.json();
    const result = data?.result ?? data;
    let text = '';
    if (typeof result?.response === 'string') text = result.response;
    else if (typeof result?.text === 'string') text = result.text;
    else if (typeof result?.choices?.[0]?.message?.content === 'string') text = result.choices[0].message.content;
    else if (typeof data?.response === 'string') text = data.response;
    else if (result && (Array.isArray(result.questions) || Array.isArray(result))) return normalizeQuestionPayload(result);
    return normalizeQuestionPayload(extractBalancedJson(text));
  };

  return maybeRetry(doCall, deadline, 'Cloudflare Workers AI');
}

async function callGemini(messages, request, deadline) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw Object.assign(new Error('Gemini API key is not configured.'), { skip: true });
  const timeout = Math.max(2500, Math.min(11000, deadline - Date.now() - 500));
  const prompt = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

  const doCall = async () => {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: 'application/json' },
      }),
    }, timeout);
    if (!res.ok) throw await readErrorResponse(res);
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p?.text || '').join('').trim();
    return normalizeQuestionPayload(extractBalancedJson(text));
  };

  return maybeRetry(doCall, deadline, 'Gemini');
}

function getLanguageLabels(language) {
  if (language === 'Egyptian Simple Arabic') {
    return {
      trueFalse: ['صح', 'غلط'],
      cloze: 'حسب المصدر، إيه الاختيار اللي بيكمّل الجملة دي صح؟',
      trueQuestion: 'حسب المصدر، هل الجملة دي صحيحة؟',
      multiple: 'حسب المصدر، اختار كل الإجابات اللي ظهرت في العبارة دي:',
      explanation: 'المصدر بيقول:',
    };
  }
  if (language === 'Arabic') {
    return {
      trueFalse: ['صحيح', 'خطأ'],
      cloze: 'وفقًا للمصدر، أي اختيار يُكمل العبارة التالية بشكل صحيح؟',
      trueQuestion: 'وفقًا للمصدر، هل العبارة التالية صحيحة؟',
      multiple: 'وفقًا للمصدر، اختر جميع الإجابات التي تظهر في العبارة التالية:',
      explanation: 'يذكر المصدر:',
    };
  }
  return {
    trueFalse: ['True', 'False'],
    cloze: 'According to the source, which option correctly completes this statement?',
    trueQuestion: 'According to the source, is this statement correct?',
    multiple: 'According to the source, select all options that appear in this statement:',
    explanation: 'The source states:',
  };
}

function extractSourceMaterial(topic) {
  const text = String(topic || '');
  const marker = 'SOURCE MATERIAL:';
  const i = text.indexOf(marker);
  if (i < 0) return '';
  let source = text.slice(i + marker.length);
  const endMarkers = [
    '\n\nDO NOT repeat',
    '\n\nCreate distinct questions',
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

async function runProvider(name, messages, request, deadline) {
  if (name === 'groq') return callGroq(messages, request, deadline);
  if (name === 'cloudflare') return callCloudflare(messages, request, deadline);
  if (name === 'gemini') return callGemini(messages, request, deadline);
  if (name === 'local') return sourceFallback(request);
  return [];
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return jsonResponse(400, { error: 'Invalid JSON request.' });
  }

  const request = {
    topic: String(body.topic || '').trim(),
    originalTopic: String(body.originalTopic || '').trim(),
    count: safeInt(body.count, 10, 1, MAX_BATCH),
    optsPerQ: safeInt(body.optsPerQ, 4, 2, MAX_OPTIONS),
    questionType: ['multiple_choice', 'true_false', 'multiple_correct'].includes(body.questionType)
      ? body.questionType : 'multiple_choice',
    questionLanguage: ['English', 'Arabic', 'Egyptian Simple Arabic'].includes(body.questionLanguage)
      ? body.questionLanguage : 'English',
  };

  if (!request.topic) return jsonResponse(400, { error: 'A topic or source is required.' });
  const messages = buildMessages(request);
  const deadline = Date.now() + GLOBAL_BUDGET_MS;
  const errors = [];

  for (const provider of parseProviderOrder()) {
    if (Date.now() >= deadline && provider !== 'local') {
      errors.push(`${provider}: skipped because the request time budget was exhausted`);
      continue;
    }
    try {
      const raw = await runProvider(provider, messages, request, deadline);
      const valid = validateQuestions(raw, request);
      if (valid.length) {
        console.log(`[QZMAX AI] provider=${provider} model=${provider === 'groq' ? GROQ_MODEL : provider === 'cloudflare' ? CLOUDFLARE_MODEL : provider === 'gemini' ? GEMINI_MODEL : 'source-fallback'} valid=${valid.length}`);
        return jsonResponse(200, valid.slice(0, request.count), {
          'X-QZMAX-AI-Provider': provider,
        });
      }
      errors.push(`${provider}: no structurally valid questions returned`);
    } catch (err) {
      if (err?.skip) {
        errors.push(`${provider}: not configured`);
      } else {
        const status = err?.status ? ` HTTP ${err.status}` : '';
        errors.push(`${provider}:${status} ${String(err?.message || err).slice(0, 300)}`);
        console.warn(`[QZMAX AI] ${provider} failed:${status}`, String(err?.message || err).slice(0, 600));
      }
    }
  }

  return jsonResponse(503, {
    error: 'All free AI routes are currently unavailable or rate-limited, and the source-only fallback could not build a usable batch. Please wait a moment and try again.',
    details: process.env.QZMAX_AI_DEBUG === '1' ? errors : undefined,
  });
};
