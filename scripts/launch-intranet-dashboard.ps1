#Requires -Version 5.1
param(
  [int]$Port = 4300,
  [string]$AppEntry = '.\src\backend\server.mjs'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$SNAPSHOT_DIR = Join-Path $root '.runtime\intranet-dashboard'
$SNAPSHOT_PUBLIC = Join-Path $SNAPSHOT_DIR 'public'
$SNAPSHOT_DATA = Join-Path $SNAPSHOT_DIR 'data'

$env:PORT="$Port"
$env:HOST='0.0.0.0'
$env:PUBLIC_DIR=$SNAPSHOT_PUBLIC
$env:DATA_DIR=$SNAPSHOT_DATA
$env:PRECOMPUTE_DIR=(Join-Path $SNAPSHOT_DATA 'precomputed')
$env:LOCAL_CACHE_FILE=(Join-Path $SNAPSHOT_DATA 'dashboard-cache.json')
$env:LOCAL_DATABASE_FILE=(Join-Path $SNAPSHOT_DATA 'app.sqlite')
$env:PERSONNEL_DATABASE_FILE=(Join-Path $SNAPSHOT_DATA 'personnel-database.json')
$env:DASHBOARD_DEV_RELOAD='0'
$env:DASHBOARD_AUTO_UPDATE_ENABLED='0'
$env:DASHBOARD_SYNC_ENABLED='0'

function Find-NodeExecutable {
  $codexNodes = Get-ChildItem -Path "$env:USERPROFILE\.codex\tools\node-*\node.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    ForEach-Object { $_.FullName }

  $candidates = @(
    (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
  ) + @($codexNodes) + @(
    "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    'D:\Tools\Codex\resources\node.exe'
  )
  $candidates = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  $unique = @()
  foreach ($item in $candidates) {
    if ($unique -notcontains $item) {
      $unique += $item
    }
  }
  return $unique | Select-Object -First 1
}

function Stop-PortListeners {
  param([int]$ListenPort)

  $killed = @{}
  try {
    $connections = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      $processId = [int]$connection.OwningProcess
      if ($processId -le 0 -or $killed.ContainsKey($processId)) {
        continue
      }
      Write-Host "[dashboard] Stopping process $processId on port $ListenPort..."
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
      $killed[$processId] = $true
    }
  } catch {
    # Fallback when Get-NetTCPConnection is unavailable.
  }

  $netstat = netstat -ano | Select-String ":$ListenPort\s+.*LISTENING"
  foreach ($line in $netstat) {
    $parts = ($line -replace '\s+', ' ').Trim().Split(' ')
    $processId = [int]$parts[-1]
    if ($processId -le 0 -or $killed.ContainsKey($processId)) {
      continue
    }
    Write-Host "[dashboard] Stopping process $processId on port $ListenPort..."
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    $killed[$processId] = $true
  }

  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    $stillListening = netstat -ano | Select-String ":$ListenPort\s+.*LISTENING"
    if (-not $stillListening) {
      return
    }
    Start-Sleep -Milliseconds 250
  }

  throw "Port $ListenPort is still in use. Close the old dashboard process and try again."
}

function Copy-SnapshotDirectory {
  param(
    [string]$Source,
    [string]$Destination,
    [string]$Label
  )

  & robocopy $Source $Destination /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "Failed to copy $Label snapshot. robocopy exit code: $LASTEXITCODE"
  }
  $global:LASTEXITCODE = 0
}

