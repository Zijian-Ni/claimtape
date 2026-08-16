# Contributing to ClaimTape

Thanks for helping. The most valuable contribution here is not a feature — it is **a test fixture that proves ClaimTape got something wrong**.

## Running things

```bash
npm install
npm test          # node tests/analyzer.test.js
npm run dev       # http://localhost:5173
npm run build     # → dist/
```

All tests must pass before a PR is merged.

## The one rule that outranks everything

**ClaimTape must never imply it can determine truth.**

It measures whether a claim can be located in the supplied evidence. That is all. Any PR that reintroduces "trust", "verified", "proven", "accurate" or similar language for the headline metric will be asked to change it — no matter how good the underlying code is.

Concretely:

- The metric is **Evidence Coverage**, never "Trust Score".
- The disclaimer under the score is **permanent and non-collapsible**.
- With no evidence, the result is `null` — **not `0`**. Zero is a measurement; null is an admission. Scoring text nobody offered proof for is an accusation.
- Badges describe the *evidence relationship* ("Evidence found", "Possible conflict"), not a verdict ("Supported", "False").

## Most welcome contributions

**1. False-positive fixtures.** If ClaimTape flags something it should not, that is a bug worth more than a feature. Add a case to `tests/analyzer.test.js` showing the wrong verdict. Real example already in the suite: a *cost* reduction of 80% was being "supported" by a *coverage* figure of 78.4% purely because the numbers looked alike.

**2. New conflict detectors.** `src/polarity.js` holds negation and numeric contradiction. Good candidates: date/version mismatches, unit confusion (ms vs s), scope drift ("all users" vs "beta users"). Every detector needs a positive test *and* a negative test proving it does not fire on innocent text.

**3. Tokenisation for other languages.** `src/tokenize.js` handles English and Chinese. Japanese, Korean and Thai have the same no-spaces problem. `Intl.Segmenter` supports them; the work is choosing sensible stop-words and proving non-zero coverage on a realistic sample.

## Code conventions

- **Zero runtime dependencies** in `src/analyzer.js`, `src/tokenize.js` and `src/polarity.js`. The CLI and the browser share this code.
- Bilingual: every user-facing string goes in `src/i18n.js` with both `en` and `zh`.
- No hard-coded hex in new CSS — use the existing custom properties.
- Comments should explain *why*, especially where a rule exists to prevent a specific past mistake.

## Commit style

[Conventional Commits](https://www.conventionalcommits.org/): `feat:` `fix:` `docs:` `refactor:` `test:` `chore:`.

If your change implements a roadmap task, put the ID in the body:

```
fix(analyzer): stop comparing latency against throughput

Task: CT-3
```
