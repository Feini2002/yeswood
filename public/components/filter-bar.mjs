import { state } from '../lib/state.mjs';
import { elements } from '../lib/dom.mjs';
import { escapeHtml } from '../lib/format.mjs';
import { FILTERABLE_PAGES, isHiddenFilterValue } from '../lib/constants.mjs';
import { currentPageId, parsePageHash } from '../lib/router.mjs';

export function filterControlsForPage() {
  return {
    searchInput: elements.searchInput,
    provinceFilter: elements.provinceFilter,
    businessTypeFilter: elements.businessTypeFilter,
    storeStatusFilter: elements.storeStatusFilter,
    statusFilter: elements.statusFilter,
  };
}


export function readDetailsRouteFilters(pageId = currentPageId()) {
  const hash = parsePageHash();
  if (pageId !== 'details' || hash.pageId !== 'details') {
    return {};
  }
  return {
    owner: hash.owner,
    teamProjectOwner: hash.teamProjectOwner,
    collaborator: hash.collaborator,
    collaborationDiscipline: hash.collaborationDiscipline,
    tier: hash.tier,
    metric: hash.metric,
    lifecycleStage: hash.lifecycleStage,
    delayed: hash.delayed,
    storeNature: hash.storeNature,
    excludePaused: hash.excludePaused,
    activeResponsibility: hash.activeResponsibility,
    profile: hash.profile,
    dashboardContext: hash.dashboardContext,
  };
}


export function detailsRouteFiltersChanged(previous = {}, next = {}) {
  return ['owner', 'teamProjectOwner', 'collaborator', 'collaborationDiscipline', 'tier', 'metric', 'lifecycleStage', 'delayed', 'storeNature', 'excludePaused', 'activeResponsibility', 'profile', 'dashboardContext'].some(
    (key) => (previous[key] || '') !== (next[key] || '')
  );
}


export function readActiveProjectFilters(pageId = currentPageId()) {
  const controls = filterControlsForPage(pageId);
  return {
    search: controls.searchInput?.value.trim() || '',
    province: controls.provinceFilter?.value || '',
    businessType: controls.businessTypeFilter?.value || '',
    storeStatus: controls.storeStatusFilter?.value || '',
    status: controls.statusFilter?.value || '',
    ...readDetailsRouteFilters(pageId),
  };
}


export function readFilters() {
  return readActiveProjectFilters();
}


export function toQuery(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}


export function visibleFilterValues(values) {
  return values.filter((value) => !isHiddenFilterValue(value));
}


export function setOptions(select, values) {
  if (!select) {
    return;
  }
  const current = select.value;
  const visibleValues = visibleFilterValues(values);
  select.innerHTML = `<option value="">全部</option>${visibleValues
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('')}`;
  if (visibleValues.includes(current)) {
    select.value = current;
  }
  renderFilterSelect(select);
}


export function projectFilterSelects() {
  return [
    elements.provinceFilter,
    elements.businessTypeFilter,
    elements.storeStatusFilter,
    elements.statusFilter,
  ].filter(Boolean);
}


export function enhanceTeamOwnerSelect() {
  const select = elements.teamOwnerSelect;
  if (!select) {
    return;
  }

  if (select.dataset.enhanced === 'true') {
    renderFilterSelect(select);
    return;
  }

  select.dataset.enhanced = 'true';
  select.classList.add('native-filter-select');
  select.closest('.team-owner-field')?.classList.add('is-enhanced');
  const shell = document.createElement('div');
  shell.className = 'filter-select-shell team-owner-select-shell';
  shell.dataset.filterSelectId = select.id;
  shell.innerHTML = `
    <button class="filter-select-button team-owner-select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span class="filter-select-value">请选择负责人</span>
      <span class="filter-select-chevron" aria-hidden="true"></span>
    </button>
    <div class="filter-select-menu team-owner-select-menu" role="listbox"></div>
  `;
  select.insertAdjacentElement('afterend', shell);
  renderFilterSelect(select);
}


export function enhanceOwnerReviewSelect(select, { shellClass = '', menuClass = '', defaultLabel = '全部' } = {}) {
  if (!select) {
    return;
  }

  if (select.dataset.enhanced === 'true') {
    renderFilterSelect(select);
    return;
  }

  select.dataset.enhanced = 'true';
  select.classList.add('native-filter-select');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.closest('label, .team-owner-field')?.classList.add('is-enhanced');
  const shell = document.createElement('div');
  shell.className = ['filter-select-shell', 'owner-review-select-shell', shellClass].filter(Boolean).join(' ');
  shell.dataset.filterSelectId = select.id;
  shell.innerHTML = `
    <button class="filter-select-button owner-review-select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span class="filter-select-value">${escapeHtml(defaultLabel)}</span>
      <span class="filter-select-chevron" aria-hidden="true"></span>
    </button>
    <div class="filter-select-menu owner-review-select-menu ${escapeHtml(menuClass)}" role="listbox"></div>
  `;
  select.insertAdjacentElement('afterend', shell);
  renderFilterSelect(select);
}


