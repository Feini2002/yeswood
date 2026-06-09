import { escapeHtml, tooltipDataAttr } from './tooltip.mjs';

export function renderInsightCard({
  label,
  value,
  insight = '',
  tone = 'teal',
  alert = false,
  featured = false,
  tooltip = null,
  key = '',
  drillable = false,
  drillFilter = null,
} = {}) {
  const tooltipAttr = tooltip ? tooltipDataAttr(tooltip) : '';
  const drillAttr =
    drillable && drillFilter
      ? ` data-drill="${JSON.stringify(drillFilter).replace(/"/g, '&quot;')}"`
      : '';
  const classes = ['insight-card'];
  if (alert) classes.push('is-alert');
  if (featured) classes.push('is-featured');
  if (drillable) classes.push('is-drillable');
  return `
    <article class="${classes.join(' ')}" data-tone="${escapeHtml(tone)}" data-insight-key="${escapeHtml(key)}"${tooltipAttr}${drillAttr} tabindex="0">
      <span class="insight-card-label">${escapeHtml(label)}</span>
      <strong class="insight-card-value">${escapeHtml(value)}</strong>
      ${insight ? `<p class="insight-footer">${escapeHtml(insight)}</p>` : ''}
    </article>
  `;
}

export function renderInsightCards(items = []) {
  return items.map((item) => renderInsightCard(item)).join('');
}

export function renderPanelInsight(text = '') {
  if (!text) {
    return '';
  }
  return `<p class="panel-insight">${escapeHtml(text)}</p>`;
}
