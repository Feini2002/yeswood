/**
 * Breaks circular imports between workbench, detail modal, and drill modal.
 * app.js registers render callbacks once modules are loaded.
 */

const callbacks = {
  renderProjectWorkbench: null,
  renderDrillProjectRows: null,
};

export function configureViewCoordinator(next = {}) {
  if (typeof next.renderProjectWorkbench === 'function') {
    callbacks.renderProjectWorkbench = next.renderProjectWorkbench;
  }
  if (typeof next.renderDrillProjectRows === 'function') {
    callbacks.renderDrillProjectRows = next.renderDrillProjectRows;
  }
}

export function refreshProjectWorkbenchAfterModal(projects = []) {
  callbacks.renderProjectWorkbench?.(projects);
}

export function refreshDrillRowsIfOpen() {
  callbacks.renderDrillProjectRows?.();
}
