import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPublicAppHarness } from '../public/test-harness.mjs';

test('findProjectByReference prefers catalog summary over team completion ref', async () => {
  await loadPublicAppHarness();
  const { state } = await import('../public/lib/state.mjs');
  const {
    findProjectByReference,
    projectNeedsDetailFetch,
    projectDetailRichness,
  } = await import('../public/components/project-workbench.mjs');

  const catalogProject = {
    id: 'project-a',
    name: 'Project A',
    province: 'Zhejiang',
    rawFields: { hardProgress: { display: 'Full detail ready' } },
  };
  const sparseRef = {
    id: 'project-a',
    name: 'Project A',
    metrics: { floorPlan: { completed: true } },
  };

  state.allProjects = [catalogProject];
  const resolved = findProjectByReference({ projectId: 'project-a' }, [sparseRef]);
  assert.equal(resolved.province, 'Zhejiang');
  assert.ok(projectDetailRichness(catalogProject) > projectDetailRichness(sparseRef));
  assert.equal(projectNeedsDetailFetch(sparseRef), true);
  assert.equal(projectNeedsDetailFetch(catalogProject), false);
});

test('openProjectDetailByReference renders sparse refs immediately then enriches detail', async () => {
  let detailRequests = 0;
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      if (path.includes('id=project-a') && path.includes('view=full')) {
        detailRequests += 1;
        return {
          ok: true,
          json: async () => ({
            item: {
              id: 'project-a',
              name: 'Project A',
              province: 'Zhejiang',
              rawFields: {
                hardProgress: { display: 'Full detail ready', kind: 'text' },
                hardOwner: { display: 'Owner A', kind: 'text' },
              },
            },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });

  const { openProjectDetailByReference } = await import('../public/components/project-workbench.mjs');
  const sparseRef = {
    id: 'project-a',
    name: 'Project A',
    metrics: { floorPlan: { completed: true } },
  };

  const pending = openProjectDetailByReference(
    { projectId: 'project-a', projectName: 'Project A' },
    [sparseRef],
    { action: 'Review project', reason: 'Team work completion' }
  );
  assert.match(app.elements.projectDetailModalBody.innerHTML, /Project A/);
  assert.doesNotMatch(app.elements.projectDetailModalBody.innerHTML, /project-detail-loading/);
  assert.equal(detailRequests, 0);

  await pending;
  assert.equal(detailRequests, 1);
  assert.match(app.elements.projectDetailModalBody.innerHTML, /Project A/);
  assert.match(app.elements.projectDetailModalBody.innerHTML, /Zhejiang/);
  assert.doesNotMatch(app.elements.projectDetailModalBody.innerHTML, /project-detail-loading/);
});

test('openProjectDetailByReference prefers team completion detail cache over sparse source rows', async () => {
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      if (path.includes('id=project-a') && path.includes('view=full')) {
        return {
          ok: true,
          json: async () => ({
            item: {
              id: 'project-a',
              name: 'Project A',
              province: 'Full Province',
              rawFields: { fullField: { display: 'Full detail ready', kind: 'text' } },
            },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });

  app.state.teamWorkCompletion = {
    projectDetailsById: {
      'project-a': {
        id: 'project-a',
        name: 'Project A',
        province: 'Cached Province',
        rawFields: { cachedField: { display: 'Cached detail ready', kind: 'text' } },
      },
    },
  };

  const { openProjectDetailByReference } = await import('../public/components/project-workbench.mjs');
  const sparseRef = {
    id: 'project-a',
    name: 'Project A',
    metrics: { floorPlan: { completed: true } },
  };

  const pending = openProjectDetailByReference({ projectId: 'project-a' }, [sparseRef]);
  assert.match(app.elements.projectDetailModalBody.innerHTML, /Cached Province/);
  assert.doesNotMatch(app.elements.projectDetailModalBody.innerHTML, /project-detail-loading/);
  await pending;
});

test('openProjectDetailByReference accepts full detail returned by record meta id', async () => {
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      if (path.includes('id=record-a') && path.includes('view=full')) {
        return {
          ok: true,
          json: async () => ({
            item: {
              id: 'project-a',
              recordMeta: { id: 'record-a', lastModifiedTime: '2026-06-11T00:00:00.000Z' },
              name: 'Project A',
              province: 'Full Province',
              rawFields: { hardProgress: { display: 'Full detail ready', kind: 'text' } },
            },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });

  const { openProjectDetailByReference } = await import('../public/components/project-workbench.mjs');
  const sparseRef = {
    id: 'record-a',
    name: 'Project A',
    metrics: { floorPlan: { completed: true } },
  };

  await openProjectDetailByReference({ projectId: 'record-a' }, [sparseRef]);

  assert.equal(app.state.selectedProjectId, 'record-a');
  assert.match(app.elements.projectDetailModalBody.innerHTML, /Full Province/);
  assert.doesNotMatch(app.elements.projectDetailModalBody.innerHTML, /project-detail-loading/);
});

test('openProjectDetailByReference renders catalog summary immediately when available', async () => {
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      if (path.includes('id=project-a') && path.includes('view=full')) {
        return {
          ok: true,
          json: async () => ({
            item: {
              id: 'project-a',
              name: 'Project A',
              province: 'Zhejiang',
              rawFields: { hardProgress: { display: 'Full detail ready', kind: 'text' } },
            },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });

  app.state.allProjects = [
    {
      id: 'project-a',
      name: 'Project A',
      province: 'Zhejiang',
      rawFields: { hardProgress: { display: 'Catalog summary ready' } },
    },
  ];

  const { openProjectDetailByReference } = await import('../public/components/project-workbench.mjs');
  const sparseRef = {
    id: 'project-a',
    name: 'Project A',
    metrics: { floorPlan: { completed: true } },
  };

  await openProjectDetailByReference({ projectId: 'project-a' }, [sparseRef]);
  assert.match(app.elements.projectDetailModalBody.innerHTML, /Zhejiang/);
  assert.doesNotMatch(app.elements.projectDetailModalBody.innerHTML, /project-detail-loading/);
});
