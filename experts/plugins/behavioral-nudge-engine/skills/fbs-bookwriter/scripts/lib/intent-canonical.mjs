import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..', '..');
const CANONICAL_PATH = path.join(SKILL_ROOT, 'references', '01-core', 'intent-canonical.json');

let CACHE = null;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

export function loadIntentCanonical() {
  if (CACHE) return CACHE;
  const raw = fs.readFileSync(CANONICAL_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const intents = Array.isArray(parsed.intents) ? parsed.intents : [];
  const byId = new Map(intents.map((item) => [item.id, item]));
  CACHE = {
    ...parsed,
    intents,
    byId,
  };
  return CACHE;
}

export function resetIntentCanonicalCache() {
  CACHE = null;
}

export function getIntentById(intentId) {
  return loadIntentCanonical().byId.get(intentId) || null;
}

export function listIntentIds() {
  return loadIntentCanonical().intents.map((item) => item.id);
}

export function resolveIntentCandidates(input, options = {}) {
  const text = normalizeText(input);
  const {
    includeWeakSignals = true,
    contextIntentHints = [],
  } = options;
  const canonical = loadIntentCanonical();
  const candidates = [];

  if (!text) {
    return [{ intent: canonical.fallbackIntent || 'OTHER', score: 0.1, method: 'empty' }];
  }

  for (const intent of canonical.intents) {
    const zh = Array.isArray(intent.strongTriggersZh) ? intent.strongTriggersZh : [];
    const en = Array.isArray(intent.strongTriggersEn) ? intent.strongTriggersEn : [];
    const triggers = [...zh, ...en].map(normalizeText).filter(Boolean);
    let score = 0;
    let method = 'none';
    for (const trigger of triggers) {
      if (text === trigger) {
        score = Math.max(score, 1.0);
        method = 'exact';
      } else if (text.includes(trigger)) {
        const proximity = Math.min(0.94, 0.65 + Math.min(trigger.length, text.length) / Math.max(trigger.length, text.length) * 0.2);
        if (proximity > score) {
          score = proximity;
          method = 'contains';
        }
      }
    }

    if (score > 0) {
      candidates.push({
        intent: intent.id,
        score,
        method,
      });
    }
  }

  if (includeWeakSignals && candidates.length === 0) {
    const weakSignals = Array.isArray(canonical.weakSignals) ? canonical.weakSignals : [];
    if (weakSignals.some((token) => token && text.includes(normalizeText(token)))) {
      candidates.push({
        intent: canonical.fallbackIntent || 'OTHER',
        score: 0.55,
        method: 'weak-signal',
      });
    }
  }

  if (!candidates.length) {
    candidates.push({
      intent: canonical.fallbackIntent || 'OTHER',
      score: 0.2,
      method: 'fallback',
    });
  }

  // STOP/EXIT safety priority
  const stopIntents = new Set(canonical.stopIntents || []);
  const hasStop = candidates.find((c) => stopIntents.has(c.intent));
  if (hasStop) hasStop.score = Math.max(hasStop.score, 0.98);

  if (Array.isArray(contextIntentHints) && contextIntentHints.length > 0) {
    const hinted = new Set(contextIntentHints);
    for (const c of candidates) {
      if (hinted.has(c.intent)) c.score = Math.min(0.99, c.score + 0.06);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 5);
}

export function isConflictPair(intentA, intentB) {
  const canonical = loadIntentCanonical();
  const matrix = Array.isArray(canonical.conflictPairs) ? canonical.conflictPairs : [];
  return matrix.some((pair) => Array.isArray(pair) && pair.includes(intentA) && pair.includes(intentB));
}

export function classifyConfidence(score) {
  const { confidenceBands } = loadIntentCanonical();
  const high = Number(confidenceBands?.high || 0.85);
  const medium = Number(confidenceBands?.medium || 0.6);
  if (score >= high) return 'high';
  if (score >= medium) return 'medium';
  return 'low';
}

export function completeIntentSlots(intentId, input, context = {}) {
  const intent = getIntentById(intentId);
  const slots = Array.isArray(intent?.slots) ? intent.slots : [];
  const text = String(input || '');
  const resolved = {};
  for (const slot of slots) {
    if (slot === 'bookRoot') {
      resolved.bookRoot = context.bookRoot || null;
      continue;
    }
    if (slot === 'stage') {
      resolved.stage = context.stage || context.sessionState || null;
      continue;
    }
    if (slot === 'targetChapter') {
      const m = text.match(/第\s*([0-9一二三四五六七八九十百]+)\s*章/);
      resolved.targetChapter = m ? m[1] : context.targetChapter || null;
      continue;
    }
    if (slot === 'outputFormat') {
      const lower = text.toLowerCase();
      if (lower.includes('pdf')) resolved.outputFormat = 'pdf';
      else if (lower.includes('docx') || lower.includes('word')) resolved.outputFormat = 'docx';
      else if (lower.includes('html')) resolved.outputFormat = 'html';
      else resolved.outputFormat = context.outputFormat || null;
      continue;
    }
    if (slot === 'riskMode') {
      resolved.riskMode = context.riskMode || (text.includes('价格') || text.includes('法规') || text.includes('版本') ? 'high' : null);
      continue;
    }
    if (slot === 'scope') {
      resolved.scope = context.scope || null;
      continue;
    }
    if (slot === 'mode') {
      resolved.mode = context.mode || null;
      continue;
    }
    if (slot === 'topic') {
      resolved.topic = context.topic || null;
      continue;
    }
    resolved[slot] = context[slot] || null;
  }

  const missing = slots.filter((slot) => !resolved[slot]);
  return {
    slots,
    resolved,
    missing,
    complete: missing.length === 0,
  };
}
