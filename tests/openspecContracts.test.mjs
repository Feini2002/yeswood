import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

const requiredSpecs = [
  'frontend-architecture',
  'security-boundary',
  'data-authority',
  'field-mapping',
  'dashboard-metrics',
  'personnel-responsibility-routing',
  'hard-decoration-deadlines',
];

test('required OpenSpec baseline specs exist after contract seeding', async () => {
  for (const name of requiredSpecs) {
    await access(join(root, 'openspec', 'specs', name, 'spec.md'));
  }
});

test('OpenSpec baseline specs use normative requirements and scenarios', async () => {
  for (const name of requiredSpecs) {
    const spec = await readFile(join(root, 'openspec', 'specs', name, 'spec.md'), 'utf8');
    assert.match(spec, /^### Requirement:/m, `${name} has requirements`);
    assert.match(spec, /^#### Scenario:/m, `${name} has scenarios`);
    assert.match(spec, /\bSHALL\b|\bMUST\b/, `${name} uses normative language`);
  }
});
