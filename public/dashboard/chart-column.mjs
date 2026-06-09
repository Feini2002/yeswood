import { escapeHtml, tooltipDataAttr } from './tooltip.mjs';
import { renderEmptyState } from './empty-state.mjs';

function formatMonthLabel(label) {
  return label.includes('-') ? label.slice(5) : label;
}

export function renderColumnChart(container, items = [], options = {}) {
  if (!container) {
    return;
  }

  const total = options.total || 0;
  const emptyReason = options.emptyReason || 'none';
  const emptyHint = options.emptyHint || '';

  if (!items.length) {
    container.innerHTML = renderEmptyState({
      title: emptyReason === 'field' ? '字段不足，暂无法统计' : '暂无数据',
      description: emptyHint || '当前筛选条件下没有可展示的月度记录。',
      compact: true,
    });
    return;
  }

  const max = Math.max(...items.map((item) => item.value), 1);
  const mid = Math.round(max / 2);
  const axis = [max, mid, 0];

  container.innerHTML = `
    <div class="column-chart-shell">
      <div class="column-chart-axis" aria-hidden="true">
        ${axis.map((value) => `<span>${value}</span>`).join('')}
      </div>
      <div class="column-chart-body">
        ${items
          .map((item, index) => {
            const height = Math.max(12, Math.round((item.value / max) * 176));
            const share = total ? Math.round((item.value / total) * 100) : 0;
            const tooltip = {
              title: item.label,
              value: `${item.value} 项`,
              definition: options.definition || '按进店月份聚合的项目数量。',
              compare: total ? `占团队 ${share}%` : '',
            };
            return `
              <div class="column column-interactive" style="--column-delay:${index * 40}ms">
                <button
                  type="button"
                  class="column-hit"
                  ${tooltipDataAttr(tooltip)}
                  aria-label="${escapeHtml(`${item.label}：${item.value} 项`)}"
                >
                  <span class="column-value">${item.value}</span>
                  <span class="column-bar" style="height:${height}px"></span>
                </button>
                <span>${escapeHtml(formatMonthLabel(item.label))}</span>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

export function renderColumnChartMarkup(items, options = {}) {
  const host = document.createElement('div');
  renderColumnChart(host, items, options);
  return host.innerHTML;
}
