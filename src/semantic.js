// ClaimTape · optional local semantic PAIRING (CT-A1)
//
// WHAT THIS MODULE IS ALLOWED TO DO
//   Improve which evidence *passage* a claim is highlighted against when the
//   lexical layer missed a paraphrase ("the deploy failed" vs "rollout was
//   unsuccessful").
//
// WHAT THIS MODULE MUST NEVER DO
//   Change a badge. Override a heuristic verdict. Invent a "semantic score"
//   that competes with Evidence Coverage. Soften a numeric or negation
//   conflict into agreement. Touch the CLI. Block the UI. Throw at the user.
//
// The model is off by default and loaded only via dynamic import() so a user
// who never opts in never downloads it. If the import, the model, or the
// network fails, we return null and the caller stays on the lexical path.

import { splitSentences } from './tokenize.js';

export const SEMANTIC_MODEL = 'Xenova/all-MiniLM-L6-v2';

/**
 * Cosine floor for calling two sentences related.
 *
 * Measured against the real MiniLM in a browser (not the test double), cold
 * load from jsDelivr ~8s, 384 dims:
 *
 *   paraphrases      0.42 – 0.61
 *   loosely related  ~0.32
 *   contradiction    ~0.32   ("runs entirely offline" vs "requires a live API key")
 *   unrelated        ~0.00
 *
 * The gap to unrelated text is enormous, so false highlights are unlikely.
 * The interesting boundary is the other one: a contradiction of a claim scores
 * about the same as a loosely related sentence, so dropping this floor to catch
 * more paraphrases would start highlighting sentences that *disagree* with the
 * claim as though they supported it. 0.42 sits deliberately above that band.
 *
 * The cost of the current setting is recall -- some genuine paraphrases land
 * just under it and go unhighlighted. That failure is the safe one: this layer
 * only ever adds highlights, and never changes a coverage badge.
 */
export const SEMANTIC_THRESHOLD = 0.42;

// jsDelivr ESM build. Vite must not try to resolve this at build time — the
// whole point is that the default bundle never contains transformers.js.
const TRANSFORMERS_SPEC = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm';

export function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

export function defaultImportTransformers() {
  const spec = TRANSFORMERS_SPEC;
  return import(/* @vite-ignore */ spec);
}

/**
 * Build a pairer from a sync or async `(text) => number[]` embedder.
 * Used by tests (fake vectors) and by the real MiniLM path.
 */
export function pairerFromEmbedder(embedder) {
  const cache = new Map();
  async function vec(text) {
    const key = String(text ?? '');
    if (cache.has(key)) return cache.get(key);
    const v = await embedder(key);
    cache.set(key, v);
    return v;
  }
  return {
    async similarity(a, b) {
      const [va, vb] = await Promise.all([vec(a), vec(b)]);
      return cosine(va, vb);
    },
  };
}

/**
 * Lazily load the offline pairer. Never throws — returns null on any failure
 * so the lexical path stays the only thing the user ever sees break.
 *
 * Options (tests / injection):
 *   importTransformers  — override the dynamic import
 *   embedder            — skip the model, wrap a given embed function
 *   pairer              — return this pairer as-is
 *   pipeline            — inject a transformers.js pipeline() fn
 *   model               — model id, default Xenova/all-MiniLM-L6-v2
 */
export async function loadSemanticPairer(options = {}) {
  try {
    if (options.pairer) return options.pairer;
    if (options.embedder) return pairerFromEmbedder(options.embedder);

    const importer = options.importTransformers || defaultImportTransformers;
    const mod = await importer();
    const pipeline = options.pipeline || mod?.pipeline;
    if (typeof pipeline !== 'function') return null;

    if (mod?.env) {
      // Prefer cache; still allow the first-use download that the UI warns about.
      try { mod.env.useBrowserCache = true; } catch { /* node */ }
      try { mod.env.allowRemoteModels = true; } catch { /* node */ }
    }

    const extractor = await pipeline(
      'feature-extraction',
      options.model || SEMANTIC_MODEL,
    );
    const embedder = async (text) => {
      const out = await extractor(String(text ?? ''), { pooling: 'mean', normalize: true });
      return Array.from(out.data);
    };
    return pairerFromEmbedder(embedder);
  } catch {
    return null;
  }
}

/**
 * Post-process an `analyze()` result. Mutates only pairing fields:
 *   spans, pairSource, and (when empty) evidenceSnippets.
 *
 * Never writes: status, kind, coverage, score, conflictKind, isRisky,
 * confidence, reasons, reviewQueue.
 *
 * A numeric or polarity conflict already found by the heuristics keeps its
 * existing pairing, even if the model thinks the two sentences "agree".
 */
export async function applySemanticPairing(analysis, evidenceText, pairer, opts = {}) {
  if (!analysis?.claims?.length || !pairer || !String(evidenceText ?? '').trim()) {
    return analysis;
  }

  const threshold = opts.threshold ?? SEMANTIC_THRESHOLD;
  let sentences;
  try {
    sentences = splitSentences(evidenceText);
  } catch {
    return analysis;
  }
  if (!sentences.length) return analysis;

  const simFn = typeof pairer.similarity === 'function'
    ? pairer.similarity.bind(pairer)
    : null;
  if (!simFn) return analysis;

  for (const claim of analysis.claims) {
    if (!claim || !claim.claim) continue;
    // Heuristic conflicts always win. Highlight stays on the conflicting passage.
    if (claim.conflictKind === 'numeric' || claim.conflictKind === 'polarity') continue;
    // Lexical pairing already found something — do not override it.
    if (claim.spans?.length) continue;

    let best = null;
    for (const sentence of sentences) {
      let sim;
      try {
        sim = await Promise.resolve(simFn(claim.claim, sentence.text));
      } catch {
        continue;
      }
      if (!Number.isFinite(sim)) continue;
      if (!best || sim > best.sim) best = { sentence, sim };
    }
    if (!best || best.sim < threshold) continue;

    claim.spans = [{ start: best.sentence.start, end: best.sentence.end }];
    claim.pairSource = 'semantic';
    if (!claim.evidenceSnippets?.length) {
      const text = best.sentence.text;
      claim.evidenceSnippets = [{
        id: 'sem-pair',
        line: 0,
        snippet: text.length > 240 ? text.slice(0, 240) + '…' : text,
        // Explicitly null: this is a passage pointer, not a competing score.
        score: null,
      }];
    }
  }

  return analysis;
}
