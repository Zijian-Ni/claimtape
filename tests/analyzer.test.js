import { splitIntoClaims, analyze, computeTrustScore } from '../src/analyzer.js';
import { DEMO_ANSWER, DEMO_EVIDENCE } from '../src/demo.js';

let passed = 0, failed = 0;
const assert = (c, m) => { if (c) { console.log('  ✅', m); passed++; } else { console.error('  ❌', m); failed++; } };

console.log('\n── split ──');
assert(splitIntoClaims('A. B. C.').length >= 3, 'EN sentences');
assert(splitIntoClaims('- a item\n- b item\n- c item').length === 3, 'bullets');
assert(splitIntoClaims('系统已经上线。测试全部通过。覆盖率是100%。').length >= 3, 'CN');

console.log('\n── demo with evidence ──');
const demo = analyze(DEMO_ANSWER, DEMO_EVIDENCE);
assert(demo.claims.length >= 5, 'demo claims');
assert(demo.score > 0 && demo.score < 60, `demo score mid-low got ${demo.score}`);
assert(demo.stats.contradicted >= 1, 'demo has contradicted');
assert(demo.stats.supported >= 1, 'demo has supported');
assert(demo.claims.some(c => c.evidenceSnippets?.length), 'snippets present');

console.log('\n── user-like advice without evidence should NOT be 0 ──');
const advice = `你的目标非常清晰，也很高：

**顶级思考模型 + 顶级物理交互模型 + 顶级情绪模型 + 顶级反应回应模型 → 打造一个比人类更强的助理。**

这正是「小落」的终极形态。

### 1. 现实判断（2026年8月）

目前**没有任何一个开源或闭源系统**真正同时达到你要求的四个「顶级」。

结论很明确：

- **纯数字版**已经可以做到「高度可用 + 明显比普通人强」的私人助理。
- **真实物理世界版**距离目标还有明显距离，属于研究前沿。

你现在最理性的路径，是先把**数字超智能私人助理**做到极致。

### 2. 推荐架构
把系统拆成四个独立但紧密耦合的模型层，而不是指望一个大模型全包。

你想先从哪个核心模块开始详细设计？`;
const r = analyze(advice, '');
assert(r.mode === 'epistemic-audit', 'epistemic mode');
assert(r.score >= 40, `advice score not collapsed got ${r.score}`);
assert(r.stats.opinion + r.stats.assessment >= 1, 'has opinion/assessment');
assert(r.stats.contradicted === 0, 'no contradicted without evidence');
assert(r.claims.every(c => c.reasons?.length), 'every claim has reasons');
assert(!r.claims.some(c => c.claim === '**'), 'no bare ** claims');

console.log('\n── absolute factual without evidence ──');
const f = analyze('All unit tests pass with 100% coverage and zero bugs in production.', '');
assert(f.score < 55, `absolute factual lower got ${f.score}`);
assert(f.riskFlags.length >= 1, 'risk flags');

console.log('\n── evidence conflicts ──');
const ev = `{"passed":47,"failed":3,"coverage":78.4}\n{"environment":"staging","status":"success"}`;
const c = analyze('We achieved 100% coverage. Already running in production.', ev);
assert(c.claims.some(x => x.status === 'contradicted'), 'conflicts detected');

console.log('\n── score helpers ──');
assert(computeTrustScore([{ status: 'supported', isRisky: false }], { hasEvidence: true }) >= 80, 'supported high');
assert(computeTrustScore([
  { status: 'opinion', isRisky: false },
  { status: 'assessment', isRisky: false },
  { status: 'opinion', isRisky: false },
], { hasEvidence: false }) >= 45, 'opinions not zero');

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
if (failed) process.exit(1);
