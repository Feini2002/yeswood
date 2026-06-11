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
    name: '宁波完成店',
    province: '浙江',
    rawFields: { 硬装项目进度: { display: '平面躺平' } },
  };
  const sparseRef = {
    id: 'project-a',
    name: '宁波完成店',
    metrics: { floorPlan: { completed: true } },
  };

  state.allProjects = [catalogProject];
  const resolved = findProjectByReference({ projectId: 'project-a' }, [sparseRef]);
  assert.equal(resolved.province, '浙江');
  assert.ok(projectDetailRichness(catalogProject) > projectDetailRichness(sparseRef));
  assert.equal(projectNeedsDetailFetch(sparseRef), true);
  assert.equal(projectNeedsDetailFetch(catalogProject), false);
});

test('openProjectDetailByReference shows loading for sparse refs then renders full detail', async () => {
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
              name: '宁波完成店',
              province: '浙江',
              rawFields: {
                硬装项目进度: { display: '平面躺平', kind: 'text' },
                硬装负责人: { display: '苏佳蕾', kind: 'text' },
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
    name: '宁波完成店',
    metrics: { floorPlan: { completed: true } },
  };

  const pending = openProjectDetailByReference(
    { projectId: 'project-a', projectName: '宁波完成店' },
    [sparseRef],
    { action: '平面方案躺平完成量', reason: '团队工作完成情况' }
  );
  assert.match(app.elements.projectDetailModalBody.innerHTML, /正在加载项目明细/);
  assert.doesNotMatch(app.elements.projectDetailModalBody.innerHTML, /detail-kv-empty/);

  await pending;
  assert.equal(detailRequests, 1);
  assert.match(app.elements.projectDetailModalBody.innerHTML, /宁波完成店/);
  assert.match(app.elements.projectDetailModalBody.innerHTML, /浙江/);
  assert.match(app.elements.projectDetailModalBody.innerHTML, /平面躺平/);
  assert.doesNotMatch(app.elements.projectDetailModalBody.innerHTML, /正在加载项目明细/);
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
              name: '宁波完成店',
              province: '浙江',
              rawFields: { 硬装项目进度: { display: '平面躺平', kind: 'text' } },
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
      name: '宁波完成店',
      province: '浙江',
      rawFields: { 硬装项目进度: { display: '平面躺平' } },
    },
  ];

  const { openProjectDetailByReference } = await import('../public/components/project-workbench.mjs');
  const sparseRef = {
    id: 'project-a',
    name: '宁波完成店',
    metrics: { floorPlan: { completed: true } },
  };

  await openProjectDetailByReference({ projectId: 'project-a' }, [sparseRef]);
  assert.match(app.elements.projectDetailModalBody.innerHTML, /浙江/);
  assert.match(app.elements.projectDetailModalBody.innerHTML, /平面躺平/);
  assert.doesNotMatch(app.elements.projectDetailModalBody.innerHTML, /正在加载项目明细/);
});
