// ClaimTape Analysis Engine v1.2
// Offline, evidence-first. Every status must point at a concrete fact when possible.

const STOP = new Set(`the and has have been with for are that this from will all can its our their they was were not but also any each both such into over than more most very just about only some which when what who how why there here then them being does did would could should shall may might must upon within across under your you we it is in on to of as by or an at be a to`.split(/\s+/));

export function splitIntoClaims(text) {
  if (!text?.trim()) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) || /^[-*_]{3,}$/.test(line)) continue;
    if (/^[-•*▪▸►]\s+/.test(line) || /^\d+[.)、]\s*/.test(line)) {
      const c = line.replace(/^[-•*▪▸►]\s+/, '').replace(/^\d+[.)、]\s*/, '').trim();
      if (c.length >= 1) out.push(c);
      continue;
    }
    // Prefer splitting on clear sentence boundaries; keep short clauses
    let parts = line
      .split(/(?<=[。！？!?；;])\s*/)
      .flatMap(seg => seg.split(/(?<=\.)\s+(?=[A-Z0-9“"‘'《])/))
      .map(s => s.trim())
      .filter(Boolean);
    // If regex didn't split (e.g. "A. B. C."), try simple ". " split
    if (parts.length <= 1 && /\.\s+/.test(line)) {
      parts = line.split(/\.\s+/).map(s => s.trim()).filter(Boolean).map((s, i, arr) => (i < arr.length - 1 && !/[.!?。]$/.test(s) ? s + '.' : s));
    }
    parts = parts.filter(s => s.length >= 1);
    if (parts.length > 1) out.push(...parts);
    else if (line.length >= 1) out.push(line);
  }
  const seen = new Set();
  return out.filter(c => {
    const k = c.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
    let v = Number(m[1]);
    let unit = (m[2] || '').toLowerCase().replace('％', '%');
    // 0.94 accuracy → also keep as percent-ish
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
  deployment: ['deploy', 'deployed', 'deployment'],
  deployed: ['deploy', 'deployed', 'deployment'],
  deploy: ['deploy', 'deployed', 'deployment'],
  succeeded: ['success', 'succeeded', 'successful', 'ok', 'passed'],
  success: ['success', 'succeeded', 'successful', 'ok', 'passed'],
  successful: ['success', 'succeeded', 'successful', 'ok'],
  passed: ['pass', 'passed', 'success', 'ok'],
  pass: ['pass', 'passed', 'success'],
  tests: ['test', 'tests', 'suite', 'unit'],
  test: ['test', 'tests', 'suite'],
  coverage: ['coverage', 'cover'],
  production: ['production', 'prod', 'live'],
  staging: ['staging', 'stage'],
  bugs: ['bug', 'bugs', 'issue', 'issues', 'error', 'errors'],
  bug: ['bug', 'bugs', 'issue', 'error'],
  latency: ['latency', 'p99', 'p95', 'delay'],
  cost: ['cost', 'costs', 'api_cost', 'reduction'],
  accuracy: ['accuracy', 'acc'],
  pipeline: ['pipeline', 'ci', 'cd', 'feed'],
  green: ['green', 'success', 'passed', 'ok'],
  operational: ['ok', 'operational', 'running', 'success'],
  running: ['running', 'live', 'deployed', 'ok'],
  zero: ['zero', '0', 'none'],
  上线: ['deploy', 'production', 'live', '上线', '部署'],
  部署: ['deploy', '部署', '上线'],
  通过: ['pass', 'passed', 'success', '通过'],
  测试: ['test', 'tests', '测试'],
  覆盖率: ['coverage', '覆盖率'],
  生产: ['production', 'prod', '生产'],
};

function expand(tok) {
  return SYN[tok] || SYN[tok.toLowerCase()] || [tok];
}

/** Parse evidence into atomic facts with snippets */
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
        if (typeof v === 'number' && Number.isFinite(v)) {
          nums.push({ key: k, value: normNum(v), unit: guessUnit(k, v) });
        } else if (typeof v === 'string') {
          for (const n of extractNums(v)) nums.push({ key: k, value: n.value, unit: n.unit || guessUnit(k, n.value) });
        }
      }
      const blob = JSON.stringify(obj);
      facts.push({
        id: `f${i}`,
        kind: 'json',
        line: i,
        snippet: trimmed.length > 220 ? trimmed.slice(0, 220) + '…' : trimmed,
        text: blob,
        tokens: new Set(tokensOf(blob + ' ' + labels.join(' '))),
        nums,
        fields: flat,
        polarity: polarityOf(blob),
      });
    } else {
      const nums = extractNums(trimmed).map(n => ({ key: 'text', value: n.value, unit: n.unit }));
      facts.push({
        id: `f${i}`,
        kind: 'text',
        line: i,
        snippet: trimmed.length > 220 ? trimmed.slice(0, 220) + '…' : trimmed,
        text: trimmed,
        tokens: new Set(tokensOf(trimmed)),
        nums,
        fields: {},
        polarity: polarityOf(trimmed),
      });
    }
  }
  return { facts, raw: evidenceText };
}

