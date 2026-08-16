// ClaimTape Analysis Engine v1.3
// Two modes:
//  A) WITH evidence  → verify factual claims against facts (strict)
//  B) WITHOUT evidence → epistemic audit: fact vs opinion, hedging, overclaim
// Never pretends API-level omniscience; always separates "unverified" from "false".

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
  const isOpinion = OPINION_RE.test(claim) && !/已经|已上线|测试通过|准确率为|发布于/.test(claim);
  const isHedge = HEDGE_RE.test(claim);
  const isFactish = FACTISH_RE.test(claim) || /\b(is|are|was|were|has|have)\b/i.test(claim) && /\d/.test(claim);
  const isAbsolute = ABSOLUTE_RE.test(claim);
  if (isOpinion && !isFactish) return 'opinion';
  if (isHedge && !isFactish) return 'assessment';
  if (isFactish || /\d/.test(claim)) return 'factual';
  if (/^CODE:/.test(claim) || /┌|│|└|架构|核心/.test(claim)) return 'framework';
  return isOpinion ? 'opinion' : 'assessment';
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

function tokensOf(text) {
  const lower = String(text).toLowerCase();
  const en = (lower.match(/[a-z][a-z0-9_./-]{2,}/g) || []).filter(w => !STOP.has(w));
  const cn = String(text).match(/[\u4e00-\u9fff]{2,}/g) || [];
  return [...new Set([...en, ...cn])];
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
  if (!evidenceText?.trim()) return { facts: [], raw: '' };
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
  return { facts, raw: evidenceText };
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

function scoreFact(claim, claimToks, claimNums, fact) {
  let score = 0;
  const matchedTokens = [];
  const matchedNums = [];
  const conflicts = [];
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
    let best = null;
    for (const fn of fact.nums) {
      let fv = fn.value;
      const cv = cn.value;
      if ((cn.unit === '%' || /%/.test(cn.raw)) && fn.unit === '%-fraction') fv = fv * 100;
      const rel = Math.abs(fv - cv);
      const tol = Math.max(0.051, Math.abs(cv) * 0.02);
      if (rel <= tol) {
        const s = 6 + (cn.unit === '%' ? 1 : 0);
        if (!best || s > best.s) best = { s, fn };
      } else if ((cn.unit === '%' || cn.value >= 95) && /cover|accura|pass|success|rate|reduction/i.test(fn.key + String(fn.unit))) {
        const ev = fn.unit === '%-fraction' ? fv * (fv <= 1 ? 100 : 1) : fv;
        const evN = fn.unit === '%-fraction' ? fn.value * 100 : fn.value;
        if (cv >= 95 && evN < 95) {
          conflicts.push({ claim: cn.raw, evidence: `${fn.key}=${fn.value}`, detail: `claimed ${cn.raw} but evidence has ${fn.key}=${fn.value}` });
          score -= 4;
        }
      }
    }
    if (best) {
      score += best.s;
      matchedNums.push({ claim: cn.raw, evidence: `${best.fn.key}=${best.fn.value}` });
    }
  }
  const fieldStr = Object.keys(fact.fields).join(' ').toLowerCase();
  if (/deploy|production|staging/.test(claim.toLowerCase()) && /deploy|environment|production|staging/.test(fieldStr)) score += 1.5;
  if (/test|coverage|pass/.test(claim.toLowerCase()) && /test|pass|fail|coverage|suite/.test(fieldStr)) score += 1.5;
  return { score, matchedTokens: [...new Set(matchedTokens)], matchedNums, conflicts, fact };
}

function isAbsolute(claim) { return ABSOLUTE_RE.test(claim) || /\b(all|every|zero|no\s+)\b/i.test(claim); }

