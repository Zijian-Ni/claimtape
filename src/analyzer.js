// ClaimTape Analysis Engine
// Offline heuristics — no API required

// ───── Claim Splitter ─────

export function splitIntoClaims(text) {
  if (!text || !text.trim()) return [];

  // Split on sentence boundaries, preserving bullet points
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const claims = [];

  for (const line of lines) {
    // Bullet/numbered list items are single claims
    if (/^[-•*]\s+/.test(line) || /^\d+[.)]\s/.test(line)) {
      const cleaned = line.replace(/^[-•*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
      if (cleaned.length > 3) claims.push(cleaned);
      continue;
    }

    // Split long paragraphs into sentences
    const sentences = line.match(/[^.!?]+[.!?]+/g) || [line];
    for (const s of sentences) {
      const trimmed = s.trim();
      if (trimmed.length > 10) claims.push(trimmed);
    }
  }

  return claims.filter((c, i, arr) => arr.indexOf(c) === i); // deduplicate
}

// ───── Evidence Parser ─────

function parseEvidence(evidenceText) {
  if (!evidenceText || !evidenceText.trim()) return { tokens: new Set(), raw: '' };

  const tokens = new Set();
  const lines = evidenceText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try JSON / JSONL
    try {
      const obj = JSON.parse(trimmed);
      extractTokensFromObj(obj, tokens);
      continue;
    } catch {}

    // Plain text: extract meaningful words
    extractTokensFromText(trimmed, tokens);
  }

  return { tokens, raw: evidenceText };
}

function extractTokensFromObj(obj, tokens, depth = 0) {
  if (depth > 5) return;
  if (typeof obj === 'string') {
    extractTokensFromText(obj, tokens);
  } else if (typeof obj === 'number') {
    tokens.add(String(obj));
  } else if (Array.isArray(obj)) {
    obj.forEach(v => extractTokensFromObj(v, tokens, depth + 1));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      tokens.add(k.toLowerCase());
      extractTokensFromObj(v, tokens, depth + 1);
    }
  }
}

function extractTokensFromText(text, tokens) {
  // Extract words of length >= 3
  const words = text.toLowerCase().match(/[a-z0-9_\-\/\.]{3,}/g) || [];
  words.forEach(w => tokens.add(w));
  // Also add numeric values as-is
  const nums = text.match(/\d+(\.\d+)?%?/g) || [];
  nums.forEach(n => tokens.add(n));
}

// ───── Risk Pattern Detection ─────

const RISK_PATTERNS = [
  {
    id: 'bold_success',
    regex: /\b(tests?\s+(all\s+)?pass(es|ed)?|no\s+(known\s+)?bugs?|bug[- ]free)\b/i,
    evidenceCheck: (text, evTokens) => {
      // risky if evidence doesn't have "pass" or "passed" in test context
      return !evTokens.has('passed') && !evTokens.has('pass') && !evTokens.has('success');
    },
  },
  {
    id: 'perfect_number',
    regex: /\b100\s*%(?!\d)/i,
    evidenceCheck: (_text, _evTokens) => true, // always flag 100% claims as risky
  },
  {
    id: 'already_deployed',
    regex: /\b(already|currently|now)\s+(running|deployed|live|in\s+production)\b/i,
    evidenceCheck: (text, evTokens) => !evTokens.has('production') && !evTokens.has('deployed') && !evTokens.has('deploy'),
  },
  {
    id: 'no_issues',
    regex: /\b(no\s+(known\s+)?(issues?|errors?|problems?)|zero\s+(errors?|issues?|bugs?))\b/i,
    evidenceCheck: (text, evTokens) => {
      // even riskier if evidence contains "bugs" or "errors"
      return evTokens.has('bugs') || evTokens.has('errors') || evTokens.has('failed') || !evTokens.has('zero');
    },
  },
  {
    id: 'will_work',
    regex: /\b(will\s+(definitely\s+)?work|guaranteed|absolutely\s+(works?|correct)|always\s+works?)\b/i,
    evidenceCheck: () => true, // always flag
  },
];

