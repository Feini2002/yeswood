import { escapeHtml, tooltipDataAttr } from './tooltip.mjs';
import { renderEmptyState } from './empty-state.mjs';

export function renderBarChart(container, items = [], options = {}) {
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = renderEmptyState({
      title: options.emptyTitle || '暂无数据',
      description: options.emptyDescription || '',
      actionHref: options.emptyActionHref || '',
      actionLabel: options.emptyActionLabel || '',
      compact: true,
    });
    return;
  }

  const max = Math.max(...items.map((item) => item.value), 1);
  const total = items.reduce((sum, item) => sum + item.value, 0);

  container.innerHTML = items
    .map((item, index) => {
      const width = Math.max(6, Math.round((item.value / max) * 100));
      const share = total ? Math.round((item.value / total) * 100) : 0;
      const tooltip = item.tooltip || {
        title: item.label,
        value: `${item.value} 项`,
        definition: options.definition || '按当前维度聚合的项目数量。',
        compare: total ? `占比 ${share}%` : '',
        extra: item.extra || '',
      };
      return `
        <div class="bar-row bar-row-interactive">
          <span class="bar-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
          <button
            type="button"
            class="bar-hit"
            ${tooltipDataAttr(tooltip)}
            aria-label="${escapeHtml(`${item.label}：${item.value}`)}"
          >
            <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
          </button>
          <span class="bar-value">${item.value}</span>
        </div>
      `;
    })
    .join('');
}
