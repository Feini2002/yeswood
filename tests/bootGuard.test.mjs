import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

test('index boots app through a guard that can render module load errors', async () => {
  const html = await readFile(join(process.cwd(), 'public', 'index.html'), 'utf8');
  const boot = await readFile(join(process.cwd(), 'public', 'boot.js'), 'utf8');

  assert.match(html, /<script src="\/boot\.js" type="module"><\/script>/);
  assert.doesNotMatch(html, /<script src="\/app\.js" type="module"><\/script>/);
  assert.match(boot, /addEventListener\('error'/);
  assert.match(boot, /addEventListener\('unhandledrejection'/);
  assert.match(boot, /import\(['"]\.\/app\.js['"]\)/);
  assert.match(boot, /dashboard-boot-error/);
});