export function enhanceOwnerReviewSelects() {
  // Kept as a compatibility hook for old call sites; the visible owner entry now lives in #teamOwnerSelect.
}


export function enhanceOwnerReviewLoadFilterSelect() {
  enhanceOwnerReviewSelect(elements.ownerReviewLoadFilter, {
    shellClass: 'owner-review-load-filter-select-shell',
    menuClass: 'owner-review-load-filter-select-menu',
    defaultLabel: '全部成员',
  });
}


export function enhanceProjectFilters() {
  projectFilterSelects().forEach((select) => {
    if (select.dataset.enhanced === 'true') {
      renderFilterSelect(select);
      return;
    }

    select.dataset.enhanced = 'true';
    select.classList.add('native-filter-select');
    select.closest('label')?.classList.add('filter-select-field');
    const shell = document.createElement('div');
    shell.className = 'filter-select-shell';
    shell.dataset.filterSelectId = select.id;
    shell.innerHTML = `
      <button class="filter-select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
        <span class="filter-select-value">全部</span>
        <span class="filter-select-chevron" aria-hidden="true"></span>
      </button>
      <button class="filter-clear-button" type="button" data-filter-clear aria-label="清除筛选">×</button>
      <div class="filter-select-menu" role="listbox"></div>
    `;
    select.insertAdjacentElement('afterend', shell);
    renderFilterSelect(select);
  });
}


export function filterShellForSelect(select) {
  if (!select?.id) {
    return null;
  }
  const scope = select.closest('label, .team-owner-field');
  return scope?.querySelector(`.filter-select-shell[data-filter-select-id="${select.id}"]`) || null;
}


export function renderFilterSelect(select) {
  const shell = filterShellForSelect(select);
  if (!select || !shell) {
    return;
  }

  const selectedOption = select.selectedOptions[0] || select.options[0];
  const selectedText = selectedOption?.textContent || '全部';
  const hasValue = Boolean(select.value);
  const button = shell.querySelector('.filter-select-button');
  const value = shell.querySelector('.filter-select-value');
  const menu = shell.querySelector('.filter-select-menu');

  shell.classList.toggle('has-value', hasValue);
  value.textContent = selectedText;
  button.setAttribute('aria-label', `${select.closest('label')?.querySelector('span')?.textContent || '筛选'}：${selectedText}`);

  menu.innerHTML = Array.from(select.options)
    .map((option) => {
      const active = option.value === select.value;
      return `
        <button class="filter-select-option${active ? ' is-active' : ''}" type="button" role="option"
          aria-selected="${active ? 'true' : 'false'}" data-filter-value="${escapeHtml(option.value)}">
          <span>${escapeHtml(option.textContent || '')}</span>
        </button>
      `;
    })
    .join('');
}


export function renderAllFilterSelects() {
  projectFilterSelects().forEach(renderFilterSelect);
  renderFilterSelect(elements.teamOwnerSelect);
  renderFilterSelect(elements.ownerReviewLoadFilter);
}


export function closeFilterSelectMenus(except = null) {
  document.querySelectorAll('.filter-select-shell.is-open').forEach((shell) => {
    if (shell === except) {
      return;
    }
    shell.classList.remove('is-open');
    shell.querySelector('.filter-select-button')?.setAttribute('aria-expanded', 'false');
  });
}


export function setFilterSelectValue(shell, value) {
  if (!shell) {
    return;
  }
  const select = document.querySelector(`#${shell.dataset.filterSelectId}`);
  if (!select) {
    return;
  }
  select.value = value;
  renderFilterSelect(select);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}


export function handleFilterSelectClick(event) {
  const clear = event.target.closest('[data-filter-clear]');
  if (clear) {
    event.preventDefault();
    event.stopPropagation();
    const shell = clear.closest('.filter-select-shell');
    closeFilterSelectMenus();
    setFilterSelectValue(shell, '');
    return true;
  }

  const option = event.target.closest('.filter-select-option');
  if (option) {
    event.preventDefault();
    event.stopPropagation();
    const shell = option.closest('.filter-select-shell');
    setFilterSelectValue(shell, option.dataset.filterValue || '');
    closeFilterSelectMenus();
    return true;
  }

  const button = event.target.closest('.filter-select-button');
  if (button) {
    event.preventDefault();
    event.stopPropagation();
    const shell = button.closest('.filter-select-shell');
    const nextOpen = !shell.classList.contains('is-open');
    closeFilterSelectMenus(nextOpen ? shell : null);
    shell.classList.toggle('is-open', nextOpen);
    button.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    return true;
  }

  if (!event.target.closest('.filter-select-shell')) {
    closeFilterSelectMenus();
  }
  return false;
}


export function handleFilterSelectKeydown(event) {
  if (event.key === 'Escape') {
    closeFilterSelectMenus();
  }
}

