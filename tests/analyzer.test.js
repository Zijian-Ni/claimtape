import { splitIntoClaims, analyze, computeTrustScore } from '../src/analyzer.js';

let passed = 0, failed = 0;
const assert = (c, m) => { if (c) { console.log('  ✅', m); passed++; } else { console.error('  ❌', m); failed++; } };
const eq = (a, b, m) => assert(a === b, `${m} (${a})`);

console.log('\n── split ──');
assert(splitIntoClaims('A. B. C.').length >= 3, 'EN sentences');
assert(splitIntoClaims('- a\n- b\n- c').length === 3, 'bullets');
eq(splitIntoClaims('').length, 0, 'empty');
assert(splitIntoClaims('系统已经上线。测试全部通过。覆盖率是100%。').length >= 3, 'CN split');

console.log('\n── no evidence ──');
const r1 = analyze('The system works. All tests pass.', '');
assert(r1.claims.length >= 2, 'claims');
assert(r1.score >= 0 && r1.score <= 100, 'score range');
assert(!r1.hasEvidence, 'no evidence flag');
const r2 = analyze('Coverage is 100%. No bugs detected.', '');
assert(r2.riskFlags.some(f => ['perfect_number', 'bold_success', 'no_issues'].includes(f)), 'risk flags');

console.log('\n── with evidence ──');
const evidence = `{"event":"test_run","passed":47,"failed":3,"coverage":78.4}
{"event":"deploy","environment":"staging","status":"success"}
tests passed 47 of 50`;
const r3 = analyze('47 tests passed. Deployment succeeded on staging.', evidence);
assert(r3.hasEvidence, 'has evidence');
assert(r3.stats.supported >= 1, 'supported >= 1');
assert(r3.claims.some(c => c.reasons?.length), 'reasons');
assert(r3.claims.some(c => c.evidenceSnippets?.length), 'snippets');

console.log('\n── number / production conflicts ──');
const rNum = analyze('We achieved 100% test coverage.', evidence);
assert(rNum.claims.some(c => c.status === 'contradicted' || c.isRisky), '100% risky/contra');
const rProd = analyze('The system is already running in production.', evidence);
assert(rProd.claims.some(c => c.status === 'contradicted' || c.riskIds?.includes('already_deployed') || c.riskId === 'already_deployed'), 'prod vs staging');

console.log('\n── absolute contradicted ──');
const r4 = analyze('All tests pass with no failures.', '{"failed":3,"errors":7}');
assert(r4.claims.some(c => c.status === 'contradicted'), 'absolute vs failures');

console.log('\n── risks ──');
assert(analyze('The system is already running in production.', '').riskFlags.includes('already_deployed'), 'already_deployed');
assert(analyze('This will definitely work in all cases.', '').riskFlags.some(f => f === 'will_work' || f === 'absolute_all'), 'will_work');
assert(analyze('We achieved 100% test coverage.', '').riskFlags.includes('perfect_number'), 'perfect');

console.log('\n── demo overclaim ──');
const demoA = `The Aurora Orchestra recommendation system has been fully implemented and is already running in production.
All unit tests pass with 100% coverage, and there are no known bugs in the codebase.`;
const demoE = `{"passed":47,"failed":3,"coverage":78.4}\n{"environment":"staging","status":"success"}\n{"open_bugs":4}`;
const rDemo = analyze(demoA, demoE);
assert(rDemo.score < 45, `overclaim low score got ${rDemo.score}`);

console.log('\n── score ──');
assert(computeTrustScore([{ status: 'supported', isRisky: false, evidenceMatches: ['a'] }, { status: 'supported', isRisky: false, evidenceMatches: ['b'] }]) >= 80, 'high');
assert(computeTrustScore([{ status: 'contradicted', isRisky: true, evidenceMatches: [] }, { status: 'contradicted', isRisky: false, evidenceMatches: [] }]) <= 20, 'low');

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
if (failed) process.exit(1);
