import { escapeHtml } from '../lib/format.mjs';

export function renderTeamHeroStat(label, value, { tone = '' } = {}) {
  return `
    <div class="team-hero-stat${tone ? ` is-${tone}` : ''}">
      <span class="team-hero-stat-label">${escapeHtml(label)}</span>
      <strong class="team-hero-stat-value">${escapeHtml(value)}</strong>
    </div>
  `;
}
