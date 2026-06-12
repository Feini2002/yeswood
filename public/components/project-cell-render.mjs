import { escapeHtml, displayOrDash } from '../lib/format.mjs';
import { isPausedOrCanceledProject, isProjectWorkflowClosed, readProjectStage, projectStageDisplayItems } from '../domain/project-workflow.mjs';
import {
  projectFieldGapReminders,
  resolveProjectKeyDateReminders,
  isEmptyProjectReminder,
  projectReminderTrackLabel,
} from '../domain/project-reminders.mjs';

export function renderProjectFieldGapReminder(project) {
  const reminders = projectFieldGapReminders(project);
  if (!reminders.length) {
    return '';
  }

  return `
    <div class="project-detail-field-gap-reminder" role="note">
      <strong>字段缺失提醒</strong>
      <div>
        ${reminders
          .map(
            (item) => `
              <span>
                <b>${escapeHtml(item.title)}</b>
                <em>${escapeHtml(item.missingFields.join('、'))}</em>
                <small>${escapeHtml([item.track, item.owner ? `建议补录人：${item.owner}` : '', item.basis].filter(Boolean).join(' · '))}</small>
              </span>
            `
          )
          .join('')}
      </div>
    </div>
  `;
}

export function renderProjectStageStack(project) {
  const items = projectStageDisplayItems(project);
  if (!items.length) {
    return escapeHtml(displayOrDash(readProjectStage(project)));
  }
  return `
    <span class="project-stage-stack">
      ${items
        .map(
          (item) => `
            <span class="project-stage-chip ${escapeHtml(item.className)}">
              <b>${escapeHtml(item.track)}</b>
              <em>${escapeHtml(item.value)}</em>
            </span>
          `
        )
        .join('')}
    </span>
  `;
}

export function renderProjectKeyDateStack(project, title = '') {
  if (isProjectWorkflowClosed(project) && !isPausedOrCanceledProject(project)) {
    return escapeHtml('--');
  }

  const reminders = resolveProjectKeyDateReminders(project).filter((item) => !isEmptyProjectReminder(item));
  if (!reminders.length) {
    return escapeHtml('--');
  }
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `
    <span class="project-key-date-stack"${titleAttr}>
      ${reminders
        .map((keyDate) => {
          const trackLabel = projectReminderTrackLabel(keyDate);
          const dateText = keyDate.missing ? keyDate.message || '待填' : keyDate.formatted === '--' ? keyDate.message || '待填' : keyDate.formatted;
          const missingClass = keyDate.missing ? ' is-missing' : '';
          if (keyDate.missing) {
            return `
              <span class="project-key-date${missingClass}">
                <em>${escapeHtml(dateText)}</em>
              </span>
            `;
          }
          return `
            <span class="project-key-date${missingClass}">
              <small class="project-key-date-label">${escapeHtml(keyDate.label || trackLabel)}</small>
              <em>${escapeHtml(dateText)}</em>
            </span>
          `;
        })
        .join('')}
    </span>
  `;
}