function flatten(obj, prefix = '', out = {}, depth = 0) {
  if (depth > 6 || obj == null) return out;
  if (typeof obj !== 'object') {
    out[prefix || 'value'] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, prefix ? `${prefix}[${i}]` : `[${i}]`, out, depth + 1));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out, depth + 1);
    else out[key] = v;
  }
  return out;
}

function guessUnit(key, value) {
  const k = key.toLowerCase();
  if (/(percent|ratio|coverage|accuracy|rate|reduction)/.test(k)) {
    if (typeof value === 'number' && value <= 1) return '%-fraction';
    return '%';
  }
  if (/(ms|latency)/.test(k)) return 'ms';
  if (/(sec|seconds)/.test(k)) return 's';
  return '';
}

function polarityOf(text) {
  const t = text.toLowerCase();
  const neg = (t.match(/\bfail(ed|ing)?\b|\berror(s)?\b|\bbug(s)?\b|\bcrash|\bdegraded\b|\brollback\b|失败|错误|缺陷/g) || []).length;
  const pos = (t.match(/\bpass(ed)?\b|\bsuccess(ful)?\b|\bok\b|\bgreen\b|通过|成功/g) || []).length;
  return { neg, pos };
}

const RISKS = [
  { id: 'perfect_number', re: /\b100\s*%|100％|百分之百|全覆盖/i },
  { id: 'bold_success', re: /\b(all\s+tests?\s+pass|tests?\s+all\s+pass|no\s+(known\s+)?bugs?|bug[- ]free|全部通过|零缺陷)\b/i },
  { id: 'already_deployed', re: /\b(already|currently|now)\s+(running|deployed|live|in\s+production)|已上线|已部署|生产环境/i },
  { id: 'no_issues', re: /\b(no\s+(known\s+)?(issues?|errors?|problems?|bugs?)|zero\s+(errors?|issues?|bugs?|latency)|无(?:任何)?(?:问题|错误|缺陷)|零延迟)\b/i },
  { id: 'will_work', re: /\b(will\s+(definitely\s+)?work|guaranteed|absolutely|always\s+works?|any\s+load|一定(?:能|会)|保证|万无一失|任意负载)\b/i },
  { id: 'absolute_all', re: /\b(every\s+edge\s+case|all\s+environments?|fully\s+implemented|complete(ly)?\s+done|所有环境|完全实现|全部完成)\b/i },
];

