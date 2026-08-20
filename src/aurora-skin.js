/* AURORA SKIN · Theme A「示波 / Instrument」 — claimtape effects
   Injects: mm-grid layer, sweep scanline, crosshair corners on panels.
   Pure additive — never touches app state or existing listeners. */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function mountLayers() {
  if (!document.querySelector('.ak-grid')) {
    const grid = document.createElement('div');
    grid.className = 'ak-grid';
    grid.setAttribute('aria-hidden', 'true');
    document.body.prepend(grid);
  }
  if (!reduced && !document.querySelector('.ak-scan')) {
    const scan = document.createElement('div');
    scan.className = 'ak-scan';
    scan.setAttribute('aria-hidden', 'true');
    document.body.appendChild(scan);
  }
}

function addCrosshairs(root) {
  root.querySelectorAll('.panel').forEach((p) => {
    if (p.querySelector('.ak-x')) return;
    const tl = document.createElement('i');
    tl.className = 'ak-x tl';
    tl.setAttribute('aria-hidden', 'true');
    const br = document.createElement('i');
    br.className = 'ak-x br';
    br.setAttribute('aria-hidden', 'true');
    p.append(tl, br);
  });
}

function boot() {
  mountLayers();
  addCrosshairs(document);
  /* the app renders panels dynamically — watch and decorate new ones */
  const app = document.getElementById('app');
  if (app && 'MutationObserver' in window) {
    new MutationObserver(() => addCrosshairs(app)).observe(app, { childList: true, subtree: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
