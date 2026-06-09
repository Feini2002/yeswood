import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

test('Claude launcher supports current Claude Code environment variables', async () => {
  const launcher = await readFile(join(process.cwd(), 'Claude Code CLI.cmd'), 'utf8');

  assert.match(launcher, /ANTHROPIC_API_KEY/);
  assert.match(launcher, /ANTHROPIC_SMALL_FAST_MODEL/);
  assert.match(launcher, /if not defined ANTHROPIC_API_KEY if defined ANTHROPIC_AUTH_TOKEN/);
  assert.match(launcher, /if not defined ANTHROPIC_AUTH_TOKEN if defined ANTHROPIC_API_KEY/);
});

test('Claude launcher falls back to PATH and keeps failures visible', async () => {
  const launcher = await readFile(join(process.cwd(), 'Claude Code CLI.cmd'), 'utf8');

  assert.match(launcher, /where claude/);
  assert.match(launcher, /set "CLAUDE_EXIT_CODE=%ERRORLEVEL%"/);
  assert.match(launcher, /Claude Code exited with code %CLAUDE_EXIT_CODE%/);
  assert.match(launcher, /pause/);
  assert.match(launcher, /exit \/b %CLAUDE_EXIT_CODE%/);
});
