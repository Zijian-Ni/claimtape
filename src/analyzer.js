// ClaimTape Analysis Engine v2.0
//
// WHAT THIS TOOL IS (read before changing scoring):
//   A human-review PRIORITISER. It tells you which sentence to check first.
//   It does NOT decide what is true. The headline number is EVIDENCE COVERAGE
//   — how much of a claim is backed by the supplied evidence — not a truth
//   score. Anything in this file that implies otherwise is a bug.
//
// Two modes:
//  A) WITH evidence  → match claims against supplied facts (strict)
//  B) WITHOUT evidence → epistemic audit only, and NO coverage number is
//     produced, because coverage against zero evidence is meaningless.
// Never pretends API-level omniscience; always separates "unverified" from "false".

import { tokenize, splitSentences, buildTokenIndex, mergeSpans, hasCJK } from './tokenize.js';
import {
  negationPolarity,
  findNumericConflicts,
  findPolarityConflict,
  describeNumericConflict,
} from './polarity.js';

const STOP = new Set(`the and has have been with for are that this from will all can its our their they was were not but also any each both such into over than more most very just about only some which when what who how why there here then them being does did would could should shall may might must upon within across under your you we it is in on to of as by or an at be a to`.split(/\s+/));

const OPINION_RE = /建议|应该|可以|推荐|路径|架构|我认为|判断|目标|方向|理想|最理性|告诉我|想先|优先级|可配置|更现实|更可控|拆成|模块化|我认为|I think|should|recommend|suggest|path forward|architecture|ideal|consider|you can|you could|priority|framework|design/i;
const HEDGE_RE = /可能|大约|似乎|倾向|目前|一般来说|在一定程度上|尚未|仍|差距|瓶颈|研究前沿|还没有|不完全|probably|possibly|likely|appears|seems|generally|currently|roughly|to some extent|frontier|not yet|no single|没有任何一个/i;
const FACTISH_RE = /\b(20\d{2}|v?\d+\.\d+|https?:\/\/|%\d|\d+%|\bGPT-?\d|\bClaude\b|\bOpenAI\b|\bGemini\b|已上线|已部署|通过率|准确率|测试通过|生产环境|官方|发布于)\b|[A-Z][a-z]+ \d{4}/i;
const ABSOLUTE_RE = /绝对|一定|永远|全部|所有|100\s*%|零缺陷|无任何|保证|必定|always|never|guaranteed|every single|no .+ ever|perfect/i;

