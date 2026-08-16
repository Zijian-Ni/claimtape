# 📋 ClaimTape

> **Which sentence should you check first?**

Paste an AI answer plus the evidence it should be based on. Get a claim-by-claim **review queue** — instantly, locally, with no API key.

[![CI](https://github.com/Zijian-Ni/claimtape/actions/workflows/deploy.yml/badge.svg)](https://github.com/Zijian-Ni/claimtape/actions)
[![MIT License](https://img.shields.io/badge/license-MIT-teal.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/demo-live-violet.svg)](https://zijian-ni.github.io/claimtape/)
[![No API Key](https://img.shields.io/badge/API%20key-not%20required-success.svg)](#privacy)

**[Try it live →](https://zijian-ni.github.io/claimtape/)**

**Part of the [Aurora Evidence Suite](https://github.com/Zijian-Ni/traceboard)** — local-first evidence tools for AI agents.

---

## ⚠️ What this tool is — and is not

ClaimTape is a **human-review prioritiser**. It tells you *which sentence to check first*, and shows you *what it was matched against*.

**It does not decide what is true.**

The headline number is **Evidence Coverage**: how much of what the AI asserted can actually be located in the evidence you supplied. A confident lie that happens to match a log line will score high. A correct statement with no supporting log will score low. That is intended behaviour, and it is exactly why the disclaimer sits permanently under the score.

> Coverage measures evidence match, not truth.

**If you give it no evidence, it produces no score at all** — only labels describing what *kind* of statement each sentence is. Scoring text against nothing would be an accusation dressed up as a measurement.

---

## Who is this for?

| You are… | You use it to… |
|----------|---------------|
| 🎓 **Student** | Check whether that AI essay actually backs up its claims |
| 📊 **Product Manager** | Verify an AI-written status report against the raw log |
| 💻 **Developer** | Sanity-check an AI code review that says "all tests pass" |
| 👨‍👩‍👧 **Parent** | See which parts of your kid's AI homework are unsupported guesses |
| 📝 **Researcher** | Triage AI-generated summaries before citing them |

---

## 30-second Quickstart

```bash
git clone https://github.com/Zijian-Ni/claimtape.git
cd claimtape && npm install
npm run dev        # → http://localhost:5173, click "Demo"
```

Or skip all of that and use the [live version](https://zijian-ni.github.io/claimtape/) — it is a static page and never sends your text anywhere.

---

## What you get

```
Paste AI answer ──────────────────────────────────────────▶
Paste evidence (logs, trace.jsonl, source text) ──────────▶
────────────────────────────────────────────────────────── ▶
📊 Evidence Coverage 0–100   (match, NOT truth)
🔎 Review queue              (check these first)
✅ / ⚠️ / ❌ / 🔍 per claim   (click → highlights the evidence)
🚩 Risk flags                ("100% coverage", "already deployed", …)
📋 Markdown report           (quotes the evidence it matched)
```

**Claim badges**

| Badge | Meaning |
|-------|---------|
| ✅ Evidence found | A matching passage exists. Click to read it — the match may still be wrong. |
| ⚠️ No evidence | Nothing in your evidence matches. **That does not make it false.** |
| ❌ Possible conflict | The evidence appears to disagree. Check it yourself first. |
| 🔍 Verify manually | Contains specific numbers, paths or commands a human should confirm. |
| ⚪ No evidence provided | You supplied no evidence, so nothing could be checked. |

---

## What it catches that keyword matching misses

**Negation.** `"tests do not pass"` versus evidence `"all tests pass"` share almost every word, so pure overlap scoring calls it *supported*. It is the exact opposite. ClaimTape compares polarity against the single most similar evidence sentence.

**Contradictory numbers.** `"coverage 95%"` versus `"coverage: 62%"` share the token `coverage`, which used to read as support. Numbers are now compared inside metric families, and a relative difference above 15% is a conflict.

**Cross-family false positives.** A *cost* reduction of 80% and a *coverage* of 78.4% are unrelated numbers that look similar. ClaimTape deliberately refuses to compare across families — this was a real false positive in v1.4 and there is a regression test for it.

**Chinese text.** Chinese has no spaces. The old tokeniser grabbed whole runs (`系统已经上线` as one token), which matched nothing, so *every* Chinese claim scored zero coverage and got flagged. Now uses `Intl.Segmenter` with a character-bigram fallback.

---

## CLI

```bash
# From files
node cli/claimtape.js --answer answer.txt --evidence trace.jsonl

# Pipe from stdin
echo "All tests pass. Coverage is 100%." | node cli/claimtape.js

# Machine-readable
node cli/claimtape.js --answer answer.txt --evidence trace.jsonl --format json
node cli/claimtape.js --answer answer.txt --evidence trace.jsonl --format markdown
```

**Gate a pull request on it.** Exit code 1 when coverage falls below a threshold:

```bash
claimtape --answer pr-summary.md --evidence test-output.txt --fail-under 60
```

Useful when an AI writes your release notes and you want the numbers in them to trace back to the actual test output.

---

## Three ways people use it

1. **Student** — paste the AI's argument, paste the textbook section, work down the ⚠️ items first.
2. **Developer** — in CI, compare an AI-generated PR summary against the real test output and fail the build when coverage drops.
3. **PM** — compare an AI weekly report against the raw logs, then export the Markdown report (it quotes the evidence) straight into the review doc.

---

## How it works

Everything runs in your browser:

1. **Claim splitting** — the answer becomes atomic claims (sentences and bullets)
2. **Evidence indexing** — evidence text/JSONL/Markdown is tokenised, and a character-offset index is built so matches can be highlighted where they actually occur
3. **Per-claim classification** — token and numeric overlap, negation polarity, same-family numeric conflicts, risky-phrasing patterns
4. **Evidence Coverage** — a weighted summary of the above; `null` when no evidence was supplied
5. **Review queue** — conflicts first, then unchecked factual claims, then risky phrasing

**No heuristic is perfect.** ClaimTape is triage, not judgment. Use it to decide where to spend your attention.

---

## Privacy

**Everything runs locally in your browser.** No data leaves the page. No API key, no telemetry, no cookies, no backend. You can verify this by opening the network tab, or by loading the page and then going offline.

---

## Deploy

```bash
npm run build     # → dist/, ready for GitHub Pages
```

`vite.config.js` sets `base: './'`, so it works from any subdirectory. Any static host works: Pages, Vercel, Netlify, Cloudflare.

---

## 中文说明

**ClaimTape 是「人工复核优先级排序器」，不是测谎仪。**

它回答的是一个问题：AI 说的这些话，有多少能在**你提供的证据**里找到出处。它**不判断真假**。一句自信的假话只要碰巧匹配上日志就会得高分；一句正确但没有日志支撑的话就会得低分——这是刻意的行为，也正是为什么分数下面那行免责声明是常驻、不可折叠的。

> 覆盖率衡量的是证据匹配程度，不是事实正确性。

**没有证据时，它不给任何分数**，只标注每句话属于哪一类陈述。拿「无证据」去打 0 分，那不是测量，是指控。

**它能抓到纯关键词匹配抓不到的东西：**

- **否定**：「测试没有通过」和「测试全部通过」几乎共享所有词，关键词重合会判成「有支撑」，实际意思完全相反。
- **数值矛盾**：「覆盖率 95%」对上证据「覆盖率：62%」，共享 `覆盖率` 一词就被当成支撑。现在同指标家族内数值相差超过 15% 直接判冲突。
- **跨指标误判**：成本降幅 80% 和覆盖率 78.4% 是两个毫不相干的数字，但长得像。现在明确禁止跨家族比较——这是 v1.4 真实出现过的误报，已有回归测试。
- **中文分词**：中文没有空格，旧分词器把「系统已经上线」当成一个 token，匹配不到任何东西，导致**每一条中文声明都是零覆盖率并被标记**。现在用 `Intl.Segmenter`，降级方案是字符 bigram。

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most welcome contributions are new conflict detectors and test fixtures — especially ones that expose a false positive.

## License

MIT © Zijian Ni
