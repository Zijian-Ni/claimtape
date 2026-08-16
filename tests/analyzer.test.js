import {
  splitIntoClaims,
  analyze,
  computeTrustScore,
  computeEvidenceCoverage,
  buildReviewQueue,
} from '../src/analyzer.js';
import { negationPolarity, findNumericConflicts } from '../src/polarity.js';
import { tokenize } from '../src/tokenize.js';
import { DEMO_ANSWER, DEMO_EVIDENCE } from '../src/demo.js';

let passed = 0, failed = 0;
const assert = (c, m) => { if (c) { console.log('  ✅', m); passed++; } else { console.error('  ❌', m); failed++; } };

console.log('\n── split ──');
assert(splitIntoClaims('A. B. C.').length >= 3, 'EN sentences');
assert(splitIntoClaims('- a item\n- b item\n- c item').length === 3, 'bullets');
assert(splitIntoClaims('系统已经上线。测试全部通过。覆盖率是100%。').length >= 3, 'CN');

console.log('\n── DEMO contract (user-reported bugs) ──');
const demo = analyze(DEMO_ANSWER, DEMO_EVIDENCE);
const by = Object.fromEntries(demo.claims.map(c => [c.id, c]));
assert(demo.claims.length >= 8, `demo claim count ${demo.claims.length}`);

// #1 production must be factual contradicted (staging only), NOT opinion
assert(by[1].kind === 'factual', `#1 kind factual got ${by[1].kind}`);
assert(by[1].status === 'contradicted', `#1 production contradicted got ${by[1].status}`);
assert(/staging/i.test(by[1].reasons.join(' ')), '#1 mentions staging');

// #2 100% coverage + no bugs contradicted
assert(by[2].status === 'contradicted', '#2 100%/no bugs contradicted');

// #3 zero latency contradicted by load test
assert(by[3].status === 'contradicted', `#3 zero latency contradicted got ${by[3].status}`);

// #4 80% cost must NOT be supported via coverage=78.4
assert(by[4].status !== 'supported', `#4 cost not falsely supported got ${by[4].status}`);
assert(!/coverage=78\.4/.test(by[4].reasons.join(' ')), '#4 must not align cost to coverage');
assert(by[4].status === 'contradicted' || by[4].status === 'needs_human' || by[4].status === 'unverified', '#4 cost unresolved against cost evidence or contradicted');

// #6 94% accuracy supported
assert(by[6].status === 'supported', `#6 accuracy supported got ${by[6].status}`);

// pipeline both operational vs youtube degraded
const pipe = demo.claims.find(c => /bilibili|youtube/i.test(c.claim));
assert(pipe && pipe.status === 'contradicted', `pipeline both-ok contradicted got ${pipe?.status}`);

// CI all green vs failed
const ci = demo.claims.find(c => /CI\/CD|checks are green/i.test(c.claim));
assert(ci && ci.status === 'contradicted', `CI green contradicted got ${ci?.status}`);

assert(demo.stats.contradicted >= 4, `demo contradicted >=4 got ${demo.stats.contradicted}`);
assert(demo.score < 45, `demo score stays low got ${demo.score}`);

console.log('\n── unit family isolation ──');
const fam = analyze(
  'API costs reduced by 80%.',
  '{"event":"test_run","coverage":78.4,"passed":10}\n{"event":"cost_analysis","api_cost_reduction":0.62}'
);
const costClaim = fam.claims[0];
assert(costClaim.status === 'contradicted', `80% vs 0.62 cost contradicted got ${costClaim.status}`);
assert(!/coverage=78\.4/.test(costClaim.reasons.join(' ')) || costClaim.status === 'contradicted', 'no false coverage support');

console.log('\n── CT-1: no evidence ⇒ NO score at all ──');
const advice = analyze('建议先做数字版私人助理。可以把系统拆成思考、情绪、物理、反应四层。目前还没有系统同时达到四个顶级。', '');
assert(advice.mode === 'epistemic-audit', 'epistemic');
// Coverage against zero evidence is undefined, not zero. Rendering "0/100"
// there reads as an accusation against text nobody ever offered proof for.
assert(advice.score === null, `no-evidence score must be null, got ${advice.score}`);
assert(advice.coverage === null, 'coverage null without evidence');
assert(advice.stats.contradicted === 0, 'no contra without evidence');
assert(advice.claims.every(c => c.status !== 'contradicted'), 'nothing contradicted without evidence');

console.log('\n── helpers ──');
assert(computeEvidenceCoverage([{ status: 'supported', isRisky: false }], { hasEvidence: true }) >= 80, 'supported high');
assert(computeEvidenceCoverage([{ status: 'opinion', isRisky: false }], { hasEvidence: false }) === null, 'no coverage without evidence');
assert(computeTrustScore === computeEvidenceCoverage, 'legacy alias kept for embeds');

console.log('\n── CT-3: negation polarity ──');
assert(negationPolarity('tests do not pass') === -1, 'EN negation');
assert(negationPolarity('all tests pass') === 1, 'EN positive');
assert(negationPolarity('测试没有通过') === -1, 'ZH negation');
assert(negationPolarity('测试全部通过') === 1, 'ZH positive');
assert(negationPolarity('not only fast but also cheap') === 1, 'not-only is not a negation');

console.log('\n── CT-3: numeric contradiction ──');
const numEn = findNumericConflicts('coverage 95%', 'coverage: 62%');
assert(numEn.length === 1, `EN 95 vs 62 conflict, got ${numEn.length}`);
const numZh = findNumericConflicts('覆盖率 95%', '覆盖率：62%');
assert(numZh.length === 1, `ZH 覆盖率 conflict, got ${numZh.length}`);
assert(findNumericConflicts('coverage 95%', 'coverage: 94%').length === 0, 'within tolerance is not a conflict');
// The v1.4 false positive: a cost figure must never be compared to coverage.
assert(findNumericConflicts('API costs reduced by 80%', 'coverage: 78.4%').length === 0, 'cross-family numbers never conflict');

console.log('\n── CT-4: Chinese tokenisation ──');
const zhTok = tokenize('系统已经上线，测试全部通过');
assert(zhTok.length >= 3, `ZH yields word tokens, got ${JSON.stringify(zhTok)}`);
assert(zhTok.some(t => t.length === 2), 'ZH tokens are words not whole runs');
assert(tokenize('All tests pass').includes('tests'), 'EN still works');
const zhCov = analyze('系统的测试覆盖率是 78.4%。', '测试覆盖率：78.4%，全部用例通过。');
assert(zhCov.score !== null && zhCov.score > 0, `ZH claim gets non-zero coverage, got ${zhCov.score}`);

console.log('\n── CT-1: review queue ordering ──');
const q = buildReviewQueue(demo.claims);
assert(q.length > 0, 'queue non-empty');
assert(q[0].status === 'contradicted', `conflicts come first, got ${q[0].status}`);
assert(!q.some(c => c.status === 'supported' && !c.isRisky), 'clean supported claims are not queued');

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
if (failed) process.exit(1);
