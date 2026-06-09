#Requires -Version 5.1
param(
  [int]$Port = 4200,
  [string]$AppEntry = '.\src\backend\server.mjs'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$env:PORT = "$Port"
$env:HOST = '127.0.0.1'
$env:DASHBOARD_DEV_RELOAD = '1'
$env:DASHBOARD_AUTO_UPDATE_ENABLED = '1'

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

function Wait-DashboardHealth {
  param(
    [int]$ListenPort,
    [int]$TimeoutSec = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $healthUrl = "http://127.0.0.1:$ListenPort/api/health"

  Write-Host "[dashboard] Waiting for server health..."
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        return
      }
    } catch {
      # Server is still starting.
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Health check timed out after ${TimeoutSec}s."
}

function Warm-DashboardData {
  param(
    [int]$ListenPort,
    [int]$TimeoutSec = 15
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $snapshotUrl = "http://127.0.0.1:$ListenPort/api/snapshot"

  Write-Host "[dashboard] Warming up dashboard data after browser open..."
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $snapshotUrl -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -eq 200) {
        $snapshot = $response.Content | ConvertFrom-Json
        $records = if ($null -ne $snapshot.totalRecords) { [int]$snapshot.totalRecords } else { 0 }
        Write-Host "[dashboard] Data ready: $records project(s), synced at $($snapshot.syncedAt)"
        return $snapshot
      }
    } catch {
      # Snapshot build can block the event loop briefly on cold start.
    }
    Start-Sleep -Seconds 1
  }

  Write-Host "[dashboard] Data warmup is still running; the page will finish loading it." -ForegroundColor Yellow
  return $null
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
$stdoutLog = Join-Path $logDir 'dashboard-server.out.log'
$stderrLog = Join-Path $logDir 'dashboard-server.err.log'

Write-Host '[dashboard] Development mode'
Write-Host "[dashboard] Workspace: $root"
Write-Host "[dashboard] Node: $nodeExe"
Write-Host "[dashboard] URL: http://localhost:$Port"

Stop-PortListeners -ListenPort $Port

Write-Host '[dashboard] Starting server (stable mode, no --watch)...'
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

  Wait-DashboardHealth -ListenPort $Port -TimeoutSec 60
  Start-Process "http://localhost:$Port/"
  Write-Host '[dashboard] Browser opened; dashboard data can keep warming in the page.'
  Write-Host "[dashboard] Server PID: $($server.Id)"
  Write-Host "[dashboard] Logs: $stdoutLog"
  Write-Host '[dashboard] Press Ctrl+C to stop.'
  [void](Warm-DashboardData -ListenPort $Port -TimeoutSec 15)

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
