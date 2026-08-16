import './style.css';
import { t } from './i18n.js';
import { analyze, generateMarkdownReport, generateJSONExport } from './analyzer.js';
import { DEMO_ANSWER, DEMO_EVIDENCE } from './demo.js';

export function createApp(root) {
  let lang = localStorage.getItem('ct_lang') || 'en';
  let answerText = '';
  let evidenceText = '';
  let results = null;
  let busy = false;
  let activeClaim = null;
  let filter = 'all';
  let particles = [];

  const el = (html) => {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  };

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // CT-1: badge wording comes from i18n so the four states stay honest.
  // "Supported" became "Evidence found" and "Contradicted" became "Possible
  // conflict" deliberately — the engine finds evidence matches, it does not
  // adjudicate truth, and the labels must not promise more than that.
  function badgeLabel(status, hasEvidence = true) {
    if (!hasEvidence) return t(lang, 'badge.no_evidence');
    return t(lang, 'badge.' + status) || status;
  }

  function badgeTip(status, hasEvidence = true) {
    if (!hasEvidence) return t(lang, 'badgeTooltip.no_evidence');
    const map = { unverified: 'unsupported', assessment: 'needs_human', opinion: 'needs_human' };
    return t(lang, 'badgeTooltip.' + (map[status] || status)) || '';
  }

  /** CT-2: render evidence with <mark> at the active claim's matched spans. */
  function evidencePane(claim) {
    const raw = evidenceText || '';
    if (!raw.trim()) return '';
    const spans = (claim?.spans || []).filter(s => s.end > s.start && s.start >= 0 && s.end <= raw.length);

    if (!spans.length) {
      return `<div class="ct-evidence-pane">
        <h5>${esc(t(lang, 'evidencePanel'))}</h5>
        <p class="muted sm">${esc(claim ? t(lang, 'noHighlight') : t(lang, 'evidencePanelHint'))}</p>
        <pre class="ev-body">${esc(raw.slice(0, 4000))}</pre>
      </div>`;
    }

    let html = '';
    let cursor = 0;
    for (const s of spans) {
      html += esc(raw.slice(cursor, s.start));
      html += `<mark>${esc(raw.slice(s.start, s.end))}</mark>`;
      cursor = s.end;
    }
    html += esc(raw.slice(cursor));

    return `<div class="ct-evidence-pane">
      <h5>${esc(t(lang, 'evidencePanel'))} <span class="hit-count">${spans.length}</span></h5>
      <pre class="ev-body" id="evBody">${html}</pre>
    </div>`;
  }

  function render() {
    root.innerHTML = '';
    root.appendChild(buildShell());
    bind();
    requestAnimationFrame(() => {
      root.querySelector('.ct-shell')?.classList.add('is-ready');
      if (results) animateScore();
    });
  }

  function buildShell() {
    return el(`
<div class="ct-shell" data-lang="${lang}">
  <canvas class="ct-fx" id="fx" aria-hidden="true"></canvas>
  <div class="ct-orb o1"></div><div class="ct-orb o2"></div><div class="ct-orb o3"></div>
  <div class="ct-custom-bg" id="customBg"></div>

  <header class="ct-nav">
    <div class="ct-brand">
      <span class="ct-mark">📋</span>
      <div>
        <strong>ClaimTape</strong>
        <small>evidence-first · v1.4</small>
      </div>
    </div>
    <div class="ct-nav-actions">
      <button class="ghost" id="langBtn">${lang === 'en' ? '中文' : 'EN'}</button>
      <button class="ghost" id="themeBtn">🎨</button>
      <a class="ghost" href="https://github.com/Zijian-Ni/claimtape" target="_blank" rel="noopener">GitHub</a>
    </div>
  </header>

  <section class="ct-hero">
    <div class="eyebrow">◈ offline AI claim auditor</div>
    <h1>${esc(t(lang, 'tagline'))}</h1>
    <p>${esc(t(lang, 'subtitle'))}</p>
    <div class="pills">
      <span>🎓 Students</span><span>📊 PMs</span><span>💻 Devs</span><span>👨‍👩‍👧 Parents</span>
    </div>
  </section>

  <section class="ct-workspace">
    <div class="panel input-panel">
      <div class="panel-head">
        <h2>① ${lang === 'en' ? 'Inputs' : '输入'}</h2>
        <div class="row-actions">
          <button class="ghost sm" id="demoBtn">⚡ Demo</button>
          <button class="ghost sm" id="clearBtn">Clear</button>
        </div>
      </div>

      <label class="field">
        <span>🤖 ${t(lang, 'inputLabel')}</span>
        <textarea id="answer" rows="9" >${esc(answerText)}</textarea>
      </label>

      <label class="field">
        <span>🔍 ${t(lang, 'evidenceLabel')} <em>${lang === 'en' ? 'optional but recommended' : '可选但强烈建议'}</em></span>
        <textarea id="evidence" rows="8" >${esc(evidenceText)}</textarea>
      </label>

      <div class="toolbar">
        <label class="file-btn">
          ⬆ ${t(lang, 'uploadBtn')}
          <input type="file" id="file" accept=".jsonl,.md,.txt,.json,.log" hidden />
        </label>
        <span class="file-name" id="fileName"></span>
        <button class="primary" id="analyzeBtn" ${busy ? 'disabled' : ''}>
          ${busy ? `<span class="spin"></span>${t(lang, 'analyzing')}` : `✦ ${t(lang, 'analyzeBtn')}`}
        </button>
      </div>
      <p class="lock">🔒 ${t(lang, 'privacyNote')}</p>
    </div>

    <div class="panel result-panel" id="resultPanel">
      ${results ? buildResults() : buildEmpty()}
    </div>
  </section>

  <section class="ct-how">
    <h3>${t(lang, 'howItWorks')}</h3>
    <div class="steps">
      ${[1,2,3,4].map(n => `<div class="step"><i>${n}</i><span>${t(lang, 'how' + n)}</span></div>`).join('')}
    </div>
  </section>

  <div class="theme-pop" id="themePop" hidden>
    <div class="theme-title">${lang === 'en' ? 'Atmosphere' : '氛围'}</div>
    <div class="presets">
      <button data-bg="aurora">Aurora</button>
      <button data-bg="midnight">Midnight</button>
      <button data-bg="nebula">Nebula</button>
      <button data-bg="ember">Ember</button>
    </div>
    <label class="upload-bg">${lang === 'en' ? 'Custom image / GIF' : '自定义图片/动图'}
      <input type="file" id="bgFile" accept="image/*,.gif" hidden />
    </label>
    <input type="range" id="bgOp" min="8" max="80" value="28" />
    <button class="ghost sm" id="bgClear">${lang === 'en' ? 'Clear custom' : '清除自定义'}</button>
  </div>

  <footer class="ct-foot">${t(lang, 'footer')}</footer>
</div>`);
  }

  function buildEmpty() {
    return `
      <div class="empty-state">
        <div class="empty-ring"></div>
        <h3>${lang === 'en' ? 'Run an analysis to open the trust cockpit' : '开始分析后进入可信度驾驶舱'}</h3>
        <p>${lang === 'en'
          ? 'Each claim is matched against concrete evidence snippets — not vague keyword vibes.'
          : '每条声明都会对齐到具体证据片段，而不是模糊关键词感觉。'}</p>
        <button class="primary" id="emptyDemo">⚡ ${t(lang, 'demoBtn')}</button>
      </div>`;
  }

  function buildResults() {
    const { claims, stats, riskFlags, hasEvidence, factCount } = results;
    const score = results.coverage ?? results.score;

    // CT-1: with no evidence there is nothing to measure coverage against, so
    // we show no number at all. Rendering "0/100" over text nobody ever
    // offered proof for reads as an accusation rather than a measurement.
    if (!hasEvidence) return buildNoEvidenceResults();

    const grade = score >= 70 ? 'high' : score >= 45 ? 'medium' : score >= 25 ? 'low' : 'verylow';
    const color = score >= 70 ? '#34d399' : score >= 45 ? '#fbbf24' : score >= 25 ? '#fb923c' : '#f87171';
    let list = claims;
    if (filter === 'opinion') list = claims.filter(c => c.status === 'opinion' || c.status === 'assessment');
    else if (filter === 'unverified') list = claims.filter(c => c.status === 'unverified' || c.status === 'unsupported');
    else if (filter !== 'all') list = claims.filter(c => c.status === filter);

    return `
      <div class="results-anim">
        <div class="score-hero">
          <div class="score-orb" style="--c:${color}">
            <svg viewBox="0 0 120 120">
              <circle class="track" cx="60" cy="60" r="52"/>
              <circle class="fill" id="scoreArc" cx="60" cy="60" r="52"
                stroke="${color}"
                stroke-dasharray="0 999"/>
            </svg>
            <div class="score-num" id="scoreNum" style="color:${color}">0</div>
          </div>
          <div class="score-meta">
            <div class="label">${t(lang, 'coverageScore')}</div>
            <div class="grade" style="color:${color}">${t(lang, 'coverageLabel.' + grade)}</div>
            <div class="desc">${t(lang, 'coverageScoreDesc')}</div>
            <div class="mini-stats">
              <span>${stats.total} claims</span>
              <span>${factCount || 0} evidence facts</span>
            </div>
          </div>
        </div>

        <!-- CT-1: permanent, non-collapsible. This is the whole point. -->
        <p class="ct-disclaimer">${esc(t(lang, 'disclaimer'))}</p>

        <div class="mode-banner">${esc(results.summary || '')}</div>
        <div class="stat-row dense">
          ${stat(stats.supported, t(lang, 'supported'), '#34d399', 'supported')}
          ${stat((stats.opinion||0)+(stats.assessment||0), lang==='en'?'Opinion/Assess':'意见/评估', '#38bdf8', 'opinion')}
          ${stat(stats.needs_human, t(lang, 'needsHuman'), '#a78bfa', 'needs_human')}
          ${stat(stats.unverified||stats.unsupported||0, t(lang, 'unsupported'), '#fbbf24', 'unverified')}
          ${stat(stats.contradicted, t(lang, 'contradicted'), '#f87171', 'contradicted')}
        </div>

        ${reviewQueueBlock()}

        <div class="banner ok">${t(lang, 'evidenceNote')}</div>

        ${riskFlags.length ? `
          <div class="risk-box">
            <h4>⚠️ ${t(lang, 'riskTitle')}</h4>
            <div class="risk-chips">${riskFlags.map(f => `<span>${esc(t(lang, 'riskPatterns.' + f) || f)}</span>`).join('')}</div>
          </div>` : `<div class="banner ok">🟢 ${t(lang, 'noRisks')}</div>`}

        <div class="claims-head">
          <h3>📋 ${t(lang, 'claimsTitle')}</h3>
          <div class="filters">
            ${['all','supported','opinion','assessment','needs_human','unverified','contradicted'].map(f =>
              `<button class="chip ${filter === f ? 'on' : ''}" data-f="${f}">${f === 'all' ? (lang==='en'?'All':'全部') : f}</button>`
            ).join('')}
          </div>
        </div>

        <!-- CT-2: two columns — claims on the left, the evidence they matched
             on the right, highlighted at the exact character offsets. -->
        <div class="ct-split">
          <div class="claim-list">
            ${list.map((c, i) => claimCard(c, i)).join('') || `<p class="muted">No claims in this filter.</p>`}
          </div>
          ${evidencePane(claims.find(c => c.id === activeClaim))}
        </div>

        <div class="export-row">
          <button class="ghost" id="copyMd">📄 ${t(lang, 'copyMarkdown')}</button>
          <button class="ghost" id="dlJson">⬇ ${t(lang, 'exportJSON')}</button>
        </div>
      </div>`;
  }

  /** CT-1: the review queue IS the product — the score is only a summary. */
  function reviewQueueBlock() {
    const q = results?.reviewQueue || [];
    if (!q.length) return '';
    return `
      <div class="ct-queue">
        <h4>🔎 ${esc(t(lang, 'reviewQueue'))} <small>${esc(t(lang, 'reviewQueueDesc'))}</small></h4>
        <ol>
          ${q.slice(0, 5).map(c => `
            <li><button class="queue-item" data-goto="${c.id}">
              <span class="q-badge">${esc(badgeLabel(c.status))}</span>
              <span class="q-text">${esc(c.claim.slice(0, 110))}${c.claim.length > 110 ? '…' : ''}</span>
            </button></li>`).join('')}
        </ol>
      </div>`;
  }

  /** CT-1: the no-evidence path — type labels only, and explicitly no score. */
  function buildNoEvidenceResults() {
    const { claims, stats } = results;
    return `
      <div class="results-anim">
        <div class="ct-noev">
          <div class="ct-noev-icon">⚪</div>
          <h3>${esc(t(lang, 'noEvidenceTitle'))}</h3>
          <p>${esc(t(lang, 'noEvidenceBody'))}</p>
          <button class="primary" id="addEvidenceBtn">➕ ${esc(t(lang, 'noEvidenceCta'))}</button>
        </div>

        <div class="stat-row dense">
          ${stat(stats.total, t(lang, 'totalClaims'), '#38bdf8', 'all')}
          ${stat((stats.opinion||0)+(stats.assessment||0), lang==='en'?'Opinion/Assess':'意见/评估', '#a78bfa', 'opinion')}
          ${stat(stats.unverified||0, lang==='en'?'Factual, unchecked':'事实型未核', '#fbbf24', 'unverified')}
        </div>

        <p class="ct-disclaimer">${esc(results.disclaimer || '')}</p>

        <div class="claim-list">
          ${claims.map((c, i) => claimCard(c, i, false)).join('')}
        </div>

        <div class="export-row">
          <button class="ghost" id="copyMd">📄 ${t(lang, 'copyMarkdown')}</button>
          <button class="ghost" id="dlJson">⬇ ${t(lang, 'exportJSON')}</button>
        </div>
      </div>`;
  }

  function stat(v, label, color, key) {
    return `<button class="stat ${filter === key ? 'on' : ''}" data-f="${key}" style="--c:${color}">
      <b style="color:${color}">${v}</b><span>${label}</span>
    </button>`;
  }

  function claimCard(c, i, hasEvidence = true) {
    const colors = { supported: '#34d399', opinion: '#38bdf8', assessment: '#22d3ee', unsupported: '#fbbf24', unverified: '#fbbf24', contradicted: '#f87171', needs_human: '#a78bfa' };
    const col = hasEvidence ? (colors[c.status] || '#94a3b8') : '#94a3b8';
    const open = activeClaim === c.id;
    const conflictTag = c.conflictKind
      ? `<span class="conflict-tag">${esc(t(lang, 'conflictReason.' + c.conflictKind))}</span>`
      : '';
    return `
    <article class="claim ${open ? 'open' : ''}" data-id="${c.id}" style="--c:${col}; --d:${i * 40}ms">
      <header>
        <span class="idx">#${c.id}</span>
        <span class="badge" style="color:${col};border-color:${col}55;background:${col}18"
              title="${esc(badgeTip(c.status, hasEvidence))}">${esc(badgeLabel(c.status, hasEvidence))}</span>
        ${conflictTag}
        ${c.isRisky ? '<span class="risk-tag">🚩</span>' : ''}
        <span class="chev">${open ? '▾' : '▸'}</span>
      </header>
      <p class="claim-text">${esc(c.claim)}</p>
      <div class="claim-tags"><span class="kind">${esc(c.kind || '')}</span>${c.confidence!=null?`<span class="conf">${Math.round(c.confidence*100)}%</span>`:''}</div>
      ${open ? `
        <div class="claim-body">
          ${c.reasons?.length ? `<div class="why"><h5>${lang==='en'?'Why':'判定理由'}</h5>${c.reasons.map(r => `<div>${esc(r)}</div>`).join('')}</div>` : ''}
          ${c.evidenceMatches?.length ? `<div class="matches"><h5>${t(lang, 'evidenceMatches')}</h5><div class="tags">${c.evidenceMatches.slice(0,10).map(m => `<span>${esc(m)}</span>`).join('')}</div></div>` : ''}
          ${c.conflictSignals?.length ? `<div class="matches bad"><h5>${t(lang, 'conflictMatches')}</h5><div class="tags">${c.conflictSignals.map(m => `<span>${esc(m)}</span>`).join('')}</div></div>` : ''}
          ${c.evidenceSnippets?.length ? `<div class="snips"><h5>${lang==='en'?'Evidence snippets':'证据片段'}</h5>${c.evidenceSnippets.map(s => `
            <pre><span class="ln">L${s.line}</span> ${esc(s.snippet)}</pre>`).join('')}</div>` : ''}
        </div>` : ''}
    </article>`;
  }

  function bind() {
    const aEl = root.querySelector('#answer');
    const eEl = root.querySelector('#evidence');
    if (aEl) { aEl.placeholder = t(lang, 'inputPlaceholder') || 'Paste AI answer…'; aEl.value = answerText; }
    if (eEl) { eEl.placeholder = t(lang, 'evidencePlaceholder') || 'Optional evidence…'; eEl.value = evidenceText; }

    root.querySelector('#langBtn')?.addEventListener('click', () => {
      sync(); lang = lang === 'en' ? 'zh' : 'en'; localStorage.setItem('ct_lang', lang); render();
    });
    aEl?.addEventListener('input', e => answerText = e.target.value);
    eEl?.addEventListener('input', e => evidenceText = e.target.value);
    root.querySelector('#analyzeBtn')?.addEventListener('click', () => run());
    root.querySelector('#demoBtn')?.addEventListener('click', () => run({ skipSync: true, answer: DEMO_ANSWER, evidence: DEMO_EVIDENCE }));
    root.querySelector('#emptyDemo')?.addEventListener('click', () => run({ skipSync: true, answer: DEMO_ANSWER, evidence: DEMO_EVIDENCE }));
    root.querySelector('#clearBtn')?.addEventListener('click', () => { answerText=''; evidenceText=''; results=null; filter='all'; activeClaim=null; render(); });
    root.querySelector('#file')?.addEventListener('change', async e => {
      const f = e.target.files?.[0]; if (!f) return;
      evidenceText = await f.text();
      const n = root.querySelector('#fileName'); if (n) n.textContent = f.name;
      const ev = root.querySelector('#evidence'); if (ev) ev.value = evidenceText;
    });
    root.querySelector('#copyMd')?.addEventListener('click', async () => {
      if (!results) return;
      await navigator.clipboard.writeText(generateMarkdownReport(results, lang));
      toast(t(lang, 'copied'));
    });
    root.querySelector('#dlJson')?.addEventListener('click', () => {
      if (!results) return;
      const blob = new Blob([generateJSONExport(results, answerText, evidenceText)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `claimtape-${Date.now()}.json`; a.click();
      toast(t(lang, 'downloaded'));
    });
    root.querySelectorAll('.claim').forEach(card => {
      card.addEventListener('click', () => {
        const id = Number(card.dataset.id);
        activeClaim = activeClaim === id ? null : id;
        // soft re-render results only
        const panel = root.querySelector('#resultPanel');
        if (panel && results) {
          panel.innerHTML = buildResults();
          bindResultsOnly();
          burst(card);
          scrollToHighlight();
        }
      });
    });
    root.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      filter = b.dataset.f;
      const panel = root.querySelector('#resultPanel');
      if (panel && results) { panel.innerHTML = buildResults(); bindResultsOnly(); }
    }));
    bindTheme();
    bootFx();
    applyBg();
  }

  function bindResultsOnly() {
    root.querySelectorAll('.claim').forEach(card => {
      card.addEventListener('click', () => {
        const id = Number(card.dataset.id);
        activeClaim = activeClaim === id ? null : id;
        const panel = root.querySelector('#resultPanel');
        if (panel && results) { panel.innerHTML = buildResults(); bindResultsOnly(); animateScore(false); scrollToHighlight(); }
      });
    });
    // CT-1: review-queue entries jump straight to the claim they name.
    root.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      activeClaim = Number(b.dataset.goto);
      const panel = root.querySelector('#resultPanel');
      if (panel && results) {
        panel.innerHTML = buildResults();
        bindResultsOnly();
        animateScore(false);
        root.querySelector(`.claim[data-id="${activeClaim}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        scrollToHighlight();
      }
    }));
    root.querySelector('#addEvidenceBtn')?.addEventListener('click', () => {
      root.querySelector('#evidence')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      root.querySelector('#evidence')?.focus();
    });
    root.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      filter = b.dataset.f;
      const panel = root.querySelector('#resultPanel');
      if (panel && results) { panel.innerHTML = buildResults(); bindResultsOnly(); animateScore(false); }
    }));
    root.querySelector('#copyMd')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(generateMarkdownReport(results, lang)); toast(t(lang, 'copied'));
    });
    root.querySelector('#dlJson')?.addEventListener('click', () => {
      const blob = new Blob([generateJSONExport(results, answerText, evidenceText)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `claimtape-${Date.now()}.json`; a.click();
    });
  }

  function sync() {
    answerText = root.querySelector('#answer')?.value ?? answerText;
    evidenceText = root.querySelector('#evidence')?.value ?? evidenceText;
  }

  function run(opts = {}) {
    // CRITICAL: demo/preset must not sync from empty DOM
    if (!opts.skipSync) sync();
    if (opts.answer != null) answerText = opts.answer;
    if (opts.evidence != null) evidenceText = opts.evidence;
    if (!String(answerText || '').trim()) {
      root.querySelector('#answer')?.classList.add('shake');
      setTimeout(() => root.querySelector('#answer')?.classList.remove('shake'), 500);
      toast(lang === 'en' ? 'Paste an AI answer first' : '请先粘贴 AI 回答');
      return;
    }
    busy = true; render();
    setTimeout(() => {
      try {
        results = analyze(answerText, evidenceText);
      } catch (err) {
        busy = false; render();
        toast('Analyze failed: ' + err.message);
        console.error(err);
        return;
      }
      busy = false; filter = 'all'; activeClaim = results.claims[0]?.id ?? null;
      render();
      spawnBurst();
      root.querySelector('#resultPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 220);
  }

  function animateScore(anim = true) {
    if (!results) return;
    // CT-1: no evidence means no coverage number and therefore no gauge to
    // animate. The no-evidence view does not render these nodes at all.
    const target = results.coverage ?? results.score;
    if (target == null) return;
    const num = root.querySelector('#scoreNum');
    const arc = root.querySelector('#scoreArc');
    const C = 2 * Math.PI * 52;
    if (!num || !arc) return;
    if (!anim) {
      num.textContent = String(target);
      arc.style.strokeDasharray = `${C * target / 100} ${C}`;
      return;
    }
    const t0 = performance.now();
    const dur = 900;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(target * eased);
      num.textContent = String(v);
      arc.style.strokeDasharray = `${C * v / 100} ${C}`;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * CT-2: bring the first highlighted evidence span into view. Without this the
   * highlight can land off-screen in a long log and the whole interaction feels
   * broken even though it worked.
   */
  function scrollToHighlight() {
    requestAnimationFrame(() => {
      const mark = root.querySelector('#evBody mark');
      if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function toast(msg) {
    const n = el(`<div class="toast">${esc(msg)}</div>`);
    root.appendChild(n);
    requestAnimationFrame(() => n.classList.add('show'));
    setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 300); }, 1400);
  }

  // ---- FX canvas ----
  let fxRaf = 0;
  function bootFx() {
    const c = root.querySelector('#fx');
    if (!c) return;
    const ctx = c.getContext('2d');
    const resize = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); };
    resize();
    addEventListener('resize', resize, { passive: true });
    if (!particles.length) {
      for (let i = 0; i < 48; i++) particles.push(mkP());
    }
    cancelAnimationFrame(fxRaf);
    const loop = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = innerWidth; if (p.x > innerWidth) p.x = 0;
        if (p.y < 0) p.y = innerHeight; if (p.y > innerHeight) p.y = 0;
        ctx.beginPath();
        ctx.fillStyle = p.c;
        ctx.globalAlpha = p.a;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      fxRaf = requestAnimationFrame(loop);
    };
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) loop();
  }
  function mkP() {
    const colors = ['rgba(52,211,153,.9)', 'rgba(56,189,248,.9)', 'rgba(167,139,250,.9)', 'rgba(244,114,182,.75)'];
    return {
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35,
      r: Math.random() * 2.2 + .4, a: Math.random() * .35 + .08,
      c: colors[Math.floor(Math.random() * colors.length)],
    };
  }
  function spawnBurst() {
    for (let i = 0; i < 18; i++) {
      const p = mkP();
      p.x = innerWidth * 0.72; p.y = innerHeight * 0.35;
      p.vx = (Math.random() - .5) * 3; p.vy = (Math.random() - .5) * 3;
      p.a = .7; p.r = Math.random() * 3 + 1;
      particles.push(p);
    }
    if (particles.length > 90) particles.splice(0, particles.length - 90);
  }
  function burst() { spawnBurst(); }

  function bindTheme() {
    const pop = root.querySelector('#themePop');
    root.querySelector('#themeBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pop) pop.hidden = !pop.hidden;
    });
    pop?.querySelectorAll('[data-bg]').forEach(b => b.addEventListener('click', () => {
      localStorage.setItem('ct_bg_preset', b.dataset.bg);
      document.documentElement.dataset.bg = b.dataset.bg;
    }));
    root.querySelector('#bgFile')?.addEventListener('change', e => {
      const f = e.target.files?.[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { localStorage.setItem('ct_bg_custom', r.result); } catch {} applyBg(); };
      r.readAsDataURL(f);
    });
    root.querySelector('#bgOp')?.addEventListener('input', e => {
      localStorage.setItem('ct_bg_opacity', e.target.value);
      document.documentElement.style.setProperty('--ct-bg-op', String(Number(e.target.value) / 100));
    });
    root.querySelector('#bgClear')?.addEventListener('click', () => {
      localStorage.removeItem('ct_bg_custom'); applyBg();
    });
  }

  function applyBg() {
    const preset = localStorage.getItem('ct_bg_preset') || 'aurora';
    document.documentElement.dataset.bg = preset;
    const op = localStorage.getItem('ct_bg_opacity') || '28';
    document.documentElement.style.setProperty('--ct-bg-op', String(Number(op) / 100));
    const opEl = root.querySelector('#bgOp'); if (opEl) opEl.value = op;
    const layer = root.querySelector('#customBg');
    const custom = localStorage.getItem('ct_bg_custom');
    if (layer) {
      if (custom) { layer.style.backgroundImage = `url(${custom})`; layer.classList.add('on'); }
      else { layer.style.backgroundImage = ''; layer.classList.remove('on'); }
    }
  }

  render();
}

const root = document.getElementById('app');
if (root) createApp(root);