function pack(status, opts) {
  return {
    status,
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

  // Opinions with evidence still usually not "supported" by logs — unless explicitly about measured things
  if ((kind === 'opinion' || kind === 'framework') && !claimNums.length && !/pass|deploy|coverage|latency|bug|error|准确|覆盖|上线|测试/i.test(claim)) {
    reasons.push('建议/架构类内容：证据日志通常无法直接证实或证伪');
    return pack('opinion', { kind, risks, reasons, confidence: 0.55 });
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
    const hasProd = evidence.facts.some(f => /production|prod|live/i.test(f.text));
    const hasStaging = evidence.facts.some(f => /staging/i.test(f.text));
    if (!hasProd && hasStaging) {
      reasons.push('声称 production，证据只有 staging');
      conflictSignals.push('environment: staging');
      const st = evidence.facts.find(f => /staging/i.test(f.text));
      if (st) evidenceSnippets.push({ id: st.id, line: st.line, snippet: st.snippet, score: 1 });
      return pack('contradicted', {
        kind: 'factual',
        risks: risks.includes('already_deployed') ? risks : [...risks, 'already_deployed'],
        reasons, evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
        evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: st?.id, confidence: 0.82,
      });
    }
  }

  const bestScore = top?.score || 0;
  const matchCount = uniq(evidenceMatches).length;

  if (bestScore >= 6 || (bestScore >= 4.5 && matchCount >= 2)) {
    if (conflictSignals.length) {
      reasons.push('有支撑但残留冲突 → 需人工核对片段');
      return pack('needs_human', {
        kind, risks, reasons, evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
        evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: top?.fact?.id, confidence: 0.55,
      });
    }
    reasons.push(`命中证据 L${top.fact.line}（score ${bestScore.toFixed(1)}）`);
    for (const n of top.matchedNums) reasons.push(`数值对齐 ${n.claim} ≈ ${n.evidence}`);
    return pack('supported', {
      kind: 'factual', risks, reasons, evidenceMatches: uniq(evidenceMatches), conflictSignals: [],
      evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: top.fact.id, confidence: Math.min(0.95, 0.55 + bestScore / 20),
    });
  }

  if (bestScore >= 2.5 || matchCount >= 1) {
    reasons.push(bestScore ? `弱匹配 L${top.fact.line}（score ${bestScore.toFixed(1)}）` : '仅有弱关键词重合');
    return pack('needs_human', {
      kind, risks, reasons, evidenceMatches: uniq(evidenceMatches), conflictSignals: uniq(conflictSignals),
      evidenceSnippets: uniqSnips(evidenceSnippets), bestFactId: top?.fact?.id, confidence: 0.45,
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
 * Trust score philosophy v1.3:
 * - contradicted hurts a lot
 * - supported helps
 * - opinion/assessment without evidence is NEUTRAL-ISH (not free points, not zero)
 * - unverified factual is low but not automatic total zero unless many
 */
export function computeTrustScore(results, { hasEvidence } = {}) {
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
  const factualUnverified = results.filter(r => r.status === 'unverified' || (r.status === 'unsupported' && r.kind === 'factual')).length;
  const supported = results.filter(r => r.status === 'supported').length;

  let score = base * 100;
  score -= Math.min(36, contra * 12);
  score -= Math.min(18, riskN * 4);
  if (hasEvidence) score += Math.min(8, supported * 2);
  else {
    // pure advice docs shouldn't collapse to 0
    const opinionRatio = results.filter(r => r.status === 'opinion' || r.status === 'assessment').length / results.length;
    if (opinionRatio >= 0.5) score = Math.max(score, 48 - contra * 10 - riskN * 3);
    score -= Math.min(12, factualUnverified * 2);
  }
  return Math.max(0, Math.min(100, Math.round(score)));
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

  const score = computeTrustScore(results, { hasEvidence });
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
    ? `证据核验模式：对照 ${evidence.facts.length} 条证据事实。矛盾 ${stats.contradicted} · 有支撑 ${stats.supported} · 需人工 ${stats.needs_human}`
    : `认知审计模式（无证据）：不把建议文打成全假。意见 ${stats.opinion} · 评估 ${stats.assessment} · 未证实事实 ${stats.unverified} · 需人工 ${stats.needs_human}`;

  return {
    claims: results,
    score,
    stats,
    riskFlags,
    hasEvidence,
    factCount: evidence.facts.length,
    mode,
    summary,
    version: '1.3.0',
    disclaimer: 'Offline heuristic auditor — high precision on explicit evidence conflicts; not a guarantee of absolute truth.',
  };
}

export function generateMarkdownReport(results) {
  const { claims, score, stats, riskFlags, hasEvidence, mode, summary, disclaimer } = results;
  const badge = {
    supported: '✅ supported', opinion: '💭 opinion', assessment: '🧭 assessment',
    needs_human: '🔍 needs human', unverified: '⬜ unverified', unsupported: '⚠️ unsupported',
    contradicted: '❌ contradicted',
  };
  let md = `# ClaimTape Report\n\n**Score:** ${score}/100  \n**Mode:** ${mode}  \n**Evidence:** ${hasEvidence ? 'yes' : 'no'}  \n**Engine:** v1.3\n\n> ${summary}\n\n> ${disclaimer}\n\n`;
  md += `| Status | n |\n|---|---|\n`;
  for (const [k, v] of Object.entries(stats)) md += `| ${k} | ${v} |\n`;
  md += '\n';
  if (riskFlags?.length) md += `## Risks\n${riskFlags.map(f => `- \`${f}\``).join('\n')}\n\n`;
  md += `## Claims\n\n`;
  for (const c of claims) {
    md += `### ${badge[c.status] || c.status} · #${c.id}\n\n> ${c.claim}\n\n`;
    if (c.kind) md += `**Kind:** ${c.kind}  \n`;
    if (c.reasons?.length) md += `**Why:** ${c.reasons.join('; ')}  \n`;
    if (c.evidenceSnippets?.length) {
      md += `\n**Snippets:**\n`;
      for (const s of c.evidenceSnippets) md += `- L${s.line}: \`${s.snippet.replace(/`/g, "'")}\`\n`;
    }
    md += '\n';
  }
  return md + `\n---\n*ClaimTape local report*\n`;
}

export function generateJSONExport(results, answerText, evidenceText) {
  return JSON.stringify({
    meta: { tool: 'ClaimTape', version: '1.3.0', generated: new Date().toISOString() },
    input: { answerLength: answerText?.length ?? 0, evidenceLength: evidenceText?.length ?? 0, hasEvidence: !!evidenceText?.trim() },
    score: results.score,
    mode: results.mode,
    summary: results.summary,
    stats: results.stats,
    riskFlags: results.riskFlags,
    claims: results.claims,
    disclaimer: results.disclaimer,
  }, null, 2);
}