function Rebuild-IntranetSnapshot {
  $runtimeRoot = Join-Path $root '.runtime'
  New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

  $resolvedRuntimeRoot = [System.IO.Path]::GetFullPath($runtimeRoot)
  $resolvedSnapshotDir = [System.IO.Path]::GetFullPath($SNAPSHOT_DIR)
  if (-not $resolvedSnapshotDir.StartsWith($resolvedRuntimeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Snapshot directory is outside the runtime root: $SNAPSHOT_DIR"
  }

  Write-Host '[dashboard] Rebuilding display snapshot from current public/data...'
  if (Test-Path -LiteralPath $SNAPSHOT_DIR) {
    Remove-Item -LiteralPath $SNAPSHOT_DIR -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $SNAPSHOT_PUBLIC | Out-Null
  New-Item -ItemType Directory -Force -Path $SNAPSHOT_DATA | Out-Null

  Copy-SnapshotDirectory -Source (Join-Path $root 'public') -Destination $SNAPSHOT_PUBLIC -Label 'public'
  Copy-SnapshotDirectory -Source (Join-Path $root 'data') -Destination $SNAPSHOT_DATA -Label 'data'
}

function Wait-DashboardReady {
  param(
    [int]$ListenPort,
    [int]$TimeoutSec = 120
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $healthUrl = "http://127.0.0.1:$ListenPort/api/health"
  $warmupUrl = "http://127.0.0.1:$ListenPort/api/dashboard-warmup"
  $healthReady = $false

  Write-Host '[dashboard] Waiting for server health...'
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        $healthReady = $true
        break
      }
    } catch {
      # Server is still starting or warming up.
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $healthReady) {
    throw "Health check timed out after ${TimeoutSec}s."
  }

  Write-Host '[dashboard] Warming dashboard data...'
  try {
    $remaining = [Math]::Max(1, [int]($deadline - (Get-Date)).TotalSeconds)
    $response = Invoke-WebRequest -Uri $warmupUrl -UseBasicParsing -TimeoutSec $remaining
    if ($response.StatusCode -eq 200) {
      $snapshot = $response.Content | ConvertFrom-Json
      $records = if ($null -ne $snapshot.totalRecords) { [int]$snapshot.totalRecords } else { 0 }
      $features = if ($null -ne $snapshot.features) { ($snapshot.features -join ', ') } else { '' }
      if ($snapshot.warmed -ne $true) {
        throw "Dashboard warmup did not publish a complete read model. $($snapshot.error)"
      }
      Write-Host "[dashboard] Data ready: $records project(s), synced at $($snapshot.syncedAt), warmed: $features"
      return $snapshot
    }
  } catch {
    throw "Dashboard data did not become ready within ${TimeoutSec}s. $($_.Exception.Message)"
  }

  throw "Dashboard data did not become ready within ${TimeoutSec}s."
}

function Get-LanIp {
  $fallback = ''
  $private = ''
  $lines = ipconfig | Select-String 'IPv4.*:'
  foreach ($line in $lines) {
    $ip = (($line -split ':', 2)[1] -replace '\s+', '').Trim()
    if (-not $ip) {
      continue
    }
    if ($ip -match '^127\.' -or $ip -match '^169\.254\.' -or $ip -match '^198\.18\.' -or $ip -match '^198\.19\.') {
      continue
    }
    if (-not $fallback) {
      $fallback = $ip
    }
    if ($ip -match '^10\.' -or $ip -match '^192\.168\.' -or $ip -match '^172\.(1[6-9]|2[0-9]|3[0-1])\.') {
      $private = $ip
      break
    }
  }

  if ($private) {
    return $private
  }
  if ($fallback) {
    return $fallback
  }
  return 'LAN-IP'
}

$nodeExe = Find-NodeExecutable
if (-not $nodeExe) {
  throw 'Node.js was not found. Install Node.js or add node.exe to PATH.'
}

$entryPath = Join-Path $root ($AppEntry -replace '^\.\\', '')
if (-not (Test-Path -LiteralPath $entryPath)) {
  throw "Server entry was not found: $AppEntry"
}

$logDir = Join-Path $root '.tmp'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdoutLog = Join-Path $logDir 'intranet-dashboard-server.out.log'
$stderrLog = Join-Path $logDir 'intranet-dashboard-server.err.log'

Write-Host '[dashboard] Intranet display mode'
Write-Host "[dashboard] Workspace: $root"
Write-Host "[dashboard] Node: $nodeExe"
Write-Host "[dashboard] Snapshot: $SNAPSHOT_DIR"

Rebuild-IntranetSnapshot
Stop-PortListeners -ListenPort $Port

Write-Host '[dashboard] Starting intranet dashboard (snapshot mode, no watch/reload/sync)...'
$server = Start-Process `
  -FilePath $nodeExe `
  -ArgumentList @($entryPath) `
  -WorkingDirectory $root `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru `
  -WindowStyle Hidden

try {
  if ($server.HasExited) {
    $stderr = Get-Content -LiteralPath $stderrLog -ErrorAction SilentlyContinue
    throw "Server exited immediately.`n$($stderr -join [Environment]::NewLine)"
  }

  $snapshot = Wait-DashboardReady -ListenPort $Port -TimeoutSec 120
  $LAN_IP = Get-LanIp

  Write-Host ''
  Write-Host '============================================================'
  Write-Host "COPY THIS URL: http://${LAN_IP}:$PORT"
  Write-Host '============================================================'
  Write-Host "[dashboard] Local URL: http://localhost:$Port"
  Write-Host "[dashboard] Intranet URL: http://${LAN_IP}:$PORT"
  Write-Host "[dashboard] Server PID: $($server.Id)"
  Write-Host "[dashboard] Logs: $stdoutLog"
  Write-Host '[dashboard] Press Ctrl+C to stop.'

  Start-Process "http://localhost:$Port/"
  Write-Host '[dashboard] Browser opened.'

  while (-not $server.HasExited) {
    Start-Sleep -Seconds 1
  }

  $exitCode = $server.ExitCode
  if ($null -ne $exitCode -and $exitCode -ne 0) {
    $stderr = Get-Content -LiteralPath $stderrLog -ErrorAction SilentlyContinue
    throw "Server exited with code $exitCode.`n$($stderr -join [Environment]::NewLine)"
  }
  Write-Host '[dashboard] Server stopped.'
} catch {
  if (-not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
  Write-Host "[dashboard] ERROR: $($_.Exception.Message)" -ForegroundColor Red
  if (Test-Path -LiteralPath $stderrLog) {
    Write-Host '--- server stderr ---'
    Get-Content -LiteralPath $stderrLog -ErrorAction SilentlyContinue
  }
  exit 1
}
