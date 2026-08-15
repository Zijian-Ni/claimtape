# 📋 ClaimTape

> **"Did the AI actually prove that?"**

Paste any AI-generated answer. Get a claim-by-claim trust report — instantly, locally, with no API key.

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/deploy-GitHub%20Pages-blue.svg)](#deploy-to-github-pages)
[![No API Key](https://img.shields.io/badge/API%20key-not%20required-brightgreen.svg)](#)
[![Works Offline](https://img.shields.io/badge/offline-ready-purple.svg)](#)

**[Try it live →](https://yourusername.github.io/claimtape)**

---

## Who is this for?

| You are… | You use it to… |
|----------|---------------|
| 🎓 **Student** | Check if that ChatGPT essay actually backs up its claims |
| 📊 **Product Manager** | Verify an AI-written spec against a log trace |
| 💻 **Developer** | Sanity-check an AI code review that says "all tests pass" |
| 👨‍👩‍👧 **Parent** | See which parts of your kid's AI homework are unsupported guesses |
| 📝 **Researcher** | Triage AI-generated summaries before citing them |

---

## What it does

```
┌─────────────────────────────────────────────────────────────┐
│  Paste AI answer ──────────────────────────────────────────▶ │
│                                                              │
│  Paste/upload evidence (optional: logs, trace.jsonl, text) ▶ │
│                                                              │
│  ──────────────────────────────────────────────────────── ▶ │
│  📊 Trust Score 0–100                                        │
│  ✅ / ⚠️ / ❌ / 🔍  badges per claim                        │
│  🚩 Risk flags: "100% coverage", "already deployed", etc.   │
│  📋 Copy shareable Markdown report                           │
│  💾 Export JSON                                              │
└─────────────────────────────────────────────────────────────┘
```

**Claim statuses:**

| Badge | Meaning |
|-------|---------|
| ✅ Supported | Key terms from this claim appear in evidence |
| ⚠️ Unsupported | No matching evidence found |
| ❌ Contradicted | Evidence contains signals that conflict |
| 🔍 Needs Human | Contains specific numbers/paths/commands requiring manual check |

**Risk patterns flagged:**
- `tests pass` / `no bugs` without matching evidence
- `100%` success claims
- `already deployed` / `running in production` without deploy evidence
- `no issues found` when evidence shows errors
- Overconfident `"will definitely work"` / `"guaranteed"`

---

## Quickstart

```bash
# Clone
git clone https://github.com/Zijian-Ni/claimtape.git
cd claimtape

# Install dependencies
npm install

# Run dev server
npm run dev
# → http://localhost:5173

# Build for production
npm run build
# → dist/ ready for GitHub Pages
```

---

## CLI (optional)

```bash
# Pipe from stdin
echo "All tests pass. Coverage is 100%." | node cli/claimtape.js

# From files
node cli/claimtape.js --answer answer.txt --evidence trace.jsonl

# JSON output
node cli/claimtape.js --answer answer.txt --evidence trace.jsonl --format json

# Markdown report
node cli/claimtape.js --answer answer.txt --format markdown
```

---

## Deploy to GitHub Pages

```bash
npm run build
# Push dist/ to gh-pages branch, or use GitHub Actions
```

The app uses `base: './'` in `vite.config.js` — works at any subdirectory path.

Or deploy to any static host: Vercel, Netlify, Cloudflare Pages — just `npm run build` and point to `dist/`.

---

## How it works

ClaimTape runs entirely in your browser:

1. **Claim splitting** — Splits the AI answer into atomic claims (sentences + bullet points)
2. **Evidence parsing** — Tokenizes evidence text, JSONL, or Markdown into a keyword/value set
3. **Claim classification** — For each claim:
   - Checks keyword overlap between claim and evidence
   - Detects conflict signals (e.g. claim says "pass", evidence has "failed")
   - Flags claims with specific values (numbers, paths, commands) as "Needs Human"
   - Detects known overconfident patterns as "Risk"
4. **Trust score** — Weighted average of claim statuses, minus risk penalty, plus evidence bonus
5. **Export** — Shareable Markdown report or JSON

**No heuristic is perfect.** ClaimTape is a triage tool, not a replacement for judgment. Use it to quickly spot where to focus human review.

---

## 🔒 Privacy

**Everything runs locally in your browser.** No data is sent to any server. No API key. No telemetry. No cookies.

You can even download the built `dist/` folder and open `index.html` directly — it works fully offline.

---

## Project structure

```
claimtape/
├── src/
│   ├── main.js          # Entry point
│   ├── app.js           # UI component (vanilla JS)
│   ├── analyzer.js      # Core analysis engine
│   ├── i18n.js          # EN/CN translations
│   ├── demo.js          # Bundled demo data
│   └── style.css        # Aurora dark theme
├── cli/
│   └── claimtape.js     # Optional CLI
├── tests/
│   └── analyzer.test.js # Unit tests (Node ESM)
├── docs/
│   └── HOMEPAGE.md      # Card copy CN+EN
├── public/
│   └── favicon.svg
├── index.html
├── vite.config.js
├── package.json
└── README.md
```

---

## Contributing

PRs welcome! Ideas:

- [ ] More language support (JP, DE, FR)
- [ ] Smarter NLP (stemming, synonyms)
- [ ] Chrome extension
- [ ] VSCode extension
- [ ] PDF evidence support

---

## License

MIT © 2026 — See [LICENSE](LICENSE)

---

*Made with 💜 for everyone burned by confident wrong AI.*
