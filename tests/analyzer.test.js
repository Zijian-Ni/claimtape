// ClaimTape — Analyzer Unit Tests
// Run: node tests/analyzer.test.js

import { splitIntoClaims, analyze, computeTrustScore } from '../src/analyzer.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

function assertEq(a, b, msg) {
  if (a === b) {
    console.log(`  ✅ ${msg} (${a})`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg} — expected ${b}, got ${a}`);
    failed++;
  }
}

// ── splitIntoClaims ──
console.log('\n── splitIntoClaims ──');

const claims1 = splitIntoClaims('All tests pass. The system is deployed. Coverage is 100%.');
assert(claims1.length >= 3, 'splits sentence-terminated text into 3+ claims');

const claims2 = splitIntoClaims('- First item\n- Second item\n- Third item');
assert(claims2.length === 3, 'splits bullet list into 3 claims');

const claims3 = splitIntoClaims('');
assertEq(claims3.length, 0, 'empty string gives 0 claims');

// ── analyze — no evidence ──
console.log('\n── analyze — no evidence ──');

const r1 = analyze('The system works. All tests pass.', '');
assert(r1.claims.length >= 2, 'produces claims from simple text');
assert(r1.score >= 0 && r1.score <= 100, 'score in 0-100 range');
assert(r1.stats.total >= 2, 'stats.total >= 2');
assert(!r1.hasEvidence, 'hasEvidence = false when no evidence');

// With no evidence, "100% coverage" should be unsupported or needs_human
const r2 = analyze('Coverage is 100%. No bugs detected.', '');
const hasBoldSuccessRisk = r2.riskFlags.some(f => f === 'bold_success' || f === 'perfect_number' || f === 'no_issues');
assert(hasBoldSuccessRisk, 'detects bold_success / perfect_number / no_issues risk flags');

// ── analyze — with evidence ──
console.log('\n── analyze — with evidence ──');

const evidence = `{"event":"test_run","passed":47,"failed":3,"coverage":78.4}
{"event":"deploy","environment":"staging","status":"success"}
tests passed 47 of 50`;

const r3 = analyze('47 tests passed. Deployment succeeded.', evidence);
assert(r3.hasEvidence, 'hasEvidence = true');
assert(r3.stats.supported >= 1, 'at least one supported claim when evidence matches');

// ── contradicted claim ──
console.log('\n── contradicted claim ──');

const r4 = analyze('All tests pass with no failures.', '{"failed":3,"errors":7}');
const contradicted = r4.claims.filter(c => c.status === 'contradicted');
assert(contradicted.length >= 1, 'detects contradicted claim when evidence has failures');

// ── risk pattern: already deployed ──
console.log('\n── risk patterns ──');

const r5 = analyze('The system is already running in production.', '');
assert(r5.riskFlags.includes('already_deployed'), 'flags already_deployed');

const r6 = analyze('This will definitely work in all cases.', '');
assert(r6.riskFlags.includes('will_work'), 'flags will_work');

const r7 = analyze('We achieved 100% test coverage.', '');
assert(r7.riskFlags.includes('perfect_number'), 'flags perfect_number');

// ── trust score ──
console.log('\n── trust score ──');

const allSupported = [
  { status: 'supported', isRisky: false, evidenceMatches: ['a', 'b'] },
  { status: 'supported', isRisky: false, evidenceMatches: ['c'] },
];
const highScore = computeTrustScore(allSupported);
assert(highScore >= 80, `all-supported score >= 80 (got ${highScore})`);

const allContradicted = [
  { status: 'contradicted', isRisky: true, riskId: 'bold_success', evidenceMatches: [] },
  { status: 'contradicted', isRisky: false, evidenceMatches: [] },
];
const lowScore = computeTrustScore(allContradicted);
assert(lowScore <= 20, `all-contradicted score <= 20 (got ${lowScore})`);

// ── Summary ──
console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
if (failed > 0) process.exit(1);
