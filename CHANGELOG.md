# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] — 2026-08-17

### Added

- Optional local semantic pairing (off by default). A lazily loaded `transformers.js` MiniLM model can highlight a paraphrased evidence sentence that lexical overlap missed. Pairing only: it never changes a badge, never overrides a numeric or negation conflict, and never invents a competing score. Missing model / offline → silent lexical fallback. Not used by the CLI.

## [2.0.0] — 2026-08-16

### Added

- Review queue: the order a human should check claims in, which is the actual deliverable.
- Evidence span highlighting — click a claim, see the exact passage it matched.
- Negation detection: “tests do not pass” vs “all tests pass” share nearly every token and used to read as support.
- Same-family numeric contradiction (coverage 95% vs 62%), with cross-family comparison deliberately refused.
- Chinese tokenisation via `Intl.Segmenter` with a bigram fallback.
- `--fail-under` for CI gating.

### Changed

- **Trust Score is now Evidence Coverage.** The old name implied a truth verdict the engine cannot deliver; it measures how much of a claim can be located in the supplied evidence, and nothing more.
- Badges renamed to describe the evidence relationship: *Evidence found*, *No evidence*, *Possible conflict*, *Verify manually*.
- With no evidence supplied, **no score is produced at all** (`null`, not `0`). Scoring text nobody offered proof for is an accusation dressed up as a measurement.

### Fixed

- Chinese claims previously produced whole-run tokens that matched nothing, so every one scored zero coverage and was flagged.

_43 tests (was 24)._