function claimRisks(claim) {
  return RISKS.filter(r => r.re.test(claim)).map(r => r.id);
}

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

  for (const cn of claimNums) {
    let best = null;
    for (const fn of fact.nums) {
      let fv = fn.value;
      let cv = cn.value;
      // normalize fraction percents
      if ((cn.unit === '%' || /%/.test(cn.raw)) && fn.unit === '%-fraction') fv = fv * 100;
      if (cn.unit === '%' && fv <= 1 && fv > 0 && fn.unit !== '%-fraction') {
        // maybe already percent
      }
      if (fn.unit === '%' && cv <= 1 && cn.unit !== '%') {
        // skip
      }
      const rel = Math.abs(fv - cv);
      const tol = Math.max(0.051, Math.abs(cv) * 0.02);
      if (rel <= tol) {
        const s = 6 + (cn.unit === '%' ? 1 : 0);
        if (!best || s > best.s) best = { s, fn, cv, fv, rel };
      } else if ((cn.unit === '%' || cn.value >= 95) && /cover|accura|pass|success|rate|reduction/i.test(fn.key + String(fn.unit)) && Math.abs((fn.unit === '%-fraction' ? fv * 100 : fv) - cv) > 5) {
        const ev = fn.unit === '%-fraction' ? fv * 100 : fv;
        if (cv >= 95 && ev < 95) {
          conflicts.push({
            claim: cn.raw,
            evidence: `${fn.key}=${fn.value}`,
            detail: `claimed ${cn.raw} but evidence has ${fn.key}=${fn.value}`,
          });
          score -= 4;
        }
      }
    }
    if (best) {
      score += best.s;
      matchedNums.push({ claim: cn.raw, evidence: `${best.fn.key}=${best.fn.value}`, key: best.fn.key });
    }
  }

  // field-name soft boost
  const fieldStr = Object.keys(fact.fields).join(' ').toLowerCase();
  if (/deploy|production|staging/.test(claim.toLowerCase()) && /deploy|environment|production|staging/.test(fieldStr)) score += 1.5;
  if (/test|coverage|pass/.test(claim.toLowerCase()) && /test|pass|fail|coverage|suite/.test(fieldStr)) score += 1.5;

  return { score, matchedTokens: [...new Set(matchedTokens)], matchedNums, conflicts, fact };
}

function isAbsolute(claim) {
  return /\b(all|every|zero|no\s+|100\s*%|全部|所有|零|无(?:任何)?|任意)\b/i.test(claim);
}

