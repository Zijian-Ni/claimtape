// ClaimTape Analysis Engine v1.1
// Offline heuristics — no API required.
// Fixes: weak keyword support, number mismatch, CN sentence split, missing reasons.

const STOP_WORDS = new Set([
  'the', 'and', 'has', 'have', 'been', 'with', 'for', 'are', 'that', 'this',
  'from', 'will', 'all', 'can', 'its', 'our', 'their', 'they', 'was', 'were',
  'not', 'but', 'also', 'any', 'each', 'both', 'such', 'into', 'over', 'than',
  'more', 'most', 'very', 'just', 'about', 'only', 'some', 'which', 'when',
  'what', 'who', 'how', 'why', 'there', 'here', 'then', 'them', 'been',
  'being', 'does', 'did', 'would', 'could', 'should', 'shall', 'may', 'might',
  'must', 'upon', 'within', 'across', 'under', 'your', 'you', 'we', 'it',
  'is', 'in', 'on', 'to', 'of', 'as', 'by', 'or', 'an', 'at', 'be',
  // common CN function-ish short tokens filtered later by length
]);

// ───── Claim Splitter ─────

export function splitIntoClaims(text) {
  if (!text || !text.trim()) return [];

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const claims = [];

  for (const line of lines) {
    // headings / separators — skip empty noise
    if (/^#{1,6}\s/.test(line) || /^[-*_]{3,}$/.test(line)) continue;

    // bullet / numbered list = one claim
    if (/^[-•*▪▸►]\s+/.test(line) || /^\d+[.)、]\s*/.test(line)) {
      const cleaned = line
        .replace(/^[-•*▪▸►]\s+/, '')
        .replace(/^\d+[.)、]\s*/, '')
        .trim();
      if (cleaned.length > 3) claims.push(cleaned);
      continue;
    }

    // Chinese-aware sentence split + EN punctuation
    const parts = line
      .split(/(?<=[。！？!?；;])\s*|(?<=[.!?]["'”’]?)\s+(?=[A-Z0-9“"‘'])/)
      .map(s => s.trim())
      .filter(Boolean);

    if (parts.length <= 1) {
      if (line.length > 6) claims.push(line);
      continue;
    }
    for (const s of parts) {
      if (s.length > 6) claims.push(s);
    }
  }

  // dedupe while preserving order
  const seen = new Set();
  return claims.filter(c => {
    const key = c.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ───── Evidence Parser ─────

function parseEvidence(evidenceText) {
  if (!evidenceText || !evidenceText.trim()) {
    return { tokens: new Set(), numbers: new Map(), phrases: new Set(), raw: '', facts: [] };
  }

  const tokens = new Set();
  const numbers = new Map(); // normalized number string -> contexts
  const phrases = new Set();
  const facts = [];

  const lines = evidenceText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const obj = JSON.parse(trimmed);
      extractTokensFromObj(obj, tokens, numbers, phrases, facts);
      continue;
    } catch {
      // not JSON
    }

    extractTokensFromText(trimmed, tokens, numbers, phrases);
    facts.push({ kind: 'text', text: trimmed });
  }

  return { tokens, numbers, phrases, raw: evidenceText, facts };
}

function extractTokensFromObj(obj, tokens, numbers, phrases, facts, depth = 0, path = '') {
  if (depth > 6) return;
  if (typeof obj === 'string') {
    extractTokensFromText(obj, tokens, numbers, phrases);
    facts.push({ kind: 'string', path, value: obj });
  } else if (typeof obj === 'number' && Number.isFinite(obj)) {
    rememberNumber(numbers, obj, path || 'value');
    tokens.add(String(obj));
    facts.push({ kind: 'number', path, value: obj });
  } else if (typeof obj === 'boolean') {
    tokens.add(String(obj));
    facts.push({ kind: 'bool', path, value: obj });
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => extractTokensFromObj(v, tokens, numbers, phrases, facts, depth + 1, `${path}[${i}]`));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const key = String(k).toLowerCase();
      tokens.add(key);
      // multiword keys as phrase
      if (key.includes('_') || key.includes('-') || key.includes(' ')) {
        phrases.add(key.replace(/[_-]+/g, ' '));
      }
      extractTokensFromObj(v, tokens, numbers, phrases, facts, depth + 1, path ? `${path}.${k}` : k);
    }
  }
}

function extractTokensFromText(text, tokens, numbers, phrases) {
  const lower = text.toLowerCase();

  // EN words / paths / ids
  const words = lower.match(/[a-z0-9_./-]{3,}/g) || [];
  words.forEach(w => tokens.add(w));

  // CN tokens (2+ han)
  const hans = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  hans.forEach(h => tokens.add(h));

  // bigrams of CN for fuzzy
  for (const h of hans) {
    if (h.length >= 4) {
      for (let i = 0; i < h.length - 1; i++) tokens.add(h.slice(i, i + 2));
    }
  }

  // numbers with optional unit / percent
  const numRe = /([-+]?\d+(?:\.\d+)?)\s*(%|％|ms|s|sec|secs|seconds|m|min|h|x|×|k|kb|mb|gb|tb)?/gi;
  let m;
  while ((m = numRe.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] || '').toLowerCase().replace('％', '%');
    rememberNumber(numbers, n, unit || 'bare', m[0]);
    tokens.add(String(n));
    if (unit) tokens.add(`${n}${unit}`);
  }

  // short phrases (quoted)
  const quoted = text.match(/["“”'‘']([^"'“”‘’]{3,80})["“”'‘']/g) || [];
  quoted.forEach(q => phrases.add(q.replace(/^["“”'‘']|["“”'‘']$/g, '').toLowerCase()));
}

function rememberNumber(map, value, context = '', raw = '') {
  const key = normalizeNumberKey(value);
  if (!map.has(key)) map.set(key, []);
  map.get(key).push({ value, context: String(context || ''), raw: String(raw || value) });
}

function normalizeNumberKey(n) {
  if (!Number.isFinite(n)) return String(n);
  // keep one decimal for floats, exact for ints
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

// ───── Risk Patterns ─────

const RISK_PATTERNS = [
  {
    id: 'bold_success',
    regex: /\b(tests?\s+(all\s+)?pass(es|ed)?|all\s+tests?\s+pass|no\s+(known\s+)?bugs?|bug[- ]free|全部通过|测试全过|零缺陷)\b/i,
    evidenceCheck: (_text, evTokens) => !evTokens.has('passed') && !evTokens.has('pass') && !evTokens.has('success') && !evTokens.has('通过'),
  },
  {
    id: 'perfect_number',
    regex: /\b100\s*%|\b100％|百分之百|全覆盖|零错误|zero\s+error/i,
    evidenceCheck: () => true,
  },
  {
    id: 'already_deployed',
    regex: /\b(already|currently|now)\s+(running|deployed|live|in\s+production)|已上线|已部署|生产环境已|正式运行/i,
    evidenceCheck: (_t, ev) => !ev.has('production') && !ev.has('deployed') && !ev.has('deploy') && !ev.has('live') && !ev.has('上线') && !ev.has('部署'),
  },
  {
    id: 'no_issues',
    regex: /\b(no\s+(known\s+)?(issues?|errors?|problems?)|zero\s+(errors?|issues?|bugs?)|无(?:任何)?(?:问题|错误|缺陷)|没有(?:已知)?(?:问题|bug))\b/i,
    evidenceCheck: (_t, ev) => ev.has('bugs') || ev.has('errors') || ev.has('failed') || ev.has('error') || !ev.has('zero'),
  },
  {
    id: 'will_work',
    regex: /\b(will\s+(definitely\s+)?work|guaranteed|absolutely\s+(works?|correct)|always\s+works?|一定(?:能|会)(?:工作|成功)|保证(?:有效|成功)|万无一失)\b/i,
    evidenceCheck: () => true,
  },
  {
    id: 'absolute_all',
    regex: /\b(every\s+edge\s+case|all\s+environments?|any\s+load|fully\s+implemented|complete(ly)?\s+done|所有环境|任意负载|完全实现|全部完成)\b/i,
    evidenceCheck: () => true,
  },
];

// ───── Helpers ─────

function claimTokensOf(claim) {
  const lower = claim.toLowerCase();
  const en = (lower.match(/[a-z0-9_./-]{3,}/g) || []).filter(w => !STOP_WORDS.has(w));
  const cn = claim.match(/[\u4e00-\u9fff]{2,}/g) || [];
  return [...new Set([...en, ...cn])];
}

function extractClaimNumbers(claim) {
  const out = [];
  const re = /([-+]?\d+(?:\.\d+)?)\s*(%|％|ms|s|x|×|k|kb|mb|gb)?/gi;
  let m;
  while ((m = re.exec(claim)) !== null) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    const unit = (m[2] || '').toLowerCase().replace('％', '%');
    out.push({ value, unit, raw: m[0], key: normalizeNumberKey(value) });
  }
  return out;
}

function hasSpecificValues(claim) {
  return extractClaimNumbers(claim).length > 0
    || /\/[a-zA-Z][a-zA-Z0-9_./-]{2,}/.test(claim)
    || /`[^`]+`/.test(claim)
    || /\b(npm|git|curl|sudo|docker|kubectl|python|node|pnpm|yarn)\b/i.test(claim)
    || /[\u4e00-\u9fff].{0,6}(路径|命令|接口|端口|版本)/.test(claim);
}

function findNumberConflicts(claimNums, evidenceNumbers) {
  const conflicts = [];
  const supports = [];

  for (const cn of claimNums) {
    // percent special-case: 100% vs any other percent in evidence
    if (cn.unit === '%' || /%/.test(cn.raw)) {
      let matched = false;
      for (const [key, arr] of evidenceNumbers.entries()) {
        const evVal = arr[0]?.value;
        if (evVal == null) continue;
        const evIsPct = arr.some(a => /%|percent|coverage|rate|accuracy/i.test(a.context + a.raw));
        // also treat bare 0-1 fractions near claim percent
        const asPct = evVal <= 1 && evVal >= 0 ? evVal * 100 : evVal;
        if (Math.abs(asPct - cn.value) <= 0.6 || Math.abs(evVal - cn.value) <= 0.6) {
          matched = true;
          supports.push({ claim: cn.raw, evidence: arr[0].raw, key });
        } else if (evIsPct && Math.abs(asPct - cn.value) > 5) {
          // same metric family, different value
          if (cn.value >= 95 && asPct < 95) {
            conflicts.push({
              claim: cn.raw,
              evidence: arr.map(a => a.raw).join(', '),
              reason: `claimed ${cn.raw} but evidence shows ${arr[0].raw}`,
            });
          }
        }
      }
      if (!matched && cn.value === 100) {
        // 100% with no matching evidence number is already risky; conflict if any lower coverage-like num exists
        for (const [, arr] of evidenceNumbers.entries()) {
          const evVal = arr[0]?.value;
          const ctx = arr.map(a => a.context + a.raw).join(' ');
          if (evVal != null && evVal < 100 && /cover|pass|accuracy|rate|success/i.test(ctx)) {
            conflicts.push({
              claim: cn.raw,
              evidence: arr[0].raw,
              reason: `claimed ${cn.raw} vs evidence ${arr[0].raw}`,
            });
            break;
          }
        }
      }
      continue;
    }

    // exact / near number match
    if (evidenceNumbers.has(cn.key)) {
      supports.push({ claim: cn.raw, evidence: evidenceNumbers.get(cn.key)[0].raw, key: cn.key });
      continue;
    }
    // try integer closeness
    let foundNear = false;
    for (const [key, arr] of evidenceNumbers.entries()) {
      const evVal = arr[0]?.value;
      if (evVal == null) continue;
      if (Math.abs(evVal - cn.value) <= Math.max(0.05, cn.value * 0.01)) {
        supports.push({ claim: cn.raw, evidence: arr[0].raw, key });
        foundNear = true;
        break;
      }
    }
    if (!foundNear && cn.value >= 10) {
      // large specific number with no evidence support — not auto-conflict, handled as needs_human
    }
  }

  return { conflicts, supports };
}

// ───── Claim Classifier ─────

/**
 * Classify a single claim against evidence.
 * Returns: { status, evidenceMatches, conflictSignals, isRisky, riskId, reasons }
 */
export function classifyClaim(claim, evidence, hasEvidence) {
  const { tokens: evidenceTokens, numbers: evidenceNumbers, raw: evidenceRaw } = evidence;
  const claimTokens = claimTokensOf(claim);
  const claimNums = extractClaimNumbers(claim);
  const evidenceMatches = [];
  const conflictSignals = [];
  const reasons = [];

  let isRisky = false;
  let riskId = null;
  for (const pattern of RISK_PATTERNS) {
    if (pattern.regex.test(claim)) {
      if (!hasEvidence || pattern.evidenceCheck(claim, evidenceTokens)) {
        isRisky = true;
        riskId = pattern.id;
        reasons.push(`risk:${pattern.id}`);
      }
    }
  }

  const specific = hasSpecificValues(claim);

  if (!hasEvidence) {
    if (specific) {
      reasons.push('specific values present but no evidence provided');
      return {
        status: 'needs_human', evidenceMatches, conflictSignals, isRisky, riskId, reasons,
      };
    }
    reasons.push('no evidence provided');
    return {
      status: 'unsupported', evidenceMatches, conflictSignals, isRisky, riskId, reasons,
    };
  }

  // light stemming / synonym bridge for common ops words
  const synonyms = {
    deployment: ['deploy', 'deployed', 'deployment'],
    deployed: ['deploy', 'deployed', 'deployment'],
    deploy: ['deploy', 'deployed', 'deployment'],
    succeeded: ['success', 'succeeded', 'successful', 'ok', 'passed'],
    success: ['success', 'succeeded', 'successful', 'ok'],
    successful: ['success', 'succeeded', 'successful'],
    passed: ['pass', 'passed', 'success'],
    tests: ['test', 'tests', 'suite'],
    test: ['test', 'tests', 'suite'],
    staging: ['staging', 'stage'],
    production: ['production', 'prod', 'live'],
    coverage: ['coverage', 'cover'],
  };

  const evidenceLower = evidenceRaw.toLowerCase();
  for (const token of claimTokens) {
    const cands = synonyms[token] || [token];
    let hit = false;
    for (const c of cands) {
      if (evidenceTokens.has(c) || evidenceLower.includes(c)) {
        evidenceMatches.push(token === c ? token : `${token}~${c}`);
        hit = true;
        break;
      }
    }
    if (!hit && token.length >= 4 && evidenceLower.includes(token)) {
      evidenceMatches.push(token);
    }
  }

  // number reconciliation
  const { conflicts: numConflicts, supports: numSupports } = findNumberConflicts(claimNums, evidenceNumbers);
  for (const s of numSupports) {
    if (!evidenceMatches.includes(s.key)) evidenceMatches.push(String(s.claim));
    reasons.push(`number match: ${s.claim} ≈ ${s.evidence}`);
  }
  for (const c of numConflicts) {
    conflictSignals.push(c.evidence);
    reasons.push(`number conflict: ${c.reason}`);
  }

  // polarity conflicts — only when claim is absolute OR no supporting numbers
  const absoluteClaim = /\b(all|every|zero|no\s+|100\s*%|全部|所有|零|无(?:任何)?)/i.test(claim);
  const POSITIVE_CLAIMS = [
    { claim: /pass(es|ed)?|success(ful)?|correct|no\s+bug|全部通过|测试通过/i, conflict: /fail(ed|ing)?|error|incorrect|bug|crash|失败|错误/i, absoluteOnly: true },
    { claim: /deployed|production|live|已上线|已部署/i, conflict: /failed|rollback|回滚|失败/i, absoluteOnly: false },
    // staging in evidence is NOT a conflict for "deployed to staging"
    { claim: /zero\s+(error|issue|bug)|无(?:任何)?(?:问题|错误)/i, conflict: /error|issue|bug|failed|错误|缺陷/i, absoluteOnly: false },
    { claim: /green|全部绿灯|all\s+checks?\s+green/i, conflict: /failed|red|failing|失败/i, absoluteOnly: true },
  ];

  for (const pc of POSITIVE_CLAIMS) {
    if (!pc.claim.test(claim)) continue;
    // If claim is not absolute and we already have strong numeric support, skip soft polarity noise
    if (pc.absoluteOnly && !absoluteClaim && numSupports.length > 0) continue;
    if (!absoluteClaim && numSupports.length > 0 && /pass|success|测试通过/i.test(claim)) continue;
    const conflictMatch = evidenceLower.match(pc.conflict);
    if (conflictMatch) {
      // ignore "failed":0 style non-conflicts
      const around = evidenceLower.slice(Math.max(0, conflictMatch.index - 12), conflictMatch.index + 18);
      if (/failed"?\s*:\s*0\b|errors?"?\s*:\s*0\b/.test(around)) continue;
      conflictSignals.push(conflictMatch[0]);
      reasons.push(`polarity conflict with evidence token "${conflictMatch[0]}"`);
    }
  }

  // unique match list
  const uniqMatches = [...new Set(evidenceMatches)];
  const uniqConflicts = [...new Set(conflictSignals)];

  // Decision tree (stricter than v1.0)
  if (numConflicts.length > 0) {
    return {
      status: 'contradicted',
      evidenceMatches: uniqMatches,
      conflictSignals: uniqConflicts,
      isRisky: true,
      riskId: riskId || 'perfect_number',
      reasons,
    };
  }

  if (uniqConflicts.length > 0 && uniqMatches.length < 2 && numSupports.length === 0) {
    reasons.push('conflict signals outweigh weak keyword overlap');
    return {
      status: 'contradicted',
      evidenceMatches: uniqMatches,
      conflictSignals: uniqConflicts,
      isRisky: true,
      riskId,
      reasons,
    };
  }

  // absolute positive claim + conflict evidence still contradicted even with some matches
  if (uniqConflicts.length > 0 && absoluteClaim) {
    reasons.push('absolute claim conflicts with evidence');
    return {
      status: 'contradicted',
      evidenceMatches: uniqMatches,
      conflictSignals: uniqConflicts,
      isRisky: true,
      riskId: riskId || 'bold_success',
      reasons,
    };
  }

  const coverageRatio = claimTokens.length > 0 ? uniqMatches.length / claimTokens.length : 0;
  const strong = uniqMatches.filter(m => /\d/.test(m) || m.length >= 6 || /[\u4e00-\u9fff]/.test(m) || m.includes('~'));
  const hasStrongNumber = numSupports.length > 0;

  // Supported needs real signal — not a single stopword-ish hit
  if (hasStrongNumber || (coverageRatio >= 0.28 && uniqMatches.length >= 2) || strong.length >= 2 || (uniqMatches.length >= 2 && /deploy|success|pass|staging|production/i.test(claim))) {
    if (uniqConflicts.length > 0) {
      reasons.push('mostly supported but residual conflict signals → human check');
      return {
        status: 'needs_human',
        evidenceMatches: uniqMatches,
        conflictSignals: uniqConflicts,
        isRisky,
        riskId,
        reasons,
      };
    }
    reasons.push(hasStrongNumber ? 'numeric evidence aligns' : `keyword coverage ${(coverageRatio * 100).toFixed(0)}%`);
    return {
      status: 'supported',
      evidenceMatches: uniqMatches,
      conflictSignals: uniqConflicts,
      isRisky,
      riskId,
      reasons,
    };
  }

  if (specific && uniqMatches.length < 2) {
    reasons.push('specific claim lacks enough corroborating evidence');
    return {
      status: 'needs_human',
      evidenceMatches: uniqMatches,
      conflictSignals: uniqConflicts,
      isRisky,
      riskId,
      reasons,
    };
  }

  if (uniqMatches.length >= 1) {
    reasons.push('weak keyword overlap only');
    return {
      status: 'needs_human',
      evidenceMatches: uniqMatches,
      conflictSignals: uniqConflicts,
      isRisky,
      riskId,
      reasons,
    };
  }

  reasons.push('no evidence keywords matched');
  return {
    status: 'unsupported',
    evidenceMatches: [],
    conflictSignals: uniqConflicts,
    isRisky,
    riskId,
    reasons,
  };
}

// ───── Trust Score ─────

export function computeTrustScore(results) {
  if (!results.length) return 0;

  const weights = { supported: 1.0, needs_human: 0.45, unsupported: 0.12, contradicted: 0.0 };
  const rawScore = results.reduce((sum, r) => sum + (weights[r.status] ?? 0.2), 0) / results.length;

  const riskCount = results.filter(r => r.isRisky).length;
  const contradictedCount = results.filter(r => r.status === 'contradicted').length;
  const riskPenalty = Math.min(riskCount * 6 + contradictedCount * 8, 40);

  const hasEvidence = results.some(r => (r.evidenceMatches?.length || 0) > 0);
  const evidenceBonus = hasEvidence ? 4 : -12;

  // absolute-language density penalty
  const absPenalty = Math.min(results.filter(r => r.riskId === 'will_work' || r.riskId === 'absolute_all' || r.riskId === 'perfect_number').length * 3, 12);

  const score = Math.round(rawScore * 100 - riskPenalty + evidenceBonus - absPenalty);
  return Math.max(0, Math.min(100, score));
}

// ───── Main Analyze ─────

export function analyze(answerText, evidenceText) {
  const claims = splitIntoClaims(answerText);
  const evidence = parseEvidence(evidenceText);
  const hasEvidence = !!(evidenceText && evidenceText.trim().length > 0);

  const results = claims.map((claim, i) => ({
    id: i + 1,
    claim,
    ...classifyClaim(claim, evidence, hasEvidence),
  }));

  const score = computeTrustScore(results);
  const riskFlags = [...new Set(results.filter(r => r.isRisky && r.riskId).map(r => r.riskId))];

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
    hasEvidence: !!hasEvidence,
    version: '1.1.0',
  };
}

// ───── Reports ─────

export function generateMarkdownReport(results, lang = 'en') {
  const { claims, score, stats, riskFlags, hasEvidence } = results;
  const now = new Date().toISOString();
  const badgeText = {
    supported: '✅ Supported',
    unsupported: '⚠️ Unsupported',
    contradicted: '❌ Contradicted',
    needs_human: '🔍 Needs Human',
  };

  let md = `# ClaimTape Report\n\n`;
  md += `**Generated:** ${now}  \n`;
  md += `**Trust Score:** ${score}/100  \n`;
  md += `**Evidence:** ${hasEvidence ? 'Provided' : 'Not provided'}  \n`;
  md += `**Engine:** v1.1  \n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Count |\n|--------|-------|\n`;
  md += `| Total Claims | ${stats.total} |\n`;
  md += `| ✅ Supported | ${stats.supported} |\n`;
  md += `| ⚠️ Unsupported | ${stats.unsupported} |\n`;
  md += `| ❌ Contradicted | ${stats.contradicted} |\n`;
  md += `| 🔍 Needs Human | ${stats.needs_human} |\n\n`;

  if (riskFlags.length > 0) {
    md += `## ⚠️ Risk Flags\n\n`;
    riskFlags.forEach(f => { md += `- \`${f}\`\n`; });
    md += '\n';
  }

  md += `## Claim-by-Claim Analysis\n\n`;
  claims.forEach(c => {
    md += `### Claim ${c.id}: ${badgeText[c.status] || c.status}\n\n`;
    md += `> ${c.claim}\n\n`;
    if (c.reasons?.length) md += `**Why:** ${c.reasons.join('; ')}  \n`;
    if (c.evidenceMatches.length > 0) md += `**Evidence matches:** ${c.evidenceMatches.join(', ')}  \n`;
    if (c.conflictSignals.length > 0) md += `**Conflict signals:** ${c.conflictSignals.join(', ')}  \n`;
    md += '\n';
  });

  md += `---\n*Generated by [ClaimTape](https://github.com/Zijian-Ni/claimtape) — local, private, no API key.*\n`;
  return md;
}

export function generateJSONExport(results, answerText, evidenceText) {
  return JSON.stringify({
    meta: { tool: 'ClaimTape', version: '1.1.0', generated: new Date().toISOString() },
    input: {
      answerLength: answerText?.length ?? 0,
      evidenceLength: evidenceText?.length ?? 0,
      hasEvidence: !!(evidenceText?.trim()),
    },
    score: results.score,
    stats: results.stats,
    riskFlags: results.riskFlags,
    claims: results.claims,
  }, null, 2);
}
