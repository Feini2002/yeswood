let tooltipEl = null;
let activeTrigger = null;

function ensureTooltip() {
  if (tooltipEl) {
    return tooltipEl;
  }
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'chart-tooltip';
  tooltipEl.hidden = true;
  tooltipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function tooltipDataAttr(data) {
  return ` data-tooltip="${JSON.stringify(data).replace(/"/g, '&quot;')}"`;
}

function tooltipToneClass(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function renderTooltipMetricGrid(metrics = []) {
  const safeMetrics = metrics.filter((item) => item && (item.label || item.value !== undefined));
  if (!safeMetrics.length) {
    return '';
  }
  return `
    <div class="chart-tooltip-metrics">
      ${safeMetrics
        .map((item) => {
          const tone = tooltipToneClass(item.tone);
          return `
            <span class="${tone ? `is-${tone}` : ''}">
              <em>${escapeHtml(item.label || '')}</em>
              <strong>${escapeHtml(item.value ?? '--')}</strong>
              ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}
            </span>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderTooltipSections(sections = []) {
  const safeSections = sections.filter((section) => section && Array.isArray(section.rows) && section.rows.length);
  if (!safeSections.length) {
    return '';
  }
  return safeSections
    .map(
      (section) => `
        <div class="chart-tooltip-section">
          ${section.title ? `<b>${escapeHtml(section.title)}</b>` : ''}
          ${section.rows
            .map((row) => {
              const tone = tooltipToneClass(row.tone);
              return `
                <span class="chart-tooltip-row${tone ? ` is-${tone}` : ''}">
                  <em>${escapeHtml(row.label || '')}</em>
                  <strong>${escapeHtml(row.value ?? '')}</strong>
                  ${row.note ? `<small>${escapeHtml(row.note)}</small>` : ''}
                </span>
              `;
            })
            .join('')}
        </div>
      `
    )
    .join('');
}

function renderTooltipBadges(badges = []) {
  const safeBadges = badges.filter(Boolean);
  if (!safeBadges.length) {
    return '';
  }
  return `
    <div class="chart-tooltip-badges">
      ${safeBadges
        .map((badge) => {
          const item = typeof badge === 'string' ? { label: badge } : badge;
          const tone = tooltipToneClass(item.tone);
          return `<span class="${tone ? `is-${tone}` : ''}">${escapeHtml(item.label || '')}</span>`;
        })
        .join('')}
    </div>
  `;
}

function renderTooltipContent(data = {}) {
  const rows = [];
  if (data.eyebrow) {
    rows.push(`<span class="chart-tooltip-eyebrow">${escapeHtml(data.eyebrow)}</span>`);
  }
  if (data.title) {
    rows.push(`<strong class="chart-tooltip-title">${escapeHtml(data.title)}</strong>`);
  }
  if (data.value !== undefined && data.value !== null && data.value !== '') {
    rows.push(`<span class="chart-tooltip-value">${escapeHtml(data.value)}</span>`);
  }
  if (Array.isArray(data.metrics)) {
    rows.push(renderTooltipMetricGrid(data.metrics));
  }
  if (data.definition) {
    rows.push(`<span class="chart-tooltip-definition">${escapeHtml(data.definition)}</span>`);
  }
  if (data.compare) {
    rows.push(`<span class="chart-tooltip-compare">${escapeHtml(data.compare)}</span>`);
  }
  if (Array.isArray(data.sections)) {
    rows.push(renderTooltipSections(data.sections));
  }
  if (Array.isArray(data.badges)) {
    rows.push(renderTooltipBadges(data.badges));
  }
  if (data.extra) {
    rows.push(`<span class="chart-tooltip-extra">${escapeHtml(data.extra)}</span>`);
  }
  return rows.filter(Boolean).join('');
}

function positionTooltip(trigger, tooltip) {
  const rect = trigger.getBoundingClientRect();
  const margin = 10;
  tooltip.hidden = false;
  tooltip.style.visibility = 'hidden';
  tooltip.style.left = '0px';
  tooltip.style.top = '0px';

  const tipRect = tooltip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  let top = rect.top - tipRect.height - margin;

  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  if (top < margin) {
    top = rect.bottom + margin;
  }

  tooltip.style.left = `${left + window.scrollX}px`;
  tooltip.style.top = `${top + window.scrollY}px`;
  tooltip.style.visibility = 'visible';
}

export function hideTooltip() {
  if (!tooltipEl) {
    return;
  }
  tooltipEl.hidden = true;
  activeTrigger = null;
}

export function showTooltip(trigger, data) {
  if (!trigger || !data) {
    return;
  }
  const tooltip = ensureTooltip();
  tooltip.innerHTML = renderTooltipContent(data);
  activeTrigger = trigger;
  positionTooltip(trigger, tooltip);
}

export function bindTooltipTriggers(root = document) {
  root.querySelectorAll('[data-tooltip]').forEach((element) => {
    if (element.dataset.tooltipBound === 'true') {
      return;
    }
    element.dataset.tooltipBound = 'true';
    element.addEventListener('mouseenter', () => {
      try {
        showTooltip(element, JSON.parse(element.dataset.tooltip));
      } catch {
        showTooltip(element, { title: element.dataset.tooltip });
      }
    });
    element.addEventListener('mouseleave', hideTooltip);
    element.addEventListener('focus', () => {
      try {
        showTooltip(element, JSON.parse(element.dataset.tooltip));
      } catch {
        showTooltip(element, { title: element.dataset.tooltip });
      }
    });
    element.addEventListener('blur', hideTooltip);
  });
}

export function initTooltipSystem() {
  if (window.__dashboardTooltipInit) {
    return;
  }
  window.__dashboardTooltipInit = true;
  window.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideTooltip();
    }
  });
}
