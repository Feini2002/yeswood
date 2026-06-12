let initialized = false;
let currentPageId = () => '';

const DEFAULT_DOC_PAGE = 'home';
const DOC_PAGES = new Set(['home', 'overview', 'pages', 'rules', 'metrics', 'data', 'technical', 'release']);
const LEGACY_DOC_PAGE_BY_SECTION = {
  'dev-doc-intro': 'home',
  'dev-doc-product': 'overview',
  'dev-doc-page-map': 'overview',
  'dev-doc-frontend-layers': 'technical',
  'dev-doc-backend': 'technical',
  'dev-doc-repo': 'technical',
  'dev-doc-source': 'data',
  'dev-doc-sync': 'data',
  'dev-doc-readmodel': 'data',
  'dev-doc-frontend-consume': 'data',
  'dev-doc-page-overview': 'pages',
  'dev-doc-page-teams': 'pages',
  'dev-doc-page-details': 'pages',
  'dev-doc-page-devmode': 'pages',
  'dev-doc-scope': 'rules',
  'dev-doc-owner': 'rules',
  'dev-doc-stage': 'rules',
  'dev-doc-filters': 'rules',
  'dev-doc-rules-layers': 'rules',
  'dev-doc-rules-stages': 'rules',
  'dev-doc-rules-responsibility': 'rules',
  'dev-doc-rules-team-queue': 'rules',
  'dev-doc-deadline': 'rules',
  'dev-doc-rules-sync': 'rules',
  'dev-doc-metrics-overview': 'metrics',
  'dev-doc-metrics-team': 'metrics',
  'dev-doc-metrics-reminder': 'metrics',
  'dev-doc-metrics-drill': 'metrics',
  'dev-doc-api': 'technical',
  'dev-doc-loading': 'technical',
  'dev-doc-cache': 'technical',
  'dev-doc-tests': 'release',
  'dev-doc-checklist': 'release',
  'dev-doc-handover': 'release',
};

function normalizeDocPage(pageKey) {
  const key = String(pageKey || '').trim();
  if (DOC_PAGES.has(key)) {
    return key;
  }
  return LEGACY_DOC_PAGE_BY_SECTION[key] || DEFAULT_DOC_PAGE;
}

function resolveDocPageFromHash() {
  const hash = window.location.hash.replace(/^#/, '');
  const [route] = hash.split('?');
  if (route === 'developer-docs') {
    return DEFAULT_DOC_PAGE;
  }
  if (route.startsWith('developer-docs/')) {
    return normalizeDocPage(route.slice('developer-docs/'.length));
  }
  return normalizeDocPage(route);
}

function updateDocHash(pageKey) {
  const nextHash = `#developer-docs/${pageKey}`;
  if (window.location.hash === nextHash) {
    return;
  }
  if (window.history?.replaceState) {
    window.history.replaceState(null, '', nextHash);
  } else {
    window.location.hash = nextHash;
  }
}

function resetDocContentScroll(shell) {
  const content = shell.querySelector?.('.dev-prd-content');
  if (content && 'scrollTop' in content) {
    content.scrollTop = 0;
  }
}

function setActiveDocPage(pageKey, { updateHash = false } = {}) {
  const shell = document.querySelector('.dev-prd-shell');
  if (!shell) {
    return;
  }
  const activePage = normalizeDocPage(pageKey);

  shell.querySelectorAll('[data-dev-doc-target]').forEach((link) => {
    const active = normalizeDocPage(link.dataset.devDocTarget) === activePage;
    link.classList.toggle('is-active', active);
    if (active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  shell.querySelectorAll('[data-dev-doc-page]').forEach((page) => {
    const active = normalizeDocPage(page.dataset.devDocPage) === activePage;
    page.hidden = !active;
    page.classList.toggle('is-active', active);
  });

  resetDocContentScroll(shell);
  if (updateHash) {
    updateDocHash(activePage);
  }
}

function syncDocPageFromHash() {
  if (currentPageId?.() !== 'developer-docs') {
    return;
  }
  setActiveDocPage(resolveDocPageFromHash());
}

export function initDeveloperDocsPage() {
  const shell = document.querySelector('.dev-prd-shell');
  if (!shell) {
    return;
  }

  if (!initialized) {
    initialized = true;
    shell.querySelectorAll('[data-dev-doc-target]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        setActiveDocPage(link.dataset.devDocTarget, { updateHash: true });
      });
    });
    window.addEventListener('hashchange', syncDocPageFromHash);
  }

  syncDocPageFromHash();
}

export function configureDeveloperDocsPage({ currentPageId: resolvePageId } = {}) {
  currentPageId = typeof resolvePageId === 'function' ? resolvePageId : () => '';
}

export function render() {}

export function load() {
  initDeveloperDocsPage();
}
