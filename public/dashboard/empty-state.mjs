import { escapeHtml, tooltipDataAttr } from './tooltip.mjs';

export function renderEmptyState({
  title = '暂无数据',
  description = '',
  actionHref = '',
  actionLabel = '',
  compact = false,
} = {}) {
  const action = actionHref
    ? `<a class="empty-state-action" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel || '查看详情')}</a>`
    : '';
  return `
    <div class="empty-state${compact ? ' is-compact' : ''}">
      <span class="empty-state-icon" aria-hidden="true">—</span>
      <strong>${escapeHtml(title)}</strong>
      ${description ? `<p>${escapeHtml(description)}</p>` : ''}
      ${action}
    </div>
  `;
}

export function renderRiskList(container, items = [], options = {}) {
  if (!container) {
    return;
  }

  const totalEl = options.totalElement;
  if (totalEl) {
    totalEl.textContent = `${items.length} 项`;
  }

  if (!items.length) {
    container.innerHTML = renderEmptyState({
      title: '暂无延期或高风险项目',
      description: '团队风险面相对可控，可继续按节点推进。',
      compact: true,
    });
    return;
  }

  container.innerHTML = items
    .map((project) => {
      const responsibilityDelayed =
        project.responsibilityDelayed !== undefined ? Boolean(project.responsibilityDelayed) : Boolean(project.isDelayed);
      const tooltip = {
        title: project.name,
        value: responsibilityDelayed ? '延期' : project.riskLevel,
        definition: `进度 ${project.progress ?? 0}% · ${project.businessType || '—'} · ${project.storeStatus || '—'}`,
        compare: project.riskNotes || '暂无风险说明',
        extra: `${project.ownerDisplay || project.owner} · ${project.province}`,
      };
      return `
        <button
          type="button"
          class="risk-item risk-item-interactive"
          data-project-id="${escapeHtml(project.id)}"
          data-project-name="${escapeHtml(project.name)}"
          ${tooltipDataAttr(tooltip)}
        >
          <div>
            <strong title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</strong>
            <span>${escapeHtml(project.ownerDisplay || project.owner)} · ${escapeHtml(project.province)} · ${escapeHtml(project.status)} · ${escapeHtml(
        options.formatDate ? options.formatDate(project.dueDate) : project.dueDate || '--'
      )}</span>
          </div>
          <span class="pill ${escapeHtml(responsibilityDelayed ? 'delay' : options.riskClass ? options.riskClass(project.riskLevel) : 'low')}">${responsibilityDelayed ? '延期' : escapeHtml(project.riskLevel)}</span>
          <span class="risk-item-chevron" aria-hidden="true">›</span>
        </button>
      `;
    })
    .join('');
}
