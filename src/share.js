// ClaimTape · shareable report link (CT-A2)
//
// Same contract as Traceboard's encodeShareURL / decodeShareURL:
//   - lz-string compressToEncodedURIComponent on a slim payload
//   - be liberal in what you accept when decoding
//   - never silently truncate: if the URL would exceed 8000 chars, refuse
//
// A shared ClaimTape report quotes evidence, which is exactly where API keys
// and file paths live. Redact BEFORE encoding. The hit count is honest.

import LZString from 'lz-string';
import { redact } from './vendor/redact.js';

export const MAX_SHARE_URL = 8000;
export const SHARE_PREFIX = 'ct=';

function redactDeep(value) {
  if (typeof value === 'string') {
    const out = redact(value);
    return { value: out.text, hits: out.hits };
  }
  if (Array.isArray(value)) {
    let hits = 0;
    const items = value.map((item) => {
      const r = redactDeep(item);
      hits += r.hits;
      return r.value;
    });
    return { value: items, hits };
  }
  if (value && typeof value === 'object') {
    let hits = 0;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const r = redactDeep(v);
      hits += r.hits;
      out[k] = r.value;
    }
    return { value: out, hits };
  }
  return { value, hits: 0 };
}

function slimClaim(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    id: c.id,
    claim: c.claim,
    status: c.status,
    kind: c.kind || null,
    spans: Array.isArray(c.spans) ? c.spans.map((s) => ({ start: s.start, end: s.end })) : [],
    conflictKind: c.conflictKind || null,
    evidenceMatches: c.evidenceMatches || [],
    conflictSignals: c.conflictSignals || [],
    isRisky: !!c.isRisky,
    riskIds: c.riskIds || (c.riskId ? [c.riskId] : []),
    reasons: c.reasons || [],
    evidenceSnippets: (c.evidenceSnippets || []).map((s) => ({
      id: s.id,
      line: s.line,
      snippet: s.snippet,
      score: s.score ?? null,
    })),
    confidence: c.confidence ?? null,
    pairSource: c.pairSource || null,
  };
}

/**
 * Slim the analyze() result. Claims + verdicts + spans + coverage.
 * Evidence is kept once (for highlight restore) and the original answer is
 * not duplicated — the claim texts already are the answer.
 */
export function slimReport(analysis, evidenceText = '') {
  const claims = (analysis?.claims || []).map(slimClaim).filter(Boolean);
  return {
    v: 1,
    tool: 'claimtape',
    coverage: analysis?.coverage ?? analysis?.score ?? null,
    hasEvidence: !!analysis?.hasEvidence,
    mode: analysis?.mode || (analysis?.hasEvidence ? 'evidence-verify' : 'epistemic-audit'),
    summary: analysis?.summary || '',
    disclaimer: analysis?.disclaimer || '',
    stats: analysis?.stats || {},
    riskFlags: analysis?.riskFlags || [],
    factCount: analysis?.factCount ?? 0,
    reviewQueue: (analysis?.reviewQueue || []).map((c) => (typeof c === 'object' ? c.id : c)).filter((id) => id != null),
    claims,
    // One copy of the evidence, so the highlight pane can restore. Not the
    // raw answer — that would be the input twice over.
    evidence: String(evidenceText ?? ''),
  };
}

export function encodeSharePayload(analysis, evidenceText = '') {
  const slim = slimReport(analysis, evidenceText);
  const redacted = redactDeep(slim);
  const encoded = LZString.compressToEncodedURIComponent(JSON.stringify(redacted.value));
  return { encoded, payload: redacted.value, redacted: redacted.hits };
}

/**
 * Decode a share fragment. Liberal on purpose (Traceboard lesson):
 *   - compressed JSON object (what we produce)
 *   - compressed JSON array of claims
 *   - compressed JSONL of claim objects
 *   - uncompressed JSON (someone pasted a payload)
 *   - a wrapper { report | data | claims }
 * Returns null on garbage. Never throws.
 */
export function decodeShareURL(encoded) {
  if (encoded == null) return null;
  let text = String(encoded);
  if (!text) return null;

  // Accept a full hash or a prefixed fragment.
  if (text.startsWith('#')) text = text.slice(1);
  if (text.startsWith(SHARE_PREFIX)) text = text.slice(SHARE_PREFIX.length);
  if (text.startsWith('t2=')) text = text.slice(3); // Traceboard-style prefix, just in case

  const candidates = [];
  try {
    const decompressed = LZString.decompressFromEncodedURIComponent(text);
    if (decompressed) candidates.push(decompressed);
  } catch { /* ignore */ }
  try {
    candidates.push(decodeURIComponent(text));
  } catch {
    candidates.push(text);
  }

  for (const raw of candidates) {
    const parsed = parseLoose(raw);
    if (parsed) return parsed;
  }
  return null;
}

