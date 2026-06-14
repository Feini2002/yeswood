const BOOT_ERROR_ID = 'dashboard-boot-error';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeBootError(error) {
  if (error instanceof Error) {
    return {
      message: error.message || 'Dashboard failed to boot.',
      stack: error.stack || '',
    };
  }
  if (typeof error === 'string') {
    return { message: error, stack: '' };
  }
  return {
    message: error?.message || String(error || 'Dashboard failed to boot.'),
    stack: error?.stack || '',
  };
}

function renderBootError(error) {
  const { message, stack } = normalizeBootError(error);
  const root = document.getElementById('app') || document.body;
  let panel = document.getElementById(BOOT_ERROR_ID);
  if (!panel) {
    panel = document.createElement('section');
    panel.id = BOOT_ERROR_ID;
    panel.setAttribute('role', 'alert');
    panel.style.cssText = [
      'box-sizing:border-box',
      'max-width:960px',
      'margin:48px auto',
      'padding:24px 28px',
      'border:1px solid #dc2626',
      'background:#fff7f7',
      'color:#111827',
      'font:14px/1.6 "Microsoft YaHei UI", "PingFang SC", sans-serif',
      'box-shadow:0 18px 40px rgba(15,23,42,.12)',
    ].join(';');
    root.prepend(panel);
  }
  panel.innerHTML = `
    <h1 style="margin:0 0 10px;font-size:18px;line-height:1.4;color:#991b1b;">Dashboard boot failed</h1>
    <p style="margin:0 0 14px;">The app module could not finish loading. Check the error below before retrying.</p>
    <pre style="white-space:pre-wrap;margin:0;padding:14px;background:#111827;color:#f9fafb;overflow:auto;">${escapeHtml(
      stack || message
    )}</pre>
  `;
}

globalThis.addEventListener('error', (event) => {
  renderBootError(event.error || event.message);
});

globalThis.addEventListener('unhandledrejection', (event) => {
  renderBootError(event.reason || 'Unhandled dashboard boot rejection.');
});

import('./app.js').catch(renderBootError);
