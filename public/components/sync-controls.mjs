import { state } from '../lib/state.mjs';
import { elements } from '../lib/dom.mjs';
import { currentPageId } from '../lib/router.mjs';

import {
  runtimeStore,
  setPageRefreshInFlight as setPageRefreshInFlightFlag,
  clearSyncMessageTimer,
  scheduleSyncMessageClear,
} from '../lib/runtime-flags.mjs';

export function isPageRefreshInFlight() {
  return runtimeStore.pageRefreshInFlight;
}

export function setPageRefreshInFlight(value) {
  setPageRefreshInFlightFlag(value);
}

export function isDashboardSyncEnabled() {
  return Boolean(state.snapshot?.dashboardSyncEnabled);
}


export function isDashboardAutoUpdateEnabled() {
  return state.snapshot?.dashboardAutoUpdateEnabled !== false;
}


export function setSyncMessage(message) {
  if (!elements.syncMessage) {
    return;
  }

  clearSyncMessageTimer();
  elements.syncMessage.textContent = message;
  if (message) {
    scheduleSyncMessageClear(() => {
      elements.syncMessage.textContent = '';
    }, 4200);
  }
}


export function updateSyncControl() {
  if (!elements.syncButton) {
    return;
  }

  const enabled = isDashboardSyncEnabled();
  elements.syncButton.disabled = !enabled;
  elements.syncButton.title = enabled ? '同步项目数据' : '同步入口未开启';
}


export function currentPageRefreshCopy(pageId = currentPageId()) {
  const target =
    {
      overview: '总览',
      franchise: '加盟看板',
      direct: '直营看板',
      teams: '小组页面',
      'owner-review': '小组页面',
      details: '项目页面',
      'developer-docs': '开发文档',
    }[pageId] || '当前页面';
  return {
    label: '刷新',
    busyLabel: '刷新中',
    title: `刷新${target}`,
    ariaLabel: `刷新${target}`,
  };
}


export function updatePageRefreshControl() {
  if (!elements.pageRefreshButton) {
    return;
  }
  const copy = currentPageRefreshCopy();
  elements.pageRefreshButton.disabled = runtimeStore.pageRefreshInFlight;
  elements.pageRefreshButton.textContent = runtimeStore.pageRefreshInFlight ? copy.busyLabel : copy.label;
  elements.pageRefreshButton.title = copy.title;
  elements.pageRefreshButton.setAttribute('aria-label', copy.ariaLabel);
}