// ───── Claim Classifier ─────

/**
 * Classify a single claim against evidence.
 * Returns: { status, evidenceMatches, conflictSignals, isRisky, riskId }
 */
export function classifyClaim(claim, evidenceTokens, evidenceRaw, hasEvidence) {
  const claimLower = claim.toLowerCase();

  // Extract meaningful tokens from claim
  const claimTokens = (claimLower.match(/[a-z0-9_\-\/\.]{4,}/g) || [])
    .filter(w => !STOP_WORDS.has(w));

  const evidenceMatches = [];
  const conflictSignals = [];

  // Check risky patterns
  let isRisky = false;
  let riskId = null;
  for (const pattern of RISK_PATTERNS) {
    if (pattern.regex.test(claim)) {
      if (!hasEvidence || pattern.evidenceCheck(claim, evidenceTokens)) {
        isRisky = true;
        riskId = pattern.id;
      }
    }
  }

  // Needs-human: claim contains specific numbers, file paths, commands
  const hasSpecificValues = /\b\d{2,}(\.\d+)?(%|ms|GB|MB|KB|s|x)?\b/.test(claim)
    || /\/[a-zA-Z][a-zA-Z0-9_\-\/\.]+/.test(claim)
    || /`[^`]+`/.test(claim)
    || /\b(npm|git|curl|sudo|docker|kubectl|python|node)\b/i.test(claim);

  if (!hasEvidence) {
    // No evidence: everything is unsupported (except specific-value claims → needs_human)
    if (hasSpecificValues) return { status: 'needs_human', evidenceMatches: [], conflictSignals: [], isRisky, riskId };
    return { status: 'unsupported', evidenceMatches: [], conflictSignals: [], isRisky, riskId };
  }

  // With evidence: check keyword overlap
  for (const token of claimTokens) {
    if (evidenceTokens.has(token)) {
      evidenceMatches.push(token);
    }
  }

  // Also match raw numbers from claim against evidence
  const claimNums = claim.match(/\d+(\.\d+)?/g) || [];
  for (const num of claimNums) {
    if (evidenceTokens.has(num) && !evidenceMatches.includes(num)) {
      evidenceMatches.push(num);
    }
  }

  // Check for conflict: claim says positive, evidence has negative
  const POSITIVE_CLAIMS = [
    { claim: /pass(es|ed)?|success(ful)?|correct|100%|no\s+bug/i, conflict: /fail(ed|ing)?|error|incorrect|bug|crash/i },
    { claim: /deployed|production|live/i, conflict: /staging|failed|rollback/i },
    { claim: /zero\s+(error|issue|bug)/i, conflict: /error|issue|bug|failed/i },
  ];

  for (const pc of POSITIVE_CLAIMS) {
    if (pc.claim.test(claim)) {
      const evidenceWords = evidenceRaw.toLowerCase();
      const conflictMatch = evidenceWords.match(pc.conflict);
      if (conflictMatch) {
        conflictSignals.push(conflictMatch[0]);
      }
    }
  }

  // Determine status
  if (conflictSignals.length > 0 && evidenceMatches.length < 2) {
    return { status: 'contradicted', evidenceMatches, conflictSignals, isRisky, riskId };
  }

  if (hasSpecificValues && evidenceMatches.length < 2) {
    return { status: 'needs_human', evidenceMatches, conflictSignals, isRisky, riskId };
  }

  const coverageRatio = claimTokens.length > 0 ? evidenceMatches.length / claimTokens.length : 0;

  // Numeric tokens or paths are high-signal matches
  const strong = evidenceMatches.filter(m => /\d/.test(m) || m.length >= 6);
  if (coverageRatio >= 0.2 || evidenceMatches.length >= 2 || strong.length >= 1) {
    return { status: 'supported', evidenceMatches, conflictSignals, isRisky, riskId };
  }

  if (evidenceMatches.length >= 1) {
    return { status: 'needs_human', evidenceMatches, conflictSignals, isRisky, riskId };
  }

  return { status: 'unsupported', evidenceMatches: [], conflictSignals, isRisky, riskId };
}

// ───── Trust Score ─────

export function computeTrustScore(results) {
  if (!results.length) return 0;

  const weights = { supported: 1.0, needs_human: 0.5, unsupported: 0.2, contradicted: 0.0 };
  const rawScore = results.reduce((sum, r) => sum + (weights[r.status] ?? 0.2), 0) / results.length;

  // Penalty for risk patterns
  const riskCount = results.filter(r => r.isRisky).length;
  const riskPenalty = Math.min(riskCount * 5, 25);

  // Bonus for evidence presence
  const hasEvidence = results.some(r => r.evidenceMatches.length > 0);
  const evidenceBonus = hasEvidence ? 5 : -10;

  const score = Math.round(rawScore * 100 - riskPenalty + evidenceBonus);
  return Math.max(0, Math.min(100, score));
}

// ───── Main Analyze Function ─────

export function analyze(answerText, evidenceText) {
  const claims = splitIntoClaims(answerText);
  const { tokens: evidenceTokens, raw: evidenceRaw } = parseEvidence(evidenceText);
  const hasEvidence = evidenceText && evidenceText.trim().length > 0;

  const results = claims.map((claim, i) => ({
    id: i + 1,
    claim,
    ...classifyClaim(claim, evidenceTokens, evidenceRaw, hasEvidence),
  }));

  const score = computeTrustScore(results);

  // Risk flags: unique risk patterns found
  const riskFlags = [...new Set(results.filter(r => r.isRisky && r.riskId).map(r => r.riskId))];

  const stats = {
    total: results.length,
    supported: results.filter(r => r.status === 'supported').length,
    unsupported: results.filter(r => r.status === 'unsupported').length,
    contradicted: results.filter(r => r.status === 'contradicted').length,
    needs_human: results.filter(r => r.status === 'needs_human').length,
  };

  return { claims: results, score, stats, riskFlags, hasEvidence: !!hasEvidence };
}

// ───── Report Generation ─────

export function generateMarkdownReport(results, lang = 'en') {
  const { claims, score, stats, riskFlags, hasEvidence } = results;
  const now = new Date().toISOString();

  const badgeText = { supported: '✅ Supported', unsupported: '⚠️ Unsupported', contradicted: '❌ Contradicted', needs_human: '🔍 Needs Human' };

  let md = `# ClaimTape Report\n\n`;
  md += `**Generated:** ${now}  \n`;
  md += `**Trust Score:** ${score}/100  \n`;
  md += `**Evidence:** ${hasEvidence ? 'Provided' : 'Not provided'}  \n\n`;

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
    if (c.evidenceMatches.length > 0) {
      md += `**Evidence matches:** ${c.evidenceMatches.join(', ')}  \n`;
    }
    if (c.conflictSignals.length > 0) {
      md += `**Conflict signals:** ${c.conflictSignals.join(', ')}  \n`;
    }
    md += '\n';
  });

  md += `---\n*Generated by [ClaimTape](https://github.com/Zijian-Ni/claimtape) — local, private, no API key.*\n`;
  return md;
}

export function generateJSONExport(results, answerText, evidenceText) {
  return JSON.stringify({
    meta: { tool: 'ClaimTape', version: '1.0.0', generated: new Date().toISOString() },
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

// ───── Stop Words ─────

const STOP_WORDS = new Set([
  'the', 'and', 'has', 'have', 'been', 'with', 'for', 'are', 'that', 'this',
  'from', 'will', 'all', 'can', 'its', 'our', 'their', 'they', 'was', 'were',
  'not', 'but', 'also', 'any', 'each', 'both', 'such', 'into', 'over', 'than',
  'more', 'most', 'very', 'just', 'about', 'only', 'some', 'which', 'when',
  'what', 'who', 'how', 'why', 'there', 'here', 'then', 'than', 'them',
  'been', 'being', 'does', 'did', 'would', 'could', 'should', 'shall', 'may',
  'might', 'must', 'upon', 'within', 'across', 'under',
]);
