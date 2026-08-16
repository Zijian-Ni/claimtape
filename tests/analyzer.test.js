import { splitIntoClaims, analyze, computeTrustScore } from '../src/analyzer.js';
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

console.log('\n── advice without evidence not zero ──');
const advice = analyze('建议先做数字版私人助理。可以把系统拆成思考、情绪、物理、反应四层。目前还没有系统同时达到四个顶级。', '');
assert(advice.mode === 'epistemic-audit', 'epistemic');
assert(advice.score >= 40, `advice score ${advice.score}`);
assert(advice.stats.contradicted === 0, 'no contra without evidence');

console.log('\n── helpers ──');
assert(computeTrustScore([{ status: 'supported', isRisky: false }], { hasEvidence: true }) >= 80, 'supported high');
assert(computeTrustScore([
  { status: 'opinion', isRisky: false },
  { status: 'assessment', isRisky: false },
], { hasEvidence: false }) >= 45, 'opinions not zero');

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
if (failed) process.exit(1);
