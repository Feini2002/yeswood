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
    [int]$TimeoutSec = 45
  )

  $warmupUrl = "http://127.0.0.1:$ListenPort/api/dashboard-warmup?scope=boot"

  Write-Host "[dashboard] Warming dashboard boot shell before browser open (timeout ${TimeoutSec}s)..."
  try {
    $response = Invoke-WebRequest -Uri $warmupUrl -UseBasicParsing -TimeoutSec $TimeoutSec
    if ($response.StatusCode -eq 200) {
      $snapshot = $response.Content | ConvertFrom-Json
      $records = if ($null -ne $snapshot.totalRecords) { [int]$snapshot.totalRecords } else { 0 }
      $features = if ($null -ne $snapshot.features) { ($snapshot.features -join ', ') } else { '' }
      if ($snapshot.warmed -ne $true) {
        throw "Dashboard boot warmup did not publish a shell read model. $($snapshot.error)"
      }
      Write-Host "[dashboard] Boot shell ready: $records project(s), synced at $($snapshot.syncedAt), warmed: $features"
      return $snapshot
    }
    throw "Dashboard boot warmup returned HTTP $($response.StatusCode)."
  } catch {
    $message = $_.Exception.Message
    throw "Dashboard boot warmup failed before browser open: $message"
  }
}

function Start-DashboardWarmup {
  param(
    [int]$ListenPort,
    [int]$TimeoutSec = 300,
    [string]$LogPath
  )

  $warmupUrl = "http://127.0.0.1:$ListenPort/api/dashboard-warmup"
  Write-Host "[dashboard] Starting dashboard data warmup in background (timeout ${TimeoutSec}s)..."
  $job = Start-Job -ScriptBlock {
    param($Url, $TimeoutSec, $LogPath)
    $startedAt = Get-Date
    try {
      Add-Content -LiteralPath $LogPath -Value "[dashboard] Warmup started at $($startedAt.ToString('s')): $Url"
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
      $snapshot = $response.Content | ConvertFrom-Json
      if ($response.StatusCode -eq 200 -and $snapshot.warmed -eq $true) {
        $features = if ($null -ne $snapshot.features) { ($snapshot.features -join ', ') } else { '' }
        Add-Content -LiteralPath $LogPath -Value "[dashboard] Warmup finished: $($snapshot.totalRecords) project(s), features: $features"
        return
      }
      Add-Content -LiteralPath $LogPath -Value "[dashboard] Warmup failed: HTTP $($response.StatusCode), warmed=$($snapshot.warmed), error=$($snapshot.error)"
    } catch {
      Add-Content -LiteralPath $LogPath -Value "[dashboard] Warmup failed: $($_.Exception.Message)"
    }
  } -ArgumentList $warmupUrl, $TimeoutSec, $LogPath
  Write-Host "[dashboard] Warmup Job ID: $($job.Id)"
  Write-Host "[dashboard] Warmup log: $LogPath"
  return $job
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
$warmupLog = Join-Path $logDir 'dashboard-warmup.log'

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
  Warm-DashboardData -ListenPort $Port -TimeoutSec 45 | Out-Null
  Start-Process "http://localhost:$Port/"
  Write-Host '[dashboard] Browser opened after boot shell warmup.'
  try {
    $warmupJob = Start-DashboardWarmup -ListenPort $Port -TimeoutSec 300 -LogPath $warmupLog
    Write-Host '[dashboard] Full dashboard data is warming in the background.'
  } catch {
    $warmupJob = $null
    Write-Host "[dashboard] Full warmup background start failed; browser remains available. $($_.Exception.Message)" -ForegroundColor Yellow
  }
  Write-Host "[dashboard] Server PID: $($server.Id)"
  Write-Host "[dashboard] Logs: $stdoutLog"
  if ($warmupJob) {
    Write-Host "[dashboard] Warmup Job ID: $($warmupJob.Id)"
  }
  Write-Host '[dashboard] Press Ctrl+C to stop.'

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