function parseLoose(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const doc = JSON.parse(trimmed);
      const normalised = normaliseDecoded(doc);
      if (normalised) return normalised;
    } catch {
      // A JSONL payload also starts with '{' — fall through.
    }
  }

  const rows = [];
  for (const line of trimmed.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { rows.push(JSON.parse(s)); } catch { /* skip bad line */ }
  }
  if (!rows.length) return null;
  return normaliseDecoded(rows);
}

function normaliseDecoded(doc) {
  if (!doc) return null;
  if (Array.isArray(doc)) {
    const claims = doc.map(slimClaim).filter((c) => c && c.claim);
    if (!claims.length) return null;
    return {
      v: 1,
      tool: 'claimtape',
      coverage: null,
      hasEvidence: claims.some((c) => (c.spans || []).length || (c.evidenceSnippets || []).length),
      mode: 'evidence-verify',
      summary: '',
      disclaimer: '',
      stats: {},
      riskFlags: [],
      factCount: 0,
      reviewQueue: [],
      claims,
      evidence: '',
    };
  }
  if (typeof doc !== 'object') return null;

  // Wrapper shapes other tools might send.
  const body = doc.claims ? doc
    : doc.report?.claims ? doc.report
    : doc.data?.claims ? doc.data
    : doc.payload?.claims ? doc.payload
    : null;
  if (!body) return null;

  const claims = (body.claims || []).map(slimClaim).filter(Boolean);
  if (!claims.length) return null;

  const coverage = body.coverage ?? body.score ?? doc.coverage ?? doc.score ?? null;
  const hasEvidence = body.hasEvidence ?? doc.hasEvidence ?? coverage != null;
  return {
    v: body.v ?? 1,
    tool: body.tool || 'claimtape',
    coverage,
    hasEvidence: !!hasEvidence,
    mode: body.mode || (hasEvidence ? 'evidence-verify' : 'epistemic-audit'),
    summary: body.summary || '',
    disclaimer: body.disclaimer || '',
    stats: body.stats || {},
    riskFlags: body.riskFlags || [],
    factCount: body.factCount ?? 0,
    reviewQueue: body.reviewQueue || [],
    claims,
    evidence: body.evidence || '',
  };
}

/** Rebuild an analyze()-shaped object the UI already knows how to render. */
export function reportFromShare(decoded) {
  if (!decoded?.claims?.length) return null;
  const claims = decoded.claims.map((c, i) => ({
    ...c,
    id: c.id ?? i + 1,
    riskId: c.riskIds?.[0] || null,
  }));
  const byId = new Map(claims.map((c) => [c.id, c]));
  const reviewQueue = (decoded.reviewQueue || [])
    .map((id) => byId.get(id))
    .filter(Boolean);
  const stats = Object.keys(decoded.stats || {}).length
    ? decoded.stats
    : {
      total: claims.length,
      supported: claims.filter((c) => c.status === 'supported').length,
      opinion: claims.filter((c) => c.status === 'opinion').length,
      assessment: claims.filter((c) => c.status === 'assessment').length,
      unverified: claims.filter((c) => c.status === 'unverified' || c.status === 'unsupported').length,
      unsupported: claims.filter((c) => c.status === 'unverified' || c.status === 'unsupported').length,
      contradicted: claims.filter((c) => c.status === 'contradicted').length,
      needs_human: claims.filter((c) => c.status === 'needs_human').length,
    };
  const coverage = decoded.coverage ?? null;
  return {
    claims,
    coverage,
    score: coverage,
    reviewQueue,
    stats,
    riskFlags: decoded.riskFlags || [],
    hasEvidence: !!decoded.hasEvidence,
    factCount: decoded.factCount ?? 0,
    mode: decoded.mode,
    summary: decoded.summary,
    version: '2.1.0',
    metric: 'evidence-coverage',
    disclaimer: decoded.disclaimer || (
      decoded.hasEvidence
        ? 'Coverage measures evidence match, not truth. Offline heuristics: high precision on explicit conflicts, no guarantee of correctness.'
        : 'No evidence supplied, so no coverage is computed. Claims are labelled by type only — not by whether they are true.'
    ),
    shared: true,
  };
}

export function buildShareURL(base, analysis, evidenceText = '') {
  const { encoded, payload, redacted } = encodeSharePayload(analysis, evidenceText);
  const origin = String(base || '').replace(/#.*$/, '');
  const url = `${origin}#${SHARE_PREFIX}${encoded}`;
  if (url.length > MAX_SHARE_URL) {
    return {
      ok: false,
      tooLong: true,
      length: url.length,
      limit: MAX_SHARE_URL,
      redacted,
      payload,
    };
  }
  return { ok: true, url, encoded, payload, redacted, length: url.length };
}