export function splitIntoClaims(text) {
  if (!text?.trim()) return [];
  const cleaned = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, (m) => m.split('\n').map(l => l.trim() ? `CODE: ${l}` : '').join('\n'))
    .replace(/^\|.*\|$/gm, '') // drop pure table separator noise later partially
    ;

  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];

  for (let line of lines) {
    if (/^#{1,6}\s/.test(line)) line = line.replace(/^#{1,6}\s+/, '').trim();
    if (/^[-*_]{3,}$/.test(line)) continue;
    if (/^\|?\s*:?-+:?\s*\|/.test(line)) continue; // md table sep
    // table row → join cells as one claim-ish sentence if contentful
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 2 && !cells.every(c => /^:?-+:?$/.test(c))) {
        const joined = cells.join(' · ');
        if (joined.length > 8) out.push(joined);
      }
      continue;
    }

    line = line.replace(/^\*\*(.+)\*\*$/, '$1').replace(/\*\*/g, '').trim();
    if (!line || line === '**') continue;

    if (/^[-•*▪▸►]\s+/.test(line) || /^\d+[.)、]\s*/.test(line)) {
      const c = line.replace(/^[-•*▪▸►]\s+/, '').replace(/^\d+[.)、]\s*/, '').trim();
      if (c.length >= 2) out.push(c);
      continue;
    }

    let parts = line
      .split(/(?<=[。！？!?；;])\s*/)
      .flatMap(seg => seg.split(/(?<=\.)\s+(?=[A-Z0-9“"‘'《\u4e00-\u9fff])/))
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length <= 1 && /\.\s+/.test(line)) {
      parts = line.split(/\.\s+/).map((s, i, arr) => {
        s = s.trim();
        if (!s) return '';
        return i < arr.length - 1 && !/[.!?。]$/.test(s) ? s + '.' : s;
      }).filter(Boolean);
    }
    if (parts.length > 1) out.push(...parts.filter(s => s.length >= 2));
    else if (line.length >= 2) out.push(line);
  }

  const seen = new Set();
  return out.filter(c => {
    const k = c.toLowerCase().replace(/\s+/g, ' ');
    if (k.length < 2) return false;
    if (seen.has(k)) return false;
    // drop pure decoration
    if (/^[-=_*#`|]+$/.test(c)) return false;
    seen.add(k);
    return true;
  });
}

function classifyKind(claim) {
  // Operational / measurable claims are factual even without digits
  if (/\b(production|staging|deployed|running|live|coverage|latency|bug|bugs|error|errors|tests?|pipeline|ci\/cd|checks?\s+are\s+green|operational|passed|failed)\b|已上线|已部署|生产|测试通过|覆盖率|零延迟/i.test(claim)) {
    return 'factual';
  }
  const isFactish = FACTISH_RE.test(claim) || (/\b(is|are|was|were|has|have)\b/i.test(claim) && /\d/.test(claim)) || /\d/.test(claim);
  if (isFactish) return 'factual';
  if (/^CODE:/.test(claim) || /┌|│|└/.test(claim)) return 'framework';
  const isOpinion = OPINION_RE.test(claim);
  const isHedge = HEDGE_RE.test(claim);
  if (isOpinion && !isFactish) return 'opinion';
  if (isHedge) return 'assessment';
  if (/架构|核心|模块|建议|应该|可以|路径/.test(claim)) return 'opinion';
  return 'assessment';
}

function normNum(n) {
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? n : Math.round(n * 1000) / 1000;
}

function extractNums(str) {
  const res = [];
  const re = /([-+]?\d+(?:\.\d+)?)\s*(%|％|ms|s|x|×|k|kb|mb|gb|tb)?/gi;
  let m;
  while ((m = re.exec(str))) {
    const v = Number(m[1]);
    const unit = (m[2] || '').toLowerCase().replace('％', '%');
    res.push({ value: normNum(v), unit, raw: m[0].trim(), index: m.index });
    if (!unit && v > 0 && v <= 1) {
      res.push({ value: normNum(v * 100), unit: '%', raw: `${(v * 100).toFixed(1)}%←${m[0]}`, index: m.index, derived: true });
    }
  }
  return res;
}

// CT-4: delegate to the shared tokenizer so Chinese text produces real word
// tokens instead of nothing. The old implementation grabbed whole CJK runs
// (`系统已经上线` as ONE token), which almost never matched evidence — every
// Chinese claim scored zero coverage and got flagged. That is a false
// accusation, not a safe default.
function tokensOf(text) {
  return tokenize(text).filter(w => !STOP.has(w));
}

const SYN = {
  deployment: ['deploy', 'deployed', 'deployment'], deployed: ['deploy', 'deployed', 'deployment'], deploy: ['deploy', 'deployed', 'deployment'],
  succeeded: ['success', 'succeeded', 'successful', 'ok', 'passed'], success: ['success', 'succeeded', 'successful', 'ok', 'passed'],
  passed: ['pass', 'passed', 'success', 'ok'], tests: ['test', 'tests', 'suite', 'unit'], coverage: ['coverage', 'cover'],
  production: ['production', 'prod', 'live'], staging: ['staging', 'stage'], bugs: ['bug', 'bugs', 'issue', 'issues', 'error', 'errors'],
  latency: ['latency', 'p99', 'p95', 'delay'], cost: ['cost', 'costs', 'reduction'], accuracy: ['accuracy', 'acc'],
  上线: ['deploy', 'production', 'live', '上线', '部署'], 通过: ['pass', 'passed', 'success', '通过'], 测试: ['test', 'tests', '测试'],
  覆盖率: ['coverage', '覆盖率'], 生产: ['production', 'prod', '生产'],
};

function expand(tok) { return SYN[tok] || SYN[tok.toLowerCase()] || [tok]; }

export function parseEvidenceFacts(evidenceText) {
  if (!evidenceText?.trim()) return { facts: [], raw: '', tokenIndex: new Map(), sentences: [] };
  const facts = [];
  const lines = evidenceText.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  for (const line of lines) {
    i += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj = null;
    try { obj = JSON.parse(trimmed); } catch { /* plain */ }
    if (obj && typeof obj === 'object') {
      const flat = flatten(obj);
      const nums = [];
      const labels = [];
      for (const [k, v] of Object.entries(flat)) {
        labels.push(k);
        if (typeof v === 'number' && Number.isFinite(v)) nums.push({ key: k, value: normNum(v), unit: guessUnit(k, v) });
        else if (typeof v === 'string') for (const n of extractNums(v)) nums.push({ key: k, value: n.value, unit: n.unit || guessUnit(k, n.value) });
      }
      const blob = JSON.stringify(obj);
      facts.push({ id: `f${i}`, kind: 'json', line: i, snippet: clip(trimmed, 240), text: blob, tokens: new Set(tokensOf(blob + ' ' + labels.join(' '))), nums, fields: flat, polarity: polarityOf(blob) });
    } else {
      const nums = extractNums(trimmed).map(n => ({ key: 'text', value: n.value, unit: n.unit }));
      facts.push({ id: `f${i}`, kind: 'text', line: i, snippet: clip(trimmed, 240), text: trimmed, tokens: new Set(tokensOf(trimmed)), nums, fields: {}, polarity: polarityOf(trimmed) });
    }
  }
  // CT-2: character-offset index so a matched claim can be highlighted at its
  // real location in the evidence pane, instead of the UI re-searching for it.
  return {
    facts,
    raw: evidenceText,
    tokenIndex: buildTokenIndex(evidenceText),
    sentences: splitSentences(evidenceText),
  };
}

/**
 * CT-2: locate a claim's supporting tokens inside the evidence text.
 * @returns {{spans: Array<{start:number,end:number}>, coverage: number, matched: string[]}}
 */
export function locateEvidence(claim, evidence) {
  const toks = tokensOf(claim);
  if (!toks.length || !evidence?.tokenIndex) return { spans: [], coverage: 0, matched: [] };

  const spans = [];
  const matched = [];
  for (const tok of toks) {
    let locs = evidence.tokenIndex.get(tok.toLowerCase());
    if (!locs) {
      for (const syn of expand(tok)) {
        locs = evidence.tokenIndex.get(String(syn).toLowerCase());
        if (locs) break;
      }
    }
    if (locs?.length) {
      matched.push(tok);
      spans.push(...locs.slice(0, 3));
    }
  }
  // Numbers are the highest-signal spans, so index them explicitly too.
  for (const n of extractNums(claim).filter(x => !x.derived)) {
    const locs = evidence.tokenIndex.get(String(n.raw).toLowerCase());
    if (locs?.length) spans.push(...locs.slice(0, 3));
  }

  return {
    spans: mergeSpans(spans).slice(0, 12),
    coverage: toks.length ? matched.length / toks.length : 0,
    matched: [...new Set(matched)],
  };
}

/**
 * CT-3: the two conflict classes that keyword overlap structurally cannot see.
 * Both turn a would-be green tick into a flag, so they run on every claim that
 * has any evidence footprint at all.
 */
function detectConflicts(claim, evidence, located) {
  const out = { numeric: [], polarity: null };
  if (!evidence?.raw) return out;

  out.numeric = findNumericConflicts(claim, evidence.raw);

  // Compare against the single most similar evidence sentence, not the whole
  // document: a corpus containing both "passed" and "failed" somewhere would
  // otherwise always look contradictory.
  let best = null;
  for (const s of evidence.sentences ?? []) {
    const sTok = new Set(tokensOf(s.text));
    if (!sTok.size) continue;
    const cTok = tokensOf(claim);
    if (!cTok.length) continue;
    const overlap = cTok.filter(t => sTok.has(t)).length / cTok.length;
    if (!best || overlap > best.overlap) best = { sentence: s, overlap };
  }
  if (best && best.overlap > 0.5) {
    out.polarity = findPolarityConflict(claim, best.sentence.text, best.overlap);
    if (out.polarity) out.polarity.sentence = best.sentence;
  }
  return out;
}

function clip(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
function flatten(obj, prefix = '', out = {}, depth = 0) {
  if (depth > 6 || obj == null) return out;
  if (typeof obj !== 'object') { out[prefix || 'value'] = obj; return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => flatten(v, prefix ? `${prefix}[${i}]` : `[${i}]`, out, depth + 1)); return out; }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out, depth + 1); else out[key] = v;
  }
  return out;
}
function guessUnit(key, value) {
  const k = key.toLowerCase();
  if (/(percent|ratio|coverage|accuracy|rate|reduction)/.test(k)) return (typeof value === 'number' && value <= 1) ? '%-fraction' : '%';
  if (/(ms|latency)/.test(k)) return 'ms';
  return '';
}
function polarityOf(text) {
  const t = text.toLowerCase();
  return {
    neg: (t.match(/\bfail(ed|ing)?\b|\berror(s)?\b|\bbug(s)?\b|\bdegraded\b|失败|错误|缺陷/g) || []).length,
    pos: (t.match(/\bpass(ed)?\b|\bsuccess(ful)?\b|\bok\b|通过|成功/g) || []).length,
  };
}

const RISKS = [
  { id: 'perfect_number', re: /\b100\s*%|100％|百分之百|全覆盖/i },
  { id: 'bold_success', re: /\b(all\s+tests?\s+pass|no\s+(known\s+)?bugs?|bug[- ]free|全部通过|零缺陷)\b/i },
  { id: 'already_deployed', re: /\b(already|currently|now)\s+(running|deployed|live|in\s+production)|已上线|已部署|生产环境/i },
  { id: 'no_issues', re: /\b(no\s+(known\s+)?(issues?|errors?|problems?|bugs?)|zero\s+(errors?|issues?|bugs?|latency)|无(?:任何)?(?:问题|错误|缺陷)|零延迟)\b/i },
  { id: 'will_work', re: /\b(will\s+(definitely\s+)?work|guaranteed|absolutely|always\s+works?|any\s+load|一定(?:能|会)|保证|万无一失|任意负载)\b/i },
  { id: 'absolute_all', re: /\b(every\s+edge\s+case|all\s+environments?|fully\s+implemented|所有环境|完全实现)\b/i },
  { id: 'future_certainty', re: /必将|一定会成为|已经是最强|无人能及|will definitely|is the best ever/i },
];

function claimRisks(claim) { return RISKS.filter(r => r.re.test(claim)).map(r => r.id); }

function metricFamily(claimCtx, key = '', unit = '') {
  const s = `${claimCtx} ${key} ${unit}`.toLowerCase();
  if (/cost|price|usd|dollar|节省|成本|费用|api_cost|reduction/.test(s)) return 'cost';
  if (/cover|覆盖/.test(s)) return 'coverage';
  if (/accur|precision|recall|f1|准确/.test(s)) return 'accuracy';
  if (/latency|p99|p95|p50|delay|ms\b|耗时|延迟/.test(s)) return 'latency';
  if (/pass|fail|error|bug|test|suite|checks?/.test(s)) return 'tests';
  if (/concurrent|qps|rps|load|用户/.test(s)) return 'load';
  if (/%|percent|rate|ratio/.test(s)) return 'ratio';
  return 'generic';
}

function asPercent(value, unit, key = '') {
  if (unit === '%-fraction' || (unit !== '%' && value != null && value >= 0 && value <= 1 && /accur|rate|ratio|reduction|cover/i.test(key))) {
    return value * 100;
  }
  if (unit === '%' || /%/.test(String(unit))) return value;
  return value;
}

function scoreFact(claim, claimToks, claimNums, fact) {
  let score = 0;
  const matchedTokens = [];
  const matchedNums = [];
  const conflicts = [];
  const claimFamilyHints = metricFamily(claim);

  for (const tok of claimToks) {
    for (const c of expand(tok)) {
      if (fact.tokens.has(c) || fact.text.toLowerCase().includes(c)) {
        score += tok.length >= 6 ? 2.2 : 1.4;
        matchedTokens.push(tok);
        break;
      }
    }
  }

  for (const cn of claimNums.filter(n => !n.derived)) {
    // Infer claim number family from surrounding claim text + unit
    const cFamily = metricFamily(`${claim} ${cn.unit} ${cn.raw}`, '', cn.unit);
    let best = null;
    for (const fn of fact.nums) {
      const fFamily = metricFamily(claim, fn.key, fn.unit);
      // HARD RULE: never align cost% to coverage% etc.
      if (cFamily !== 'generic' && fFamily !== 'generic' && cFamily !== fFamily) {
        // same numeric coincidence is NOT support
        const cv = asPercent(cn.value, cn.unit, cFamily);
        const fv = asPercent(fn.value, fn.unit, fn.key);
        if (Math.abs(cv - fv) <= Math.max(1, Math.abs(cv) * 0.05)) {
          // near number but wrong family → conflict signal when claim is specific percent
          if (cn.unit === '%' || cFamily === 'cost' || cFamily === 'coverage' || cFamily === 'accuracy') {
            conflicts.push({
              claim: cn.raw,
              evidence: `${fn.key}=${fn.value}`,
              detail: `数值接近但指标家族不同：claim(${cFamily}) vs evidence(${fFamily}:${fn.key})`,
            });
            score -= 2;
          }
        }
        continue;
      }

      let fv = fn.value;
      let cv = cn.value;
      // normalize percent-like pairs only within family
      if ((cn.unit === '%' || /%/.test(cn.raw) || cFamily === 'accuracy' || cFamily === 'coverage' || cFamily === 'cost') && (fn.unit === '%-fraction' || (fv <= 1 && fv >= 0 && /accur|rate|ratio|reduction|cover/i.test(fn.key)))) {
        fv = fv <= 1 ? fv * 100 : fv;
      }
      const rel = Math.abs(fv - cv);
      const tol = Math.max(0.051, Math.abs(cv) * 0.02);
      if (rel <= tol) {
        const s = 7 + (cn.unit === '%' ? 1 : 0) + (cFamily === fFamily && cFamily !== 'generic' ? 2 : 0);
        if (!best || s > best.s) best = { s, fn, cFamily, fFamily };
      } else if ((cn.unit === '%' || cn.value >= 95) && cFamily === fFamily && (cFamily === 'coverage' || cFamily === 'accuracy' || cFamily === 'tests')) {
        const evN = (fn.unit === '%-fraction' || (fn.value <= 1 && /accur|cover|rate/i.test(fn.key))) ? fn.value * 100 : fn.value;
        if (cv >= 95 && evN < 95) {
          conflicts.push({ claim: cn.raw, evidence: `${fn.key}=${fn.value}`, detail: `claimed ${cn.raw} but evidence has ${fn.key}=${fn.value}` });
          score -= 4;
        }
      }
    }
    if (best) {
      score += best.s;
      matchedNums.push({ claim: cn.raw, evidence: `${best.fn.key}=${best.fn.value}`, family: best.cFamily });
    }
  }

  const fieldStr = Object.keys(fact.fields).join(' ').toLowerCase();
  if (/deploy|production|staging/.test(claim.toLowerCase()) && /deploy|environment|production|staging/.test(fieldStr)) score += 2;
  if (/test|coverage|pass/.test(claim.toLowerCase()) && /test|pass|fail|coverage|suite/.test(fieldStr)) score += 1.5;
  if (/cost|api/.test(claim.toLowerCase()) && /cost|reduction|api_cost/.test(fieldStr + fact.text.toLowerCase())) score += 2.5;
  if (/pipeline|bilibili|youtube|ci\/cd|checks/.test(claim.toLowerCase()) && /pipeline|bilibili|youtube|ci|status|feed/.test(fieldStr + fact.text.toLowerCase())) score += 2;
  if (/latency|concurrent|load/.test(claim.toLowerCase()) && /latency|concurrent|load|p99|errors/.test(fieldStr)) score += 2;
  return { score, matchedTokens: [...new Set(matchedTokens)], matchedNums, conflicts, fact };
}

function isAbsolute(claim) { return ABSOLUTE_RE.test(claim) || /\b(all|every|zero|no\s+)\b/i.test(claim); }

function pack(status, opts) {
  return {
    status,
    // CT-2: character offsets into the evidence text so the UI can highlight
    // the exact passage rather than guessing where the match came from.
    spans: opts.spans || [],
    conflictKind: opts.conflictKind || null,
    kind: opts.kind || 'assessment',
    evidenceMatches: opts.evidenceMatches || [],
    conflictSignals: opts.conflictSignals || [],
    isRisky: !!(opts.risks?.length || status === 'contradicted'),
    riskId: opts.risks?.[0] || null,
    riskIds: opts.risks || [],
    reasons: opts.reasons || [],
    evidenceSnippets: opts.evidenceSnippets || [],
    bestFactId: opts.bestFactId || null,
    confidence: opts.confidence ?? null,
  };
}

/** Mode B: no evidence — epistemic labeling, NOT "everything unsupported=0" */
function classifyWithoutEvidence(claim) {
  const kind = classifyKind(claim);
  const risks = claimRisks(claim);
  const reasons = [];

  if (kind === 'opinion' || kind === 'framework') {
    reasons.push(kind === 'framework'
      ? '架构/方案描述：属于设计建议，不是可核验事实断言'
      : '意见/建议类表述：无证据时不应判假，只标记为未核验建议');
    if (risks.length) reasons.push(`含绝对化风险词：${risks.join(', ')}`);
    return pack(risks.length ? 'needs_human' : 'opinion', {
      kind, risks, reasons, confidence: risks.length ? 0.35 : 0.55,
    });
  }

  if (kind === 'assessment') {
    const hedged = HEDGE_RE.test(claim);
    reasons.push(hedged
      ? '评估性判断且带限定语（目前/差距/可能）——作为观点可接受，但仍未证实'
      : '评估性判断：无外部证据，保持未证实');
    if (risks.length) reasons.push(`风险措辞：${risks.join(', ')}`);
    return pack(risks.length || ABSOLUTE_RE.test(claim) ? 'needs_human' : 'assessment', {
      kind, risks, reasons, confidence: hedged ? 0.5 : 0.4,
    });
  }

  // factual without evidence
  reasons.push('事实型断言但未提供证据 → 未证实（不是已证伪）');
  if (risks.length) reasons.push(`高风险措辞：${risks.join(', ')}`);
  if (extractNums(claim).some(n => n.unit === '%' && n.value === 100) || /zero latency|零延迟/.test(claim)) {
    return pack('needs_human', { kind: 'factual', risks: risks.length ? risks : ['perfect_number'], reasons, confidence: 0.2 });
  }
  return pack('unverified', {
    kind: 'factual',
    risks,
    reasons,
    confidence: 0.25,
  });
}

function classifyWithEvidence(claim, evidence) {
  const kind = classifyKind(claim);
  const risks = claimRisks(claim);
  const reasons = [];
  const claimToks = tokensOf(claim);
  const claimNums = extractNums(claim).filter(n => !n.derived);
  const evidenceMatches = [];
  const conflictSignals = [];
  const evidenceSnippets = [];

  // Only pure design/advice sentences skip evidence matching
  if ((kind === 'opinion' || kind === 'framework') && !claimNums.length && !/pass|deploy|coverage|latency|bug|error|准确|覆盖|上线|测试|production|staging|pipeline|ci\/cd|operational|running|implemented/i.test(claim)) {
    reasons.push('建议/架构类内容：证据日志通常无法直接证实或证伪');
    return pack('opinion', { kind, risks, reasons, confidence: 0.55 });
  }

  // CT-2 / CT-3: locate the claim inside the evidence and run the two conflict
  // detectors that pure keyword overlap structurally cannot see.
  const located = locateEvidence(claim, evidence);
  const detected = detectConflicts(claim, evidence, located);

  // A number that flatly disagrees inside the SAME metric family outranks any
  // amount of keyword overlap: "coverage 95%" vs "coverage: 62%" shares every
  // token, which is exactly why overlap scoring used to call it supported.
  if (detected.numeric.length) {
    for (const c of detected.numeric) {
      reasons.push(describeNumericConflict(c, hasCJK(claim) ? 'zh' : 'en'));
      conflictSignals.push(c.evidence.raw);
    }
    return pack('contradicted', {
      kind: 'factual',
      risks,
      reasons,
      evidenceMatches: located.matched,
      conflictSignals: uniq(conflictSignals),
      evidenceSnippets: uniqSnips(evidenceSnippets),
      confidence: 0.88,
      spans: located.spans,
      conflictKind: 'numeric',
    });
  }

  // Same subject, opposite polarity — "tests do not pass" vs "all tests pass".
  if (detected.polarity) {
    const p = detected.polarity;
    reasons.push(hasCJK(claim) ? p.detailZh : p.detail);
    conflictSignals.push(clip(p.sentence.text, 100));
    return pack('contradicted', {
      kind: 'factual',
      risks,
      reasons,
      evidenceMatches: located.matched,
      conflictSignals: uniq(conflictSignals),
      evidenceSnippets: [{ id: 'p0', line: 0, snippet: clip(p.sentence.text, 240), score: 0 }],
      confidence: 0.82,
      spans: [{ start: p.sentence.start, end: p.sentence.end }],
      conflictKind: 'polarity',
    });
  }

  const ranked = evidence.facts.map(f => scoreFact(claim, claimToks, claimNums, f)).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const strong = ranked.filter(r => r.score >= 4).slice(0, 3);
  for (const r of strong) {
    evidenceMatches.push(...r.matchedTokens, ...r.matchedNums.map(n => n.claim));
    for (const c of r.conflicts) {
      conflictSignals.push(c.evidence);
      reasons.push(c.detail);
    }
    if (r.score >= 3) evidenceSnippets.push({ id: r.fact.id, line: r.fact.line, snippet: r.fact.snippet, score: Math.round(r.score * 10) / 10 });
  }

  if (isAbsolute(claim) && /pass|success|no\s+bug|zero|全部通过|无(?:任何)?问题/i.test(claim)) {
    const bad = evidence.facts.find(f => f.polarity.neg > 0);
    if (bad) {
      conflictSignals.push(clip(bad.snippet, 80));
      reasons.push(`绝对化成功表述，但证据含失败/缺陷（L${bad.line}）`);
      evidenceSnippets.unshift({ id: bad.id, line: bad.line, snippet: bad.snippet, score: 0 });
      return pack('contradicted', {
        kind: 'factual', risks: risks.length ? risks : ['bold_success'], reasons,
        evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
        evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: bad.id, confidence: 0.85,
      });
    }
  }

  if (top?.conflicts?.length) {
    return pack('contradicted', {
      kind: 'factual', risks: risks.length ? risks : ['perfect_number'], reasons,
      evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
      evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: top.fact.id, confidence: 0.8,
    });
  }

  if (/\bproduction\b|生产|已上线/i.test(claim) && !/staging/i.test(claim)) {
    const hasProd = evidence.facts.some(f => /"environment"\s*:\s*"(production|prod|live)"|production|\bprod\b|\blive\b/i.test(f.text) && !/staging/i.test(f.text));
    const st = evidence.facts.find(f => /staging/i.test(f.text));
    if (!hasProd && st) {
      reasons.push('声称 production/已上线，证据只有 staging');
      conflictSignals.push('environment: staging');
      evidenceSnippets.push({ id: st.id, line: st.line, snippet: st.snippet, score: 1 });
      return pack('contradicted', {
        kind: 'factual',
        risks: risks.includes('already_deployed') ? risks : [...risks, 'already_deployed'],
        reasons, evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
        evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: st.id, confidence: 0.9,
      });
    }
  }

  // Pipeline both-ok vs degraded/failed feeds
  if (/pipeline|bilibili|youtube/i.test(claim) && /both|all|confirmed operational|都|全部|均/.test(claim)) {
    const pipe = evidence.facts.find(f => /youtube|bilibili|pipeline/i.test(f.text));
    if (pipe && /degraded|fail|error|down|quota exceeded/i.test(pipe.text)) {
      reasons.push(`管道并非全部正常：证据显示异常（L${pipe.line}）`);
      conflictSignals.push(clip(pipe.snippet, 100));
      evidenceSnippets.unshift({ id: pipe.id, line: pipe.line, snippet: pipe.snippet, score: 0 });
      return pack('contradicted', {
        kind: 'factual', risks, reasons,
        evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
        evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: pipe.id, confidence: 0.88,
      });
    }
  }

  // CI all green vs failed checks
  if (/ci\/cd|all checks are green|checks are green|全部绿灯|流水线/i.test(claim)) {
    const ci = evidence.facts.find(f => /ci_run|failing_checks|"status"\s*:\s*"failed"/i.test(f.text));
    if (ci && /failed|failing/i.test(ci.text)) {
      reasons.push(`CI 并非全绿：证据显示失败（L${ci.line}）`);
      conflictSignals.push(clip(ci.snippet, 100));
      evidenceSnippets.unshift({ id: ci.id, line: ci.line, snippet: ci.snippet, score: 0 });
      return pack('contradicted', {
        kind: 'factual', risks: risks.length ? risks : ['bold_success'], reasons,
        evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
        evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: ci.id, confidence: 0.9,
      });
    }
  }

  // Cost reduction claims need cost family evidence; coverage is not cost
  if (/cost|api costs|成本|费用/i.test(claim) && extractNums(claim).some(n => n.unit === '%' || /%/.test(n.raw))) {
    const costFact = evidence.facts.find(f => /cost|reduction|api_cost/i.test(f.text));
    const claimPct = extractNums(claim).find(n => n.unit === '%' || /%/.test(n.raw));
    if (costFact && claimPct) {
      // find numeric reduction
      const nums = costFact.nums.filter(n => /cost|reduction/i.test(n.key));
      if (nums.length) {
        const ev = nums[0];
        const evPct = ev.value <= 1 ? ev.value * 100 : ev.value;
        if (Math.abs(evPct - claimPct.value) > 8) {
          reasons.push(`成本降幅不匹配：claim ${claimPct.raw} vs evidence ${ev.key}=${ev.value}`);
          conflictSignals.push(`${ev.key}=${ev.value}`);
          evidenceSnippets.unshift({ id: costFact.id, line: costFact.line, snippet: costFact.snippet, score: 0 });
          return pack('contradicted', {
            kind: 'factual', risks, reasons,
            evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
            evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: costFact.id, confidence: 0.86,
          });
        }
      }
    } else if (!costFact) {
      // if only matched via coverage coincidence, strip false support later via family rules
      reasons.push('成本断言未找到 cost 类证据字段');
    }
  }

  // zero latency vs measured latency/errors
  if (/zero latency|零延迟|no latency/i.test(claim)) {
    const lt = evidence.facts.find(f => /latency|p99|errors/i.test(f.text));
    if (lt) {
      reasons.push(`零延迟断言与实测延迟/错误冲突（L${lt.line}）`);
      conflictSignals.push(clip(lt.snippet, 100));
      evidenceSnippets.unshift({ id: lt.id, line: lt.line, snippet: lt.snippet, score: 0 });
      return pack('contradicted', {
        kind: 'factual', risks: risks.length ? risks : ['no_issues'], reasons,
        evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
        evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: lt.id, confidence: 0.9,
      });
    }
  }

  const bestScore = top?.score || 0;
  const matchCount = uniq(evidenceMatches).length;

  // If top match is only cross-family numeric coincidence, demote hard
  const familyConflicts = (top?.conflicts || []).filter(c => /指标家族不同/.test(c.detail));
  if (familyConflicts.length && (!top.matchedNums.length || top.matchedNums.every(n => !n.family || n.family === 'generic'))) {
    for (const c of familyConflicts) {
      reasons.push(c.detail);
      conflictSignals.push(c.evidence);
    }
  }

  if (bestScore >= 6 || (bestScore >= 4.5 && matchCount >= 2)) {
    if (conflictSignals.length || familyConflicts.length) {
      // wrong-family near-miss should not become supported
      if (familyConflicts.length && top.matchedNums.length === 0) {
        reasons.push('存在数值巧合但指标不一致 → 不能算支撑');
        return pack('contradicted', {
          kind: 'factual', risks, reasons,
          evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
          evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: top?.fact?.id, confidence: 0.75,
        });
      }
      reasons.push('有支撑但残留冲突 → 需人工核对片段');
      return pack('needs_human', {
        kind, risks, reasons, evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
        evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: top?.fact?.id, confidence: 0.55,
        spans: located.spans,
      });
    }
    reasons.push(`命中证据 L${top.fact.line}（score ${bestScore.toFixed(1)}）`);
    for (const n of top.matchedNums) reasons.push(`数值对齐 ${n.claim} ≈ ${n.evidence}${n.family ? ' ['+n.family+']' : ''}`);
    return pack('supported', {
      kind: 'factual', risks, reasons, evidenceMatches: uniq(evidenceMatches), conflictSignals: [],
      evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: top.fact.id, confidence: Math.min(0.95, 0.55 + bestScore / 20),
      spans: located.spans,
    });
  }

  if (bestScore >= 2.5 || matchCount >= 1) {
    reasons.push(bestScore ? `弱匹配 L${top.fact.line}（score ${bestScore.toFixed(1)}）` : '仅有弱关键词重合');
    return pack('needs_human', {
      kind, risks, reasons, evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
      evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: top?.fact?.id, confidence: 0.45,
      spans: located.spans,
    });
  }

  // no match
  if (kind === 'opinion' || kind === 'framework' || kind === 'assessment') {
    reasons.push('未在证据中找到对应项；该句本身也更像判断/建议');
    return pack(kind === 'opinion' ? 'opinion' : 'assessment', { kind, risks, reasons, confidence: 0.5 });
  }

  reasons.push('事实型断言在证据中无支撑 → 未证实');
  return pack('unverified', {
    kind: 'factual', risks, reasons, evidenceMatches: [], conflictSignals: uniq(conflictSignals),
    evidenceSnippets: [], confidence: 0.3,
  });
}

function uniq(a) { return [...new Set((a || []).filter(Boolean))]; }
function uniqSnips(a) {
  const m = new Map();
  for (const s of a || []) if (s?.id && !m.has(s.id)) m.set(s.id, s);
  return [...m.values()].slice(0, 4);
}

export function classifyClaim(claim, evidence, hasEvidence) {
  return hasEvidence ? classifyWithEvidence(claim, evidence) : classifyWithoutEvidence(claim);
}

/**
 * EVIDENCE COVERAGE (formerly "trust score" — see CT-1).
 *
 * This number answers exactly one question: how much of what the AI asserted
 * can be located in the evidence you supplied? It is NOT a truth judgement.
 * A confident lie backed by a matching log line scores high; a correct claim
 * with no supporting log scores low. That is the intended behaviour, and it is
 * why the disclaimer under the score is permanent and non-collapsible.
 *
 * Returns null when there is no evidence: coverage against nothing is not
 * zero, it is undefined, and rendering "0/100" there reads as an accusation.
 */
export function computeEvidenceCoverage(results, { hasEvidence } = {}) {
  if (!hasEvidence) return null;
  if (!results.length) return 0;
  const weights = {
    supported: 1.0,
    opinion: hasEvidence ? 0.62 : 0.7,
    assessment: hasEvidence ? 0.55 : 0.62,
    needs_human: 0.4,
    unverified: 0.28,
    unsupported: 0.22, // legacy
    contradicted: 0.0,
  };
  const base = results.reduce((s, r) => s + (weights[r.status] ?? 0.4), 0) / results.length;
  const contra = results.filter(r => r.status === 'contradicted').length;
  const riskN = results.filter(r => r.isRisky).length;
  const supported = results.filter(r => r.status === 'supported').length;

  let score = base * 100;
  score -= Math.min(36, contra * 12);
  score -= Math.min(18, riskN * 4);
  score += Math.min(8, supported * 2);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Back-compat alias. The old name asserted a truth verdict the engine cannot
 * deliver; it is kept only so existing embeds do not break, and it now shares
 * the corrected semantics (null when there is no evidence).
 * @deprecated use computeEvidenceCoverage
 */
export const computeTrustScore = computeEvidenceCoverage;

/**
 * The review queue (CT-1 north star): the order a human should check things in.
 * Conflicts first, then unverified factual claims, then risky phrasing.
 * This ordering IS the product — the score is only a summary of it.
 */
export function buildReviewQueue(results) {
  const priority = {
    contradicted: 0,
    needs_human: 1,
    unverified: 2,
    unsupported: 2,
    assessment: 3,
    opinion: 4,
    supported: 5,
  };
  return [...results]
    .filter(r => (priority[r.status] ?? 9) <= 2 || r.isRisky)
    .sort((a, b) => {
      const pa = (priority[a.status] ?? 9) - (a.isRisky ? 0.5 : 0);
      const pb = (priority[b.status] ?? 9) - (b.isRisky ? 0.5 : 0);
      return pa - pb || a.id - b.id;
    });
}

export function analyze(answerText, evidenceText) {
  const claims = splitIntoClaims(answerText);
  const evidence = parseEvidenceFacts(evidenceText);
  const hasEvidence = !!(evidenceText && evidenceText.trim());

  const results = claims.map((claim, i) => ({
    id: i + 1,
    claim,
    ...classifyClaim(claim, evidence, hasEvidence),
  }));

  // normalize legacy alias for UI that still expects unsupported
  for (const r of results) {
    if (r.status === 'unverified') {
      // keep unverified; UI knows it
    }
  }

  const coverage = computeEvidenceCoverage(results, { hasEvidence });
  const riskFlags = uniq(results.flatMap(r => r.riskIds || (r.riskId ? [r.riskId] : [])));
  const stats = {
    total: results.length,
    supported: results.filter(r => r.status === 'supported').length,
    opinion: results.filter(r => r.status === 'opinion').length,
    assessment: results.filter(r => r.status === 'assessment').length,
    unverified: results.filter(r => r.status === 'unverified' || r.status === 'unsupported').length,
    unsupported: results.filter(r => r.status === 'unverified' || r.status === 'unsupported').length,
    contradicted: results.filter(r => r.status === 'contradicted').length,
    needs_human: results.filter(r => r.status === 'needs_human').length,
  };

  const mode = hasEvidence ? 'evidence-verify' : 'epistemic-audit';
  const summary = hasEvidence
    ? `证据核验模式：对照 ${evidence.facts.length} 条证据事实。可能冲突 ${stats.contradicted} · 找到证据 ${stats.supported} · 需人工 ${stats.needs_human}`
    : `认知审计模式（无证据）：不计算覆盖率，只标注句子类型。意见 ${stats.opinion} · 评估 ${stats.assessment} · 未证实事实 ${stats.unverified} · 需人工 ${stats.needs_human}`;

  return {
    claims: results,
    // `coverage` is the real name; `score` stays as an alias so existing
    // embeds and the CLI keep working. Both are null without evidence.
    coverage,
    score: coverage,
    reviewQueue: buildReviewQueue(results),
    stats,
    riskFlags,
    hasEvidence,
    factCount: evidence.facts.length,
    mode,
    summary,
    version: '2.1.0',
    metric: 'evidence-coverage',
    disclaimer: hasEvidence
      ? 'Coverage measures evidence match, not truth. Offline heuristics: high precision on explicit conflicts, no guarantee of correctness.'
      : 'No evidence supplied, so no coverage is computed. Claims are labelled by type only — not by whether they are true.',
  };
}

/**
 * CT-2: the exported report quotes the evidence each claim matched, so the
 * reader can check the reasoning without opening the tool. A report that only
 * says "❌ contradicted" is an accusation; one that shows the passage is a
 * citation.
 */
export function generateMarkdownReport(results) {
  const { claims, stats, riskFlags, hasEvidence, mode, summary, disclaimer, reviewQueue } = results;
  const coverage = results.coverage ?? results.score;
  const badge = {
    supported: '✅ evidence found', opinion: '💭 opinion', assessment: '🧭 assessment',
    needs_human: '🔍 verify manually', unverified: '⚠️ no evidence', unsupported: '⚠️ no evidence',
    contradicted: '❌ possible conflict',
  };

  let md = `# ClaimTape Report\n\n`;
  md += coverage == null
    ? `**Evidence Coverage:** n/a — no evidence supplied  \n`
    : `**Evidence Coverage:** ${coverage}/100  \n`;
  md += `**Mode:** ${mode}  \n**Evidence:** ${hasEvidence ? 'yes' : 'no'}  \n**Engine:** v2.1\n\n`;
  md += `> ${summary}\n\n`;
  md += `> ⚠️ ${disclaimer}\n\n`;

  if (hasEvidence && reviewQueue?.length) {
    md += `## Check these first\n\n`;
    reviewQueue.slice(0, 5).forEach((c, i) => {
      md += `${i + 1}. ${badge[c.status] || c.status} — #${c.id}: ${c.claim.slice(0, 120)}\n`;
    });
    md += '\n';
  }

  md += `| Status | n |\n|---|---|\n`;
  for (const [k, v] of Object.entries(stats)) md += `| ${k} | ${v} |\n`;
  md += '\n';
  if (riskFlags?.length) md += `## Risks\n${riskFlags.map(f => `- \`${f}\``).join('\n')}\n\n`;

  md += `## Claims\n\n`;
  for (const c of claims) {
    md += `### ${hasEvidence ? (badge[c.status] || c.status) : '⚪ not checked'} · #${c.id}\n\n> ${c.claim}\n\n`;
    if (c.kind) md += `**Kind:** ${c.kind}  \n`;
    if (c.conflictKind) md += `**Conflict:** ${c.conflictKind} mismatch  \n`;
    if (c.reasons?.length) md += `**Why:** ${c.reasons.join('; ')}  \n`;
    if (c.evidenceSnippets?.length) {
      md += `\n**Evidence quoted:**\n`;
      for (const s of c.evidenceSnippets) md += `> ${s.snippet.replace(/`/g, "'")}\n>\n`;
    }
    md += '\n';
  }
  return md + `\n---\n*ClaimTape v2.1 — local report. Coverage measures evidence match, not truth.*\n`;
}

export function generateJSONExport(results, answerText, evidenceText) {
  return JSON.stringify({
    meta: {
      tool: 'ClaimTape',
      version: '2.1.0',
      metric: 'evidence-coverage',
      generated: new Date().toISOString(),
    },
    input: { answerLength: answerText?.length ?? 0, evidenceLength: evidenceText?.length ?? 0, hasEvidence: !!evidenceText?.trim() },
    coverage: results.coverage ?? results.score,
    score: results.coverage ?? results.score, // legacy alias
    mode: results.mode,
    summary: results.summary,
    stats: results.stats,
    riskFlags: results.riskFlags,
    reviewQueue: (results.reviewQueue || []).map(c => c.id),
    claims: results.claims,
    disclaimer: results.disclaimer,
  }, null, 2);
}
