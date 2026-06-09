import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

test('Chinese development launcher keeps local hot reload enabled', async () => {
  const [bat, ps1] = await Promise.all([
    readFile(join(process.cwd(), '开发模式-启动看板.bat'), 'utf8'),
    readFile(join(process.cwd(), 'scripts', 'launch-dev-dashboard.ps1'), 'utf8'),
  ]);
  const launcher = `${bat}\n${ps1}`;

  assert.match(bat, /set "PORT=4200"/);
  assert.match(bat, /if not exist "\.\\scripts\\launch-dev-dashboard\.ps1"/);
  assert.match(bat, /health check \^> open browser \^> warm data/);
  assert.match(launcher, /HOST=127\.0\.0\.1|'127\.0\.0\.1'/);
  assert.match(launcher, /DASHBOARD_DEV_RELOAD=1|'1'/);
  assert.match(launcher, /DASHBOARD_AUTO_UPDATE_ENABLED=1|'1'/);
  assert.match(launcher, /Start-Sleep -Seconds 1/);
  assert.match(launcher, /Start-Process ['"]http:\/\/localhost:(?:%PORT%|\$Port)/);
  assert.match(ps1, /Server PID/);
  assert.match(ps1, /Logs:/);
});

test('development launcher opens the browser after health and before data warmup', async () => {
  const ps1 = await readFile(join(process.cwd(), 'scripts', 'launch-dev-dashboard.ps1'), 'utf8');

  assert.match(ps1, /function Wait-DashboardHealth/);
  assert.match(ps1, /function Warm-DashboardData/);
  assert.match(ps1, /Wait-DashboardHealth -ListenPort \$Port -TimeoutSec \d+/);
  assert.match(ps1, /Warm-DashboardData -ListenPort \$Port -TimeoutSec \d+/);

  const healthIndex = ps1.indexOf('Wait-DashboardHealth -ListenPort $Port');
  const browserIndex = ps1.indexOf('Start-Process "http://localhost:$Port/"');
  const warmIndex = ps1.indexOf('Warm-DashboardData -ListenPort $Port');

  assert.notEqual(healthIndex, -1);
  assert.notEqual(browserIndex, -1);
  assert.notEqual(warmIndex, -1);
  assert.ok(healthIndex < browserIndex, 'browser must wait for server health');
  assert.ok(browserIndex < warmIndex, 'data warmup must not block opening the browser');
  assert.doesNotMatch(
    ps1,
    /Wait-DashboardReady -ListenPort \$Port -TimeoutSec 120\s+Start-Process "http:\/\/localhost:\$Port\/"/,
  );
});

test('Chinese intranet launcher serves a copied snapshot without watch or reload', async () => {
  const [bat, ps1] = await Promise.all([
    readFile(join(process.cwd(), '内网展示-启动看板.bat'), 'utf8'),
    readFile(join(process.cwd(), 'scripts', 'launch-intranet-dashboard.ps1'), 'utf8'),
  ]);
  const launcher = `${bat}\n${ps1}`;

  assert.match(bat, /set "PORT=4300"/);
  assert.match(bat, /if not exist "\.\\scripts\\launch-intranet-dashboard\.ps1"/);
  assert.match(bat, /launch-intranet-dashboard\.ps1/);
  assert.match(launcher, /HOST=0\.0\.0\.0|'0\.0\.0\.0'/);
  assert.match(launcher, /SNAPSHOT_DIR\s*=\s*.*\.runtime\\intranet-dashboard/);
  assert.match(launcher, /robocopy \$Source \$Destination/);
  assert.match(launcher, /Copy-SnapshotDirectory .*public.*SNAPSHOT_PUBLIC/);
  assert.match(launcher, /Copy-SnapshotDirectory .*data.*SNAPSHOT_DATA/);
  assert.match(launcher, /PUBLIC_DIR=.*SNAPSHOT_PUBLIC/);
  assert.match(launcher, /LOCAL_CACHE_FILE=.*dashboard-cache\.json/);
  assert.match(launcher, /LOCAL_DATABASE_FILE=.*app\.sqlite/);
  assert.match(launcher, /PERSONNEL_DATABASE_FILE=.*personnel-database\.json/);
  assert.match(launcher, /DASHBOARD_DEV_RELOAD=0|'0'/);
  assert.match(launcher, /DASHBOARD_AUTO_UPDATE_ENABLED=0|'0'/);
  assert.match(launcher, /DASHBOARD_SYNC_ENABLED=0|'0'/);
  assert.match(ps1, /Wait-DashboardReady/);
  assert.match(ps1, /Server PID/);
  assert.match(ps1, /Logs:/);
  assert.doesNotMatch(launcher, /--watch/);
  assert.doesNotMatch(bat, /"%NODE_EXE%" "%APP_ENTRY%"/);
});

test('Chinese intranet launcher prints a copyable LAN url and avoids proxy benchmark IPs', async () => {
  const [bat, ps1] = await Promise.all([
    readFile(join(process.cwd(), '内网展示-启动看板.bat'), 'utf8'),
    readFile(join(process.cwd(), 'scripts', 'launch-intranet-dashboard.ps1'), 'utf8'),
  ]);
  const launcher = `${bat}\n${ps1}`;

  assert.match(launcher, /ipconfig/);
  assert.match(launcher, /Get-LanIp|:consider_ip/);
  assert.match(launcher, /198\\?\.18\\?\./);
  assert.match(launcher, /COPY THIS URL: http:\/\/.*LAN_IP.*:.*PORT/);
  assert.match(launcher, /Start-Process "http:\/\/localhost:\$Port\/"/);
});

test('Chinese cleanup script removes the intranet snapshot directory only', async () => {
  const bat = await readFile(join(process.cwd(), '清理内网展示快照.bat'), 'utf8');

  assert.match(bat, /set "SNAPSHOT_DIR=%CD%\\.runtime\\intranet-dashboard"/);
  assert.match(bat, /rmdir \/S \/Q "%SNAPSHOT_DIR%"/);
  assert.doesNotMatch(bat, /rmdir \/S \/Q "%CD%"/);
});

test('dashboard port documentation and defaults match development launcher', async () => {
  const [bat, env, config, readme] = await Promise.all([
    readFile(join(process.cwd(), '开发模式-启动看板.bat'), 'utf8'),
    readFile(join(process.cwd(), '.env'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'backend', 'config.mjs'), 'utf8'),
    readFile(join(process.cwd(), 'README.md'), 'utf8'),
  ]);

  assert.match(bat, /set "PORT=4200"/);
  assert.match(env, /^PORT=4200$/m);
  assert.match(config, /readNumberEnv\('PORT', 4200\)/);
  assert.match(readme, /http:\/\/localhost:4200/);
  assert.match(readme, /开发模式-启动看板\.bat/);
  assert.match(readme, /内网展示-启动看板\.bat/);
  assert.match(readme, /清理内网展示快照\.bat/);
  assert.doesNotMatch(readme, /localhost:4173/);
});
