// ClaimTape · tokenisation (CT-4)
//
// Chinese has no spaces, so the original word-boundary regex silently produced
// zero tokens for CJK text — every Chinese claim scored 0 coverage and got
// flagged, which is a false accusation rather than a cautious default.
//
// Intl.Segmenter ships in Node >= 16 and every current browser. When it is
// missing we fall back to character bigrams, which is crude but non-zero.

const STOP_EN = new Set(
  `the and has have been with for are that this from will all can its our their they was were not but also any each both such into over than more most very just about only some which when what who how why there here then them being does did would could should shall may might must upon within across under your you we it is in on to of as by or an at be a`
    .split(/\s+/),
);

// Function words carry no evidential weight in Chinese either.
const STOP_ZH = new Set([
  '这个', '那个', '我们', '你们', '他们', '因为', '所以', '但是', 'however',
  '可以', '已经', '正在', '进行', '一个', '就是', '还是', '如果', '这些', '那些',
  '什么', '怎么', '为了', '并且', '而且', '或者', '不过', '虽然', '目前',
]);

export function hasCJK(text) {
  return /[\u4e00-\u9fff]/.test(String(text ?? ''));
}

let _segmenter;
function segmenter() {
  if (_segmenter !== undefined) return _segmenter;
  try {
    _segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
      ? new Intl.Segmenter('zh', { granularity: 'word' })
      : null;
  } catch {
    _segmenter = null;
  }
  return _segmenter;
}

/** Character bigrams — the fallback when Intl.Segmenter is unavailable. */
export function bigrams(text) {
  const t = String(text).replace(/[^\u4e00-\u9fff]/g, '');
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/**
 * Tokenise for evidence matching.
 * Chinese text yields word tokens; English yields lowercase words >= 3 chars.
 * Mixed text yields both, because real AI answers are usually mixed.
 */
export function tokenize(text, lang) {
  const raw = String(text ?? '');
  if (!raw.trim()) return [];

  const out = [];
  const isZh = lang === 'zh' || hasCJK(raw);

  if (isZh) {
    const seg = segmenter();
    if (seg) {
      for (const s of seg.segment(raw)) {
        if (!s.isWordLike) continue;
        const w = s.segment.trim();
        if (w.length < 2) continue;                 // single chars are too ambiguous
        if (STOP_ZH.has(w)) continue;
        if (/^[a-z0-9_./-]+$/i.test(w)) {           // latin word inside CJK text
          if (w.length >= 3 && !STOP_EN.has(w.toLowerCase())) out.push(w.toLowerCase());
          continue;
        }
        out.push(w);
      }
      // Bigrams as a safety net: segmentation can over-merge domain terms.
      if (out.filter((w) => hasCJK(w)).length < 2) out.push(...bigrams(raw));
    } else {
      out.push(...bigrams(raw).filter((b) => !STOP_ZH.has(b)));
    }
  }

  // Always harvest latin tokens — identifiers, metrics and units live there.
  const en = (raw.toLowerCase().match(/[a-z][a-z0-9_./-]{2,}/g) || []).filter((w) => !STOP_EN.has(w));
  out.push(...en);

  return [...new Set(out)];
}

/**
 * Split text into sentences. Chinese uses 。！？；, English uses . ! ?
 * Returns {text, start, end} so the UI can highlight the exact source span.
 */
export function splitSentences(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return [];
  const out = [];
  let start = 0;

  const isBoundary = (i) => {
    const ch = raw[i];
    if ('。！？；!?;'.includes(ch)) return true;
    if (ch === '.') {
      // Not a decimal point, version number, ellipsis or abbreviation.
      const prev = raw[i - 1];
      const next = raw[i + 1];
      if (/\d/.test(prev ?? '') && /\d/.test(next ?? '')) return false;
      if (next === '.') return false;
      return next === undefined || /\s/.test(next);
    }
    if (ch === '\n') return true;
    return false;
  };

  for (let i = 0; i < raw.length; i++) {
    if (!isBoundary(i)) continue;
    const chunk = raw.slice(start, i + 1);
    if (chunk.trim().length >= 2) out.push({ text: chunk.trim(), start, end: i + 1 });
    start = i + 1;
  }
  const tail = raw.slice(start);
  if (tail.trim().length >= 2) out.push({ text: tail.trim(), start, end: raw.length });
  return out;
}

/**
 * Build a token → character-span index over the evidence text, so a matched
 * token can be highlighted at its real location instead of re-searched.
 */
export function buildTokenIndex(evidenceText) {
  const raw = String(evidenceText ?? '');
  const index = new Map();
  const add = (tok, start, end) => {
    if (!tok) return;
    const key = tok.toLowerCase();
    if (!index.has(key)) index.set(key, []);
    const arr = index.get(key);
    if (arr.length < 24) arr.push({ start, end });
  };

  // Latin tokens with exact offsets.
  const re = /[a-zA-Z][a-zA-Z0-9_./-]{2,}/g;
  let m;
  while ((m = re.exec(raw))) {
    const w = m[0].toLowerCase();
    if (!STOP_EN.has(w)) add(w, m.index, m.index + m[0].length);
  }

  // CJK tokens with offsets, via the segmenter when available.
  if (hasCJK(raw)) {
    const seg = segmenter();
    if (seg) {
      for (const s of seg.segment(raw)) {
        if (s.isWordLike && s.segment.trim().length >= 2 && hasCJK(s.segment)) {
          add(s.segment, s.index, s.index + s.segment.length);
        }
      }
    }
    // Bigram offsets so the fallback path can still highlight.
    for (let i = 0; i < raw.length - 1; i++) {
      const bg = raw.slice(i, i + 2);
      if (/^[\u4e00-\u9fff]{2}$/.test(bg)) add(bg, i, i + 2);
    }
  }

  // Numbers are the highest-signal spans of all.
  const numRe = /[-+]?\d+(?:\.\d+)?\s*(?:%|％|ms|s\b|x|×|k|kb|mb|gb|tb)?/gi;
  while ((m = numRe.exec(raw))) {
    if (m[0].trim()) add(m[0].trim().toLowerCase(), m.index, m.index + m[0].length);
  }

  return index;
}

/** Merge overlapping/adjacent spans so <mark> never nests. */
export function mergeSpans(spans) {
  if (!spans?.length) return [];
  const sorted = [...spans].filter((s) => s && s.end > s.start).sort((a, b) => a.start - b.start);
  const out = [sorted[0]];
  for (const s of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (s.start <= last.end + 1) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export { STOP_EN, STOP_ZH };
