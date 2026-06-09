import { elements } from '../lib/dom.mjs';

export function openRulesInfoDialog() {
  const dialog = elements.rulesInfoDialog;
  if (!dialog || dialog.open) {
    return;
  }

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
    return;
  }

  dialog.setAttribute('open', '');
}

