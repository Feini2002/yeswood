import { state } from '../lib/state.mjs';
import { elements } from '../lib/dom.mjs';

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


export function updatePageRefreshControl() {
  if (!elements.pageRefreshButton) {
    return;
  }
  elements.pageRefreshButton.disabled = runtimeStore.pageRefreshInFlight;
  elements.pageRefreshButton.textContent = runtimeStore.pageRefreshInFlight ? '重新加载中' : '刷新';
  elements.pageRefreshButton.title = '整页刷新总览';
  elements.pageRefreshButton.setAttribute('aria-label', '整页刷新总览');
}

