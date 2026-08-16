import './style.css';
// ClaimTape — Main App
import { t } from './i18n.js';
import { analyze, generateMarkdownReport, generateJSONExport } from './analyzer.js';
import { DEMO_ANSWER, DEMO_EVIDENCE } from './demo.js';

export function createApp(rootEl) {
  let lang = localStorage.getItem('ct_lang') || 'en';
  let currentResults = null;
  let answerText = '';
  let evidenceText = '';
  let isAnalyzing = false;

  function render() {
    rootEl.innerHTML = buildHTML();
    bindEvents();
    if (currentResults) renderResults();
  }

  function buildHTML() {
    return `
<div class="ct-app" data-lang="${lang}">
  <div class="ct-aurora-bg" aria-hidden="true">
    <div class="ct-band ct-band-1"></div>
    <div class="ct-band ct-band-2"></div>
    <div class="ct-band ct-band-3"></div>
    <div class="ct-grid"></div>
    <div class="ct-custom-bg" id="customBgLayer"></div>
  </div>
  ${buildHeader()}
  ${buildHero()}
  ${buildInputPanel()}
  ${buildResultsPanel()}
  ${buildFooter()}
  ${buildThemeDock()}
</div>`;
  }

  function buildThemeDock() {
    return `
<div class="ct-theme-dock" id="themeDock">
  <button class="ct-theme-toggle" id="themeToggle" title="Background / 背景">🎨</button>
  <div class="ct-theme-panel" id="themePanel" hidden>
    <div class="ct-theme-title">${lang === 'en' ? 'Background' : '背景'}</div>
    <div class="ct-theme-presets">
      <button data-bg="aurora" class="ct-preset active">Aurora</button>
      <button data-bg="midnight" class="ct-preset">Midnight</button>
      <button data-bg="nebula" class="ct-preset">Nebula</button>
      <button data-bg="ember" class="ct-preset">Ember</button>
    </div>
    <label class="ct-theme-upload">
      ${lang === 'en' ? 'Custom image / GIF' : '自定义图片 / 动图'}
      <input type="file" id="bgUpload" accept="image/*,.gif" hidden />
    </label>
    <input type="range" id="bgOpacity" min="10" max="90" value="35" />
    <button class="ct-btn ct-btn--ghost" id="bgClear">${lang === 'en' ? 'Clear custom' : '清除自定义'}</button>
  </div>
</div>`;
  }

  function buildHeader() {
    return `
<header class="ct-header">
  <div class="ct-header-inner">
    <div class="ct-logo">
      <span class="ct-logo-icon">📋</span>
      <span class="ct-logo-text">ClaimTape</span>
      <span class="ct-logo-badge">v1.1</span>
    </div>
    <div class="ct-header-actions">
      <button class="ct-lang-toggle" id="langToggle" title="Switch language / 切换语言">
        ${lang === 'en' ? '🇨🇳 中文' : '🇬🇧 EN'}
      </button>
      <a class="ct-github-btn" href="https://github.com/Zijian-Ni/claimtape" target="_blank" rel="noopener" title="View on GitHub">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
        GitHub
      </a>
    </div>
  </div>
</header>`;
  }

  function buildHero() {
    return `
<section class="ct-hero">
  <div class="ct-hero-glow"></div>
  <div class="ct-hero-content">
    <h1 class="ct-hero-title">${t(lang, 'tagline')}</h1>
    <p class="ct-hero-sub">${t(lang, 'subtitle')}</p>
    <div class="ct-hero-pills">
      <span class="ct-pill">🎓 ${lang === 'en' ? 'Students' : '学生'}</span>
      <span class="ct-pill">📊 ${lang === 'en' ? 'PMs' : '产品经理'}</span>
      <span class="ct-pill">💻 ${lang === 'en' ? 'Developers' : '开发者'}</span>
      <span class="ct-pill">👨‍👩‍👧 ${lang === 'en' ? 'Parents checking AI homework' : '检查作业的家长'}</span>
    </div>
  </div>
</section>`;
  }

  function buildInputPanel() {
    return `
<section class="ct-input-panel">
  <div class="ct-panel-inner">

    <div class="ct-input-group">
      <label class="ct-label" for="answerInput">
        <span class="ct-label-icon">🤖</span>
        ${t(lang, 'inputLabel')}
      </label>
      <textarea
        id="answerInput"
        class="ct-textarea ct-textarea--answer"
        placeholder="${t(lang, 'inputPlaceholder')}"
        spellcheck="false"
        rows="10"
      >${escapeHtml(answerText)}</textarea>
    </div>

    <div class="ct-input-group">
      <label class="ct-label" for="evidenceInput">
        <span class="ct-label-icon">🔍</span>
        ${t(lang, 'evidenceLabel')}
        <span class="ct-optional-badge">${lang === 'en' ? 'optional' : '可选'}</span>
      </label>
      <textarea
        id="evidenceInput"
        class="ct-textarea ct-textarea--evidence"
        placeholder="${t(lang, 'evidencePlaceholder')}"
        spellcheck="false"
        rows="8"
      >${escapeHtml(evidenceText)}</textarea>
      <div class="ct-upload-row">
        <label class="ct-upload-btn" for="fileUpload">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          ${t(lang, 'uploadBtn')}
        </label>
        <input type="file" id="fileUpload" accept=".jsonl,.md,.txt,.json,.log" style="display:none">
        <span id="uploadFileName" class="ct-upload-name"></span>
      </div>
    </div>

    <div class="ct-action-row">
      <button id="analyzeBtn" class="ct-btn ct-btn--primary" ${isAnalyzing ? 'disabled' : ''}>
        ${isAnalyzing
          ? `<span class="ct-spinner"></span>${t(lang, 'analyzing')}`
          : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>${t(lang, 'analyzeBtn')}`
        }
      </button>
      <button id="demoBtn" class="ct-btn ct-btn--secondary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        ${t(lang, 'demoBtn')}
      </button>
      <button id="clearBtn" class="ct-btn ct-btn--ghost">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        ${t(lang, 'clearBtn')}
      </button>
    </div>

    <p class="ct-privacy-note">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      ${t(lang, 'privacyNote')}
    </p>
  </div>
</section>`;
  }

  function buildResultsPanel() {
    if (!currentResults) return '<div id="resultsPanel"></div>';

    const { claims, score, stats, riskFlags, hasEvidence } = currentResults;
    const scoreLabel = score >= 70 ? 'high' : score >= 45 ? 'medium' : score >= 25 ? 'low' : 'verylow';
    const scoreColor = score >= 70 ? '#10b981' : score >= 45 ? '#f59e0b' : score >= 25 ? '#f97316' : '#ef4444';

    return `
<div id="resultsPanel">
<section class="ct-results">
  <div class="ct-panel-inner">

    ${!hasEvidence ? `<div class="ct-no-evidence-banner">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      ${t(lang, 'noEvidence')}
    </div>` : `<div class="ct-has-evidence-banner">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      ${t(lang, 'evidenceNote')}
    </div>`}

    <div class="ct-score-section">
      <div class="ct-score-card">
        <div class="ct-score-ring" style="--score-color:${scoreColor};--score:${score}">
          <svg viewBox="0 0 120 120" class="ct-ring-svg">
            <circle cx="60" cy="60" r="52" class="ct-ring-bg"/>
            <circle cx="60" cy="60" r="52" class="ct-ring-fill"
              style="stroke:${scoreColor};stroke-dasharray:${Math.round(2*Math.PI*52*score/100)} ${Math.round(2*Math.PI*52)};transform-origin:center;transform:rotate(-90deg)"/>
          </svg>
          <div class="ct-score-number" style="color:${scoreColor}">${score}</div>
        </div>
        <div class="ct-score-label">${t(lang, 'trustScore')}</div>
        <div class="ct-score-grade" style="color:${scoreColor}">${t(lang, `scoreLabel.${scoreLabel}`)}</div>
        <div class="ct-score-desc">${t(lang, 'trustScoreDesc')}</div>
      </div>

      <div class="ct-stats-grid">
        ${buildStatCard(stats.total, t(lang, 'totalClaims'), '📊', '#64748b')}
        ${buildStatCard(stats.supported, t(lang, 'supported'), '✅', '#10b981')}
        ${buildStatCard(stats.unsupported, t(lang, 'unsupported'), '⚠️', '#f59e0b')}
        ${buildStatCard(stats.contradicted, t(lang, 'contradicted'), '❌', '#ef4444')}
        ${buildStatCard(stats.needs_human, t(lang, 'needsHuman'), '🔍', '#a78bfa')}
      </div>
    </div>

    ${riskFlags.length > 0 ? `
    <div class="ct-risk-section">
      <h3 class="ct-section-title">
        <span>⚠️</span> ${t(lang, 'riskTitle')}
      </h3>
      <div class="ct-risk-list">
        ${riskFlags.map(f => `
          <div class="ct-risk-item">
            <span class="ct-risk-icon">🚩</span>
            <span>${t(lang, `riskPatterns.${f}`)}</span>
          </div>`).join('')}
      </div>
    </div>` : `
    <div class="ct-no-risks">
      <span>🟢</span> ${t(lang, 'noRisks')}
    </div>`}

    <div class="ct-claims-section">
      <h3 class="ct-section-title">
        <span>📋</span> ${t(lang, 'claimsTitle')}
      </h3>
      <div class="ct-claims-list">
        ${claims.map(c => buildClaimCard(c)).join('')}
      </div>
    </div>

    <div class="ct-export-row">
      <button id="copyMarkdownBtn" class="ct-btn ct-btn--export">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        ${t(lang, 'copyMarkdown')}
      </button>
      <button id="exportJSONBtn" class="ct-btn ct-btn--export">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        ${t(lang, 'exportJSON')}
      </button>
    </div>

  </div>
</section>
</div>`;
  }

  function buildStatCard(value, label, icon, color) {
    return `
<div class="ct-stat-card" style="--stat-color:${color}">
  <div class="ct-stat-icon">${icon}</div>
  <div class="ct-stat-value" style="color:${color}">${value}</div>
  <div class="ct-stat-label">${label}</div>
</div>`;
  }

  function buildClaimCard(claim) {
    const statusColors = {
      supported: '#10b981',
      unsupported: '#f59e0b',
      contradicted: '#ef4444',
      needs_human: '#a78bfa',
    };
    const color = statusColors[claim.status] || '#64748b';
    const badge = t(lang, `badge.${claim.status}`);
    const tooltip = t(lang, `badgeTooltip.${claim.status}`);

    return `
<div class="ct-claim-card ${claim.isRisky ? 'ct-claim-card--risky' : ''}" style="--claim-color:${color}">
  <div class="ct-claim-header">
    <span class="ct-claim-num">${t(lang, 'claimNumber')} ${claim.id}</span>
    <span class="ct-badge" style="background:${color}20;color:${color};border-color:${color}40" title="${tooltip}">
      ${badge}
    </span>
    ${claim.isRisky ? '<span class="ct-risk-tag">🚩 Risk</span>' : ''}
  </div>
  <p class="ct-claim-text">${escapeHtml(claim.claim)}</p>
  ${claim.evidenceMatches.length > 0 ? `
  <div class="ct-claim-meta">
    <span class="ct-meta-label">${t(lang, 'evidenceMatches')}</span>
    <div class="ct-keyword-chips">
      ${claim.evidenceMatches.slice(0, 8).map(m => `<span class="ct-chip ct-chip--match">${escapeHtml(m)}</span>`).join('')}
      ${claim.evidenceMatches.length > 8 ? `<span class="ct-chip ct-chip--more">+${claim.evidenceMatches.length - 8}</span>` : ''}
    </div>
  </div>` : (claim.status !== 'supported' ? `
  <div class="ct-claim-meta">
    <span class="ct-meta-label ct-meta-label--dim">${t(lang, 'noEvidenceMatches')}</span>
  </div>` : '')}
  ${claim.conflictSignals.length > 0 ? `
  <div class="ct-claim-meta">
    <span class="ct-meta-label ct-meta-label--conflict">${t(lang, 'conflictMatches')}</span>
    <div class="ct-keyword-chips">
      ${claim.conflictSignals.map(s => `<span class="ct-chip ct-chip--conflict">${escapeHtml(s)}</span>`).join('')}
    </div>
  </div>` : ''}
  ${claim.reasons?.length ? `
  <div class="ct-claim-meta">
    <span class="ct-meta-label">${lang === 'en' ? 'Why' : '判定理由'}</span>
    <div class="ct-reason-list">${claim.reasons.map(r => `<span class="ct-reason">${escapeHtml(r)}</span>`).join('')}</div>
  </div>` : ''}
</div>`;
  }

  function buildFooter() {
    return `
<footer class="ct-footer">
  <div class="ct-footer-inner">
    <div class="ct-footer-how">
      <h4>${t(lang, 'howItWorks')}</h4>
      <div class="ct-how-steps">
        ${[1,2,3,4].map(n => `<div class="ct-how-step"><span class="ct-step-num">${n}</span><span>${t(lang, `how${n}`)}</span></div>`).join('')}
      </div>
    </div>
    <p class="ct-footer-text">${t(lang, 'footer')}</p>
  </div>
</footer>`;
  }

  // ───── Events ─────

  function bindEvents() {
    // Language toggle
    document.getElementById('langToggle')?.addEventListener('click', () => {
      lang = lang === 'en' ? 'zh' : 'en';
      localStorage.setItem('ct_lang', lang);
      // Save inputs before re-render
      syncInputs();
      render();
      if (currentResults) window.scrollTo({ top: document.querySelector('.ct-results')?.offsetTop ?? 0, behavior: 'smooth' });
    });

    // Sync textarea content on change
    document.getElementById('answerInput')?.addEventListener('input', e => { answerText = e.target.value; });
    document.getElementById('evidenceInput')?.addEventListener('input', e => { evidenceText = e.target.value; });

    // Analyze
    document.getElementById('analyzeBtn')?.addEventListener('click', () => {
      syncInputs();
      if (!answerText.trim()) {
        flashEmpty('answerInput');
        return;
      }
      runAnalysis();
    });

    // Demo
    document.getElementById('demoBtn')?.addEventListener('click', () => {
      answerText = DEMO_ANSWER;
      evidenceText = DEMO_EVIDENCE;
      runAnalysis(true);
    });

    // Clear
    document.getElementById('clearBtn')?.addEventListener('click', () => {
      answerText = '';
      evidenceText = '';
      currentResults = null;
      render();
    });

    // File upload
    document.getElementById('fileUpload')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        evidenceText = ev.target.result;
        const el = document.getElementById('evidenceInput');
        if (el) el.value = evidenceText;
        const nameEl = document.getElementById('uploadFileName');
        if (nameEl) nameEl.textContent = file.name;
      };
      reader.readAsText(file);
    });

    // Export
    document.getElementById('copyMarkdownBtn')?.addEventListener('click', () => {
      if (!currentResults) return;
      const md = generateMarkdownReport(currentResults, lang);
      navigator.clipboard.writeText(md).then(() => {
        flashBtn('copyMarkdownBtn', t(lang, 'copied'));
      });
    });

    document.getElementById('exportJSONBtn')?.addEventListener('click', () => {
      if (!currentResults) return;
      const json = generateJSONExport(currentResults, answerText, evidenceText);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claimtape-report-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      flashBtn('exportJSONBtn', t(lang, 'downloaded'));
    });

    bindThemeDock();
  }

  function bindThemeDock() {
    const dock = document.getElementById('themeDock');
    const panel = document.getElementById('themePanel');
    const toggle = document.getElementById('themeToggle');
    if (!dock || !panel || !toggle) return;

    // restore
    applySavedBg();

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
    });

    panel.querySelectorAll('.ct-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.ct-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        localStorage.setItem('ct_bg_preset', btn.dataset.bg);
        document.documentElement.dataset.bg = btn.dataset.bg;
      });
    });

    document.getElementById('bgUpload')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        try { localStorage.setItem('ct_bg_custom', dataUrl); } catch { /* quota */ }
        applyCustomBg(dataUrl);
      };
      reader.readAsDataURL(file);
    });

    document.getElementById('bgOpacity')?.addEventListener('input', (e) => {
      const v = e.target.value;
      localStorage.setItem('ct_bg_opacity', v);
      document.documentElement.style.setProperty('--ct-custom-opacity', String(Number(v) / 100));
    });

    document.getElementById('bgClear')?.addEventListener('click', () => {
      localStorage.removeItem('ct_bg_custom');
      applyCustomBg(null);
    });
  }

  function applySavedBg() {
    const preset = localStorage.getItem('ct_bg_preset') || 'aurora';
    document.documentElement.dataset.bg = preset;
    document.querySelectorAll('.ct-preset').forEach(b => {
      b.classList.toggle('active', b.dataset.bg === preset);
    });
    const op = localStorage.getItem('ct_bg_opacity') || '35';
    document.documentElement.style.setProperty('--ct-custom-opacity', String(Number(op) / 100));
    const opEl = document.getElementById('bgOpacity');
    if (opEl) opEl.value = op;
    const custom = localStorage.getItem('ct_bg_custom');
    if (custom) applyCustomBg(custom);
  }

  function applyCustomBg(dataUrl) {
    const layer = document.getElementById('customBgLayer');
    if (!layer) return;
    if (dataUrl) {
      layer.style.backgroundImage = `url(${dataUrl})`;
      layer.classList.add('show');
    } else {
      layer.style.backgroundImage = '';
      layer.classList.remove('show');
    }
  }

  function syncInputs() {
    const a = document.getElementById('answerInput');
    const e = document.getElementById('evidenceInput');
    if (a) answerText = a.value;
    if (e) evidenceText = e.value;
  }

  function runAnalysis(isDemo = false) {
    isAnalyzing = true;
    // Keep inputs populated during render
    const savedAnswer = answerText;
    const savedEvidence = evidenceText;
    render();
    // Restore inputs
    answerText = savedAnswer;
    evidenceText = savedEvidence;

    // Simulate brief async for UX
    setTimeout(() => {
      currentResults = analyze(answerText, evidenceText);
      isAnalyzing = false;
      render();
      // Scroll to results
      setTimeout(() => {
        const el = document.getElementById('resultsPanel');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }, 300);
  }

  function renderResults() {
    // Already rendered in buildHTML
  }

  function flashEmpty(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('ct-shake');
    el.focus();
    setTimeout(() => el.classList.remove('ct-shake'), 600);
  }

  function flashBtn(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    const orig = el.innerHTML;
    el.textContent = text;
    el.classList.add('ct-btn--success');
    setTimeout(() => { el.innerHTML = orig; el.classList.remove('ct-btn--success'); }, 1500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Initial render
  render();
}


// Bootstrap
const root = document.getElementById('app');
if (root) createApp(root);
