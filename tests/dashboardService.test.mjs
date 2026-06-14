import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const rootDir = process.cwd();

function runPowerShell(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(rootDir, 'scripts', 'dashboard-service.ps1'), ...args],
      {
        cwd: rootDir,
        env: { ...process.env, ...options.env },
        windowsHide: true,
      }
    );
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs || 15_000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test('package scripts route dashboard development through the service manager', async () => {
  const packageJson = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts.dev, 'powershell -ExecutionPolicy Bypass -File ./scripts/dashboard-service.ps1 start');
  assert.equal(
    packageJson.scripts['dev:restart'],
    'powershell -ExecutionPolicy Bypass -File ./scripts/dashboard-service.ps1 restart -Force'
  );
  assert.equal(
    packageJson.scripts['dev:stop'],
    'powershell -ExecutionPolicy Bypass -File ./scripts/dashboard-service.ps1 stop -Force'
  );
  assert.equal(packageJson.scripts['dev:status'], 'powershell -ExecutionPolicy Bypass -File ./scripts/dashboard-service.ps1 status');
  assert.equal(packageJson.scripts['dev:raw'], 'node ./src/backend/server.mjs');
  assert.equal(packageJson.scripts.test, 'node --test');
  assert.notEqual(packageJson.scripts.dev, 'node ./src/backend/server.mjs');
});

test('dashboard service manager exposes required commands, state fields, and diagnostics', async () => {
  const script = await readFile(join(rootDir, 'scripts', 'dashboard-service.ps1'), 'utf8');

  assert.match(script, /\[ValidateSet\('start', 'stop', 'restart', 'status', 'open', 'doctor'\)\]/);
  assert.match(script, /\[int\]\$Port = 4200/);
  assert.match(script, /\[switch\]\$Force/);
  assert.match(script, /\[switch\]\$Foreground/);
  assert.match(script, /dashboard-service\.json/);
  assert.match(script, /yeswood-dashboard/);
  assert.match(script, /nodePath/);
  assert.match(script, /entryPath/);
  assert.match(script, /startedAt/);
  assert.match(script, /warmupJobId/);
  assert.match(script, /\/api\/health/);
  assert.match(script, /\/api\/runtime/);
  assert.match(script, /\/api\/dashboard-warmup\?scope=boot/);
  assert.match(script, /Wait-DashboardBootWarmup -ListenPort \$statePort -TimeoutSec 45[\s\S]*Open-ServiceUrl -OpenUrl \$stateUrl/);
  assert.match(script, /Open-ServiceUrl -OpenUrl \$Url[\s\S]*Start-WarmupProcess -ListenPort \$Port/);
  assert.match(script, /Get-NetTCPConnection/);
  assert.match(script, /Get-CimInstance Win32_Process/);
  assert.match(script, /wrong-port/);
  assert.match(script, /current/);
  assert.match(script, /stale/);
  assert.match(script, /Get-Content .* -Tail 20/);
});

test('dashboard service manager hardens mutation with a lock and atomic state writes', async () => {
  const script = await readFile(join(rootDir, 'scripts', 'dashboard-service.ps1'), 'utf8');

  assert.match(script, /function New-ServiceLock/);
  assert.match(script, /function Invoke-WithServiceLock/);
  assert.match(script, /\[System\.IO\.FileShare\]::None/);
  assert.match(script, /dashboard-service\.lock/);
  assert.match(script, /dashboard-service\.json\.tmp-/);
  assert.match(script, /Move-Item .* -Force/);
  assert.match(script, /Validate-ServiceState/);
  assert.match(script, /Ignoring service state/i);
  assert.match(script, /Invoke-WithServiceLock \{[\s\S]*Start-DashboardService/);
  assert.match(script, /Invoke-WithServiceLock \{[\s\S]*Stop-RegisteredService/);
});

test('dashboard service status exits cleanly when no service is registered', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('dashboard-service.ps1 is a Windows PowerShell service manager');
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'yeswood-service-status-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const statePath = join(tempDir, 'dashboard-service.json');

  const result = await runPowerShell(['status', '-Port', '65534'], {
    env: {
      YESWOOD_SERVICE_STATE_FILE: statePath,
      YESWOOD_SKIP_OPEN: '1',
    },
  });

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /No service state|no service state/i);
});

test('dashboard service status ignores state that belongs to another app or root', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('dashboard-service.ps1 is a Windows PowerShell service manager');
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'yeswood-service-foreign-state-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const statePath = join(tempDir, 'dashboard-service.json');
  await import('node:fs/promises').then(({ writeFile }) =>
    writeFile(
      statePath,
      JSON.stringify(
        {
          app: 'not-yeswood-dashboard',
          root: 'C:\\somewhere\\else',
          pid: process.pid,
          port: 65534,
          url: 'http://localhost:65534/',
        },
        null,
        2
      )
    )
  );

  const result = await runPowerShell(['status', '-Port', '65534'], {
    env: {
      YESWOOD_SERVICE_STATE_FILE: statePath,
      YESWOOD_SKIP_OPEN: '1',
    },
  });

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Ignoring service state/i);
  assert.doesNotMatch(result.stdout, /State PID alive:\s*True/i);
});
