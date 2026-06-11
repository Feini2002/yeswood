/**
 * Slim project payloads for list/overview APIs. Detail views can request view=full or ?id=.
 */

export function summarizeRawFields(rawFields = {}) {
  const summary = {};
  for (const [key, cell] of Object.entries(rawFields)) {
    const display = String(cell?.display ?? '').trim();
    if (!display) {
      continue;
    }
    summary[key] = {
      display,
      kind: cell?.kind || 'text',
    };
  }
  return summary;
}

export function summarizeProject(project = {}) {
  if (!project || typeof project !== 'object') {
    return project;
  }
  return {
    ...project,
    recordMeta: project.recordMeta
      ? {
          id: project.recordMeta.id,
          lastModifiedTime: project.recordMeta.lastModifiedTime,
        }
      : undefined,
    rawFields: summarizeRawFields(project.rawFields),
  };
}

export function summarizeProjects(projects = []) {
  return Array.isArray(projects) ? projects.map(summarizeProject) : [];
}

export function findProjectInSnapshot(projects = [], projectId = '') {
  const needle = String(projectId || '').trim();
  if (!needle) {
    return null;
  }
  return (
    projects.find((project) => project.id === needle || project.recordMeta?.id === needle) || null
  );
}