function hasSpecific(claim) {
  return extractNums(claim).length > 0
    || /\/[\w./-]+/.test(claim)
    || /`[^`]+`/.test(claim)
    || /\b(npm|git|docker|kubectl|python|node|pnpm)\b/i.test(claim);
}

export function classifyClaim(claim, evidence, hasEvidence) {
  const claimToks = tokensOf(claim);
  const claimNums = extractNums(claim).filter(n => !n.derived);
  const risks = claimRisks(claim);
  const reasons = [];
  const evidenceMatches = [];
  const conflictSignals = [];
  const evidenceSnippets = [];

  if (!hasEvidence) {
    if (hasSpecific(claim)) {
      reasons.push('含具体数值/路径，但未提供证据');
      return pack('needs_human', evidenceMatches, conflictSignals, risks, reasons, evidenceSnippets, null);
    }
    reasons.push('未提供证据');
    return pack(risks.length ? 'unsupported' : 'unsupported', evidenceMatches, conflictSignals, risks, reasons, evidenceSnippets, null);
  }

  const ranked = evidence.facts
    .map(f => scoreFact(claim, claimToks, claimNums, f))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const strong = ranked.filter(r => r.score >= 4).slice(0, 3);

  for (const r of strong) {
    evidenceMatches.push(...r.matchedTokens, ...r.matchedNums.map(n => n.claim));
    for (const c of r.conflicts) {
      conflictSignals.push(c.evidence);
      reasons.push(c.detail);
    }
    if (r.score >= 3) {
      evidenceSnippets.push({
        id: r.fact.id,
        line: r.fact.line,
        snippet: r.fact.snippet,
        score: Math.round(r.score * 10) / 10,
      });
    }
  }

  // Global polarity: absolute success claims vs any fail/bug facts
  if (isAbsolute(claim) && /pass|success|no\s+bug|zero|全部通过|无(?:任何)?问题/i.test(claim)) {
    const bad = evidence.facts.find(f => f.polarity.neg > 0 && /fail|error|bug|degraded/i.test(f.text));
    if (bad) {
      conflictSignals.push(bad.snippet.slice(0, 80));
      reasons.push(`绝对化成功表述，但证据含失败/缺陷信号（L${bad.line}）`);
      evidenceSnippets.unshift({ id: bad.id, line: bad.line, snippet: bad.snippet, score: 0 });
      return pack('contradicted', uniq(evidenceMatches), uniq(conflictSignals), risks.length ? risks : ['bold_success'], reasons, uniqSnips(evidenceSnippets), top);
    }
  }

  // Number hard conflicts from top facts
  if (top && top.conflicts.length) {
    return pack('contradicted', uniq(evidenceMatches), uniq(conflictSignals), risks.length ? risks : ['perfect_number'], reasons, uniqSnips(evidenceSnippets), top);
  }

  // Production claim vs staging-only evidence
  if (/\bproduction\b|生产|已上线/i.test(claim) && !/staging/i.test(claim)) {
    const hasProd = evidence.facts.some(f => /production|prod|live/i.test(f.text) && !/staging/i.test(JSON.stringify(f.fields)));
    const hasStaging = evidence.facts.some(f => /staging/i.test(f.text));
    if (!hasProd && hasStaging) {
      reasons.push('声称 production，但证据只有 staging');
      conflictSignals.push('environment: staging');
      const st = evidence.facts.find(f => /staging/i.test(f.text));
      if (st) evidenceSnippets.push({ id: st.id, line: st.line, snippet: st.snippet, score: 1 });
      return pack('contradicted', uniq(evidenceMatches), uniq(conflictSignals), risks.includes('already_deployed') ? risks : [...risks, 'already_deployed'], reasons, uniqSnips(evidenceSnippets), top);
    }
  }

  // 100% / zero latency special
  if (/\b100\s*%/i.test(claim) || /zero\s+latency|零延迟/i.test(claim)) {
    reasons.push(risks.includes('perfect_number') || /100/.test(claim) ? '完美率/零延迟类断言默认高风险' : '绝对性能断言');
    // if evidence has counter number, contradict
    if (conflictSignals.length || ranked.some(r => r.conflicts.length)) {
      return pack('contradicted', uniq(evidenceMatches), uniq(conflictSignals), risks, reasons, uniqSnips(evidenceSnippets), top);
    }
  }

  const bestScore = top?.score || 0;
  const matchCount = uniq(evidenceMatches).length;

  if (bestScore >= 6 || (bestScore >= 4.5 && matchCount >= 2)) {
    if (conflictSignals.length) {
      reasons.push('整体有支撑，但存在残留冲突 → 需人工看证据片段');
      return pack('needs_human', uniq(evidenceMatches), uniq(conflictSignals), risks, reasons, uniqSnips(evidenceSnippets), top);
    }
    reasons.push(`命中证据 L${top.fact.line}（score ${bestScore.toFixed(1)}）`);
    for (const n of top.matchedNums) reasons.push(`数值对齐 ${n.claim} ≈ ${n.evidence}`);
    return pack('supported', uniq(evidenceMatches), uniq(conflictSignals), risks, reasons, uniqSnips(evidenceSnippets), top);
  }

  if (bestScore >= 2.5 || matchCount >= 1) {
    reasons.push(bestScore ? `弱匹配证据 L${top.fact.line}（score ${bestScore.toFixed(1)}）` : '仅有弱关键词重合');
    return pack('needs_human', uniq(evidenceMatches), uniq(conflictSignals), risks, reasons, uniqSnips(evidenceSnippets), top);
  }

  if (hasSpecific(claim)) {
    reasons.push('具体断言未在证据中找到对应事实');
    return pack('needs_human', [], uniq(conflictSignals), risks, reasons, [], top);
  }

  reasons.push('证据中无支撑');
  return pack('unsupported', [], uniq(conflictSignals), risks, reasons, [], top);
}

function pack(status, evidenceMatches, conflictSignals, risks, reasons, evidenceSnippets, top) {
  return {
    status,
    evidenceMatches,
    conflictSignals,
    isRisky: risks.length > 0 || status === 'contradicted',
    riskId: risks[0] || null,
    riskIds: risks,
    reasons,
    evidenceSnippets: evidenceSnippets || [],
    bestFactId: top?.fact?.id || null,
  };
}

function uniq(a) { return [...new Set(a.filter(Boolean))]; }
function uniqSnips(a) {
  const m = new Map();
  for (const s of a) if (s?.id && !m.has(s.id)) m.set(s.id, s);
  return [...m.values()].slice(0, 4);
}

export function computeTrustScore(results) {
  if (!results.length) return 0;
  const w = { supported: 1, needs_human: 0.42, unsupported: 0.1, contradicted: 0 };
  const base = results.reduce((s, r) => s + (w[r.status] ?? 0.2), 0) / results.length;
  const riskN = results.filter(r => r.isRisky).length;
  const contra = results.filter(r => r.status === 'contradicted').length;
  const hasEv = results.some(r => (r.evidenceMatches?.length || 0) > 0 || (r.evidenceSnippets?.length || 0) > 0);
  let score = base * 100 - Math.min(42, riskN * 6 + contra * 10) + (hasEv ? 3 : -14);
  // density of absolute language
  score -= Math.min(12, results.filter(r => r.riskIds?.some(id => ['will_work', 'absolute_all', 'perfect_number'].includes(id))).length * 3);
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
  const score = computeTrustScore(results);
  const riskFlags = uniq(results.flatMap(r => r.riskIds || (r.riskId ? [r.riskId] : [])));
  const stats = {
    total: results.length,
    supported: results.filter(r => r.status === 'supported').length,
    unsupported: results.filter(r => r.status === 'unsupported').length,
    contradicted: results.filter(r => r.status === 'contradicted').length,
    needs_human: results.filter(r => r.status === 'needs_human').length,
  };
  return {
    claims: results,
    score,
    stats,
    riskFlags,
    hasEvidence,
    factCount: evidence.facts.length,
    version: '1.2.0',
  };
}

export function generateMarkdownReport(results) {
  const { claims, score, stats, riskFlags, hasEvidence } = results;
  const badge = { supported: '✅', unsupported: '⚠️', contradicted: '❌', needs_human: '🔍' };
  let md = `# ClaimTape Report\n\n**Trust Score:** ${score}/100  \n**Evidence:** ${hasEvidence ? 'yes' : 'no'}  \n**Engine:** v1.2\n\n`;
  md += `| Metric | n |\n|---|---|\n| Total | ${stats.total} |\n| Supported | ${stats.supported} |\n| Unsupported | ${stats.unsupported} |\n| Contradicted | ${stats.contradicted} |\n| Needs human | ${stats.needs_human} |\n\n`;
  if (riskFlags.length) md += `## Risks\n${riskFlags.map(f => `- \`${f}\``).join('\n')}\n\n`;
  md += `## Claims\n\n`;
  for (const c of claims) {
    md += `### ${badge[c.status] || ''} Claim ${c.id}\n\n> ${c.claim}\n\n`;
    if (c.reasons?.length) md += `**Why:** ${c.reasons.join('; ')}\n\n`;
    if (c.evidenceSnippets?.length) {
      md += `**Evidence snippets:**\n`;
      for (const s of c.evidenceSnippets) md += `- L${s.line}: \`${s.snippet.replace(/`/g, "'")}\`\n`;
      md += '\n';
    }
  }
  md += `---\n*ClaimTape local report*\n`;
  return md;
}

export function generateJSONExport(results, answerText, evidenceText) {
  return JSON.stringify({
    meta: { tool: 'ClaimTape', version: '1.2.0', generated: new Date().toISOString() },
    input: { answerLength: answerText?.length ?? 0, evidenceLength: evidenceText?.length ?? 0, hasEvidence: !!evidenceText?.trim() },
    score: results.score,
    stats: results.stats,
    riskFlags: results.riskFlags,
    claims: results.claims,
  }, null, 2);
}
