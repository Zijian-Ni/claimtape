// ClaimTape · negation polarity + numeric contradiction detection (CT-3)
//
// Two failure modes the keyword-overlap engine could not see:
//
//  1. "tests do NOT pass" vs evidence "all tests pass" — near-identical token
//     sets, so overlap scoring called it supported. It is the exact opposite.
//  2. "coverage 95%" vs evidence "coverage: 62%" — the shared token `coverage`
//     scored as support while the numbers flatly disagree.
//
// Both are cheap to detect and are the most damaging kinds of miss, because
// they turn a contradiction into a green tick.

const NEG_EN = /\b(not|no|never|none|without|isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|don'?t|didn'?t|won'?t|can'?t|cannot|couldn'?t|shouldn'?t|fail(?:ed|s|ing)?|unable|missing|absent|lack(?:s|ing|ed)?)\b/i;
const NEG_ZH = /(不|没|没有|未|无法|无(?!线)|非|并非|失败|缺少|缺失|尚未|从未|不能|不会|不是)/;

// "not only ... but also", "no doubt", "failsafe": negation words that do not
// actually negate the surrounding assertion.
const NEG_EXCEPTIONS = /\b(not only|no doubt|no less|nothing but|cannot be overstated|failsafe|fail-safe)\b|不仅|不但|无疑|不外乎/i;

/**
 * @returns {-1|1} -1 when the sentence asserts the negative.
 */
export function negationPolarity(sentence) {
  const s = String(sentence ?? '');
  if (!s.trim()) return 1;
  if (NEG_EXCEPTIONS.test(s)) return 1;

  const hits = (s.match(new RegExp(NEG_EN, 'gi')) || []).length
             + (s.match(new RegExp(NEG_ZH, 'g')) || []).length;
  // Double negation resolves back to positive.
  return hits > 0 && hits % 2 === 1 ? -1 : 1;
}

/* ─────────────────────────── metric extraction ─────────────────────────── */

// (metric word, value, optional unit). Deliberately conservative: a number
// needs a nearby label to count as a metric, otherwise every stray digit
// becomes a false contradiction.
const METRIC_RE =
  /([\p{L}][\p{L}_%.\- ]{1,28}?)\s*(?:[:：=是为]|\s+(?:is|are|was|were|at|hits?|reached?)\s+|\s+)\s*([-+]?\d+(?:\.\d+)?)\s*(%|％|ms|s|x|×|倍|k|kb|mb|gb|tb)?/giu;

const NORMALISE_KEY = (k) =>
  String(k)
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(the|a|an|our|its|of|for|in|on|at|to)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Metric families. Two numbers only contradict inside the same family: a 95%
// coverage figure and an 80% cost cut are unrelated even though both are "95-ish
// percentages". This was a real false-positive source in v1.4.
const FAMILY_PATTERNS = [
  ['coverage', /(coverage|覆盖率?|覆盖)/],
  ['accuracy', /(accuracy|precision|recall|f1|准确率?|精度)/],
  ['cost', /(cost|price|spend|budget|成本|费用|开销|价格)/],
  ['latency', /(latency|p50|p95|p99|response time|延迟|耗时|响应时间)/],
  ['tests', /(test|suite|assertion|checks?|用例|测试|通过数)/],
  ['throughput', /(qps|rps|throughput|requests?\/s|吞吐)/],
  ['memory', /(memory|ram|heap|内存|显存)/],
  ['tokens', /(token|上下文|context length)/],
  ['users', /(users?|dau|mau|用户|活跃)/],
  ['stars', /(stars?|forks?|watchers?|星标)/],
];

export function metricFamilyOf(key) {
  const k = NORMALISE_KEY(key);
  for (const [family, re] of FAMILY_PATTERNS) if (re.test(k)) return family;
  return 'generic';
}

/** Percent-like fractions (0.784) become 78.4 so comparisons line up. */
function toComparable(value, unit, key) {
  const k = NORMALISE_KEY(key);
  const looksRatio = /(rate|ratio|coverage|accuracy|precision|recall|reduction|覆盖|准确|降幅)/.test(k);
  if ((unit === '%' || unit === '％') && value > 1) return { value, unit: '%' };
  if (!unit && looksRatio && value >= 0 && value <= 1) return { value: value * 100, unit: '%' };
  if ((unit === '%' || unit === '％') && value <= 1) return { value: value * 100, unit: '%' };
  return { value, unit: unit || '' };
}

/**
 * Extract labelled metrics from free text or JSON-ish lines.
 * @returns {Map<string, {value:number, unit:string, family:string, raw:string, key:string}>}
 */
export function extractMetrics(text) {
  const out = new Map();
  const raw = String(text ?? '');
  if (!raw.trim()) return out;

  let m;
  METRIC_RE.lastIndex = 0;
  while ((m = METRIC_RE.exec(raw))) {
    const key = NORMALISE_KEY(m[1]);
    if (!key || key.length < 2) continue;
    const value = Number(m[2]);
    if (!Number.isFinite(value)) continue;
    const unit = (m[3] || '').toLowerCase().replace('％', '%');
    const family = metricFamilyOf(key);
    if (family === 'generic' && !unit) continue; // unlabelled bare number: skip

    const cmp = toComparable(value, unit, key);
    const id = family !== 'generic' ? family : `${key}|${cmp.unit}`;
    // First occurrence wins: evidence usually states the headline number first.
    if (!out.has(id)) {
      out.set(id, { value: cmp.value, unit: cmp.unit, family, raw: m[0].trim(), key });
    }
  }
  return out;
}

/**
 * Compare claim metrics against evidence metrics.
 * A relative difference above `tolerance` inside the same family is a conflict.
 * @returns {Array<{id:string, family:string, claim:object, evidence:object, relDiff:number}>}
 */
export function findNumericConflicts(claimText, evidenceText, tolerance = 0.15) {
  const claimM = extractMetrics(claimText);
  const evM = extractMetrics(evidenceText);
  const conflicts = [];

  for (const [id, c] of claimM) {
    const e = evM.get(id);
    if (!e) continue;
    if (c.unit !== e.unit && c.unit && e.unit) continue; // ms vs % is not comparable
    const denom = Math.max(Math.abs(c.value), Math.abs(e.value), 1e-9);
    const relDiff = Math.abs(c.value - e.value) / denom;
    if (relDiff > tolerance) {
      conflicts.push({ id, family: c.family, claim: c, evidence: e, relDiff });
    }
  }
  return conflicts;
}

/**
 * Polarity conflict: the claim and its best-matching evidence sentence assert
 * opposite things while sharing enough vocabulary to be about the same subject.
 */
export function findPolarityConflict(claimText, evidenceSentence, coverage) {
  if (coverage <= 0.5) return null; // not clearly the same subject
  const cp = negationPolarity(claimText);
  const ep = negationPolarity(evidenceSentence);
  if (cp === ep) return null;
  return {
    claimPolarity: cp,
    evidencePolarity: ep,
    detail: cp === -1
      ? 'Claim asserts the negative while the evidence asserts the positive.'
      : 'Claim asserts the positive while the evidence asserts the negative.',
    detailZh: cp === -1
      ? '声明是否定式，但证据是肯定式。'
      : '声明是肯定式，但证据是否定式。',
  };
}

export function describeNumericConflict(c, lang = 'en') {
  const cv = `${c.claim.value}${c.claim.unit}`;
  const ev = `${c.evidence.value}${c.evidence.unit}`;
  return lang === 'zh'
    ? `声明称 ${c.claim.key} 为 ${cv}，证据显示 ${ev}`
    : `claim says ${c.claim.key} is ${cv}, evidence says ${ev}`;
}
