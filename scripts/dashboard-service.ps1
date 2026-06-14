#Requires -Version 5.1
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'restart', 'status', 'open', 'doctor')]
  [string]$Command = 'status',

  [int]$Port = 4200,
  [switch]$Force,
  [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$AppName = 'yeswood-dashboard'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

$TmpDir = Join-Path $Root '.tmp'
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

$DefaultStatePath = Join-Path $TmpDir 'dashboard-service.json'
if ($env:YESWOOD_SERVICE_STATE_FILE) {
  $StatePath = [System.IO.Path]::GetFullPath($env:YESWOOD_SERVICE_STATE_FILE)
} else {
  $StatePath = $DefaultStatePath
}
$LockPath = Join-Path $TmpDir 'dashboard-service.lock'

$EntryPath = Join-Path $Root 'src\backend\server.mjs'
$StdoutLog = Join-Path $TmpDir 'dashboard-server.out.log'
$StderrLog = Join-Path $TmpDir 'dashboard-server.err.log'
$WarmupLog = Join-Path $TmpDir 'dashboard-warmup.log'
$HostName = '127.0.0.1'
$Url = "http://localhost:$Port/"

function Write-Info {
  param([string]$Message)
  Write-Host "[dashboard] $Message"
}

function Write-WarnLine {
  param([string]$Message)
  Write-Host "[dashboard] WARNING: $Message" -ForegroundColor Red
}

function Write-SoftWarn {
  param([string]$Message)
  Write-Host "[dashboard] $Message" -ForegroundColor Yellow
}

function Find-NodeExecutable {
  $codexNodes = Get-ChildItem -Path "$env:USERPROFILE\.codex\tools\node-*\node.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    ForEach-Object { $_.FullName }

  $pathNode = Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue
  $candidates = @($pathNode) + @($codexNodes) + @(
    "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    'D:\Tools\Codex\resources\node.exe'
  )

  $unique = @()
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate) -and ($unique -notcontains $candidate)) {
      $unique += $candidate
    }
  }
  return $unique | Select-Object -First 1
}

function Get-GitCommit {
  try {
    return (& git rev-parse --short HEAD 2>$null).Trim()
  } catch {
    return ''
  }
}

function Normalize-PathForCompare {
  param([string]$PathValue)
  if (-not $PathValue) {
    return ''
  }
  try {
    return ([System.IO.Path]::GetFullPath($PathValue)).TrimEnd('\', '/').ToLowerInvariant()
  } catch {
    return ([string]$PathValue).TrimEnd('\', '/').ToLowerInvariant()
  }
}

function Test-SamePath {
  param(
    [string]$Left,
    [string]$Right
  )
  return (Normalize-PathForCompare -PathValue $Left) -eq (Normalize-PathForCompare -PathValue $Right)
}

function Validate-ServiceState {
  param([object]$State)
  if ($null -eq $State) {
    return $null
  }
  $stateApp = [string](Get-PropertyValue -Object $State -Name 'app' -Default '')
  $stateRoot = [string](Get-PropertyValue -Object $State -Name 'root' -Default '')
  if ($stateApp -ne $AppName -or -not (Test-SamePath -Left $stateRoot -Right $Root)) {
    Write-SoftWarn "Ignoring service state with app/root mismatch: app=$stateApp, root=$stateRoot"
    return $null
  }
  return $State
}

function Read-ServiceState {
  if (-not (Test-Path -LiteralPath $StatePath)) {
    return $null
  }
  try {
    $state = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    return Validate-ServiceState -State $state
  } catch {
    Write-SoftWarn "State file is unreadable and will be ignored: $StatePath"
    return $null
  }
}

function Get-PropertyValue {
  param(
    [object]$Object,
    [string]$Name,
    [object]$Default = $null
  )
  if ($null -eq $Object) {
    return $Default
  }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $Default
  }
  if ($null -eq $property.Value) {
    return $Default
  }
  return $property.Value
}

function Write-ServiceState {
  param([object]$State)
  $parent = Split-Path -Parent $StatePath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $tempPath = Join-Path $parent ("dashboard-service.json.tmp-{0}-{1}" -f $PID, [Guid]::NewGuid().ToString('N'))
  try {
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tempPath -Encoding UTF8
    Move-Item -LiteralPath $tempPath -Destination $StatePath -Force
  } finally {
    if (Test-Path -LiteralPath $tempPath) {
      Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function New-ServiceLock {
  param([int]$TimeoutSec = 20)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $stream = [System.IO.File]::Open(
        $LockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
      )
      $stream.SetLength(0)
      $writer = New-Object System.IO.StreamWriter($stream)
      $writer.AutoFlush = $true
      $writer.WriteLine("pid=$PID")
      $writer.WriteLine("startedAt=$((Get-Date).ToString('s'))")
      return [pscustomobject]@{
        stream = $stream
        writer = $writer
        path = $LockPath
      }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  throw "Could not acquire service lock within ${TimeoutSec}s: $LockPath"
}

function Release-ServiceLock {
  param([object]$Lock)
  if ($null -eq $Lock) {
    return
  }
  try {
    $Lock.writer.Dispose()
  } catch {
  }
  try {
    $Lock.stream.Dispose()
  } catch {
  }
}

function Invoke-WithServiceLock {
  param([scriptblock]$Body)
  $serviceLock = New-ServiceLock
  try {
    & $Body
  } finally {
    Release-ServiceLock -Lock $serviceLock
  }
}

function Remove-ServiceState {
  if (Test-Path -LiteralPath $StatePath) {
    Remove-Item -LiteralPath $StatePath -Force
  }
}

function Test-ProcessAlive {
  param([int]$ProcessId)
  if ($ProcessId -le 0) {
    return $false
  }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Get-CommandLineForPid {
  param([int]$ProcessId)
  if ($ProcessId -le 0) {
    return ''
  }
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    return [string]$process.CommandLine
  } catch {
    return ''
  }
}

function Get-ProcessNameForPid {
  param([int]$ProcessId)
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($process) {
    return $process.ProcessName
  }
  return ''
}

function Test-CurrentRepoServerCommandLine {
  param([string]$CommandLine)
  if (-not $CommandLine) {
    return $false
  }
  $normalizedRoot = $Root.ToLowerInvariant().Replace('/', '\').TrimEnd('\')
  $normalizedCommand = $CommandLine.ToLowerInvariant().Replace('/', '\')
  return $normalizedCommand.Contains($normalizedRoot) -and ($normalizedCommand -match 'src\\backend\\server\.mjs')
}

function Get-PortListeners {
  param([int]$ListenPort)
  $listeners = @()
  try {
    $connections = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      $ownerProcessId = [int]$connection.OwningProcess
      $listeners += [pscustomobject]@{
        pid = $ownerProcessId
        processName = Get-ProcessNameForPid -ProcessId $ownerProcessId
        commandLine = Get-CommandLineForPid -ProcessId $ownerProcessId
        localAddress = $connection.LocalAddress
        localPort = [int]$connection.LocalPort
      }
    }
  } catch {
    # Some restricted shells cannot read TCP tables through NetTCPIP.
  }

  if ($listeners.Count -eq 0) {
    $netstat = netstat -ano | Select-String ":$ListenPort\s+.*LISTENING"
    foreach ($line in $netstat) {
      $parts = ($line -replace '\s+', ' ').Trim().Split(' ')
      $ownerProcessId = [int]$parts[-1]
      $listeners += [pscustomobject]@{
        pid = $ownerProcessId
        processName = Get-ProcessNameForPid -ProcessId $ownerProcessId
        commandLine = Get-CommandLineForPid -ProcessId $ownerProcessId
        localAddress = ''
        localPort = $ListenPort
      }
    }
  }
  return @($listeners)
}

function Get-ListeningPortsForPid {
  param([int]$ProcessId)
  $ports = @()
  try {
    $connections = Get-NetTCPConnection -OwningProcess $ProcessId -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      $ports += [int]$connection.LocalPort
    }
  } catch {
    $netstat = netstat -ano | Select-String "\sLISTENING\s+$ProcessId$"
    foreach ($line in $netstat) {
      $parts = ($line -replace '\s+', ' ').Trim().Split(' ')
      $address = $parts[1]
      $lastColon = $address.LastIndexOf(':')
      if ($lastColon -ge 0) {
        $ports += [int]$address.Substring($lastColon + 1)
      }
    }
  }
  return @($ports | Sort-Object -Unique)
}

function Get-RepoServerProcesses {
  $servers = @()
  try {
    $processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop
  } catch {
    Write-SoftWarn "Unable to inspect node command lines with Get-CimInstance Win32_Process: $($_.Exception.Message)"
    return @()
  }

  foreach ($process in $processes) {
    $commandLine = [string]$process.CommandLine
    if (Test-CurrentRepoServerCommandLine -CommandLine $commandLine) {
      $serverProcessId = [int]$process.ProcessId
      $servers += [pscustomobject]@{
        pid = $serverProcessId
        processName = [string]$process.Name
        commandLine = $commandLine
        ports = @(Get-ListeningPortsForPid -ProcessId $serverProcessId)
      }
    }
  }
  return @($servers)
}

function Invoke-Health {
  param(
    [int]$ListenPort,
    [int]$TimeoutSec = 5
  )
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/api/health" -TimeoutSec $TimeoutSec
    return [bool]$response.ok
  } catch {
    return $false
  }
}

function Invoke-Runtime {
  param(
    [int]$ListenPort,
    [int]$TimeoutSec = 5
  )
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/api/runtime" -TimeoutSec $TimeoutSec
  } catch {
    return $null
  }
}

function Test-YeswoodListener {
  param(
    [object]$Listener,
    [int]$ListenPort
  )
  if (Test-CurrentRepoServerCommandLine -CommandLine $Listener.commandLine) {
    return $true
  }
  $runtime = Invoke-Runtime -ListenPort $ListenPort
  return $runtime -and $runtime.app -eq $AppName -and [int]$runtime.pid -eq [int]$Listener.pid
}

function Stop-PidIfAlive {
  param(
    [int]$ProcessId,
    [string]$Reason = 'yeswood dashboard process'
  )
  if ($ProcessId -le 0 -or -not (Test-ProcessAlive -ProcessId $ProcessId)) {
    return
  }
  if ($ProcessId -eq $PID) {
    throw "Refusing to stop the current PowerShell process ($PID)."
  }
  Write-Info "Stopping PID $ProcessId ($Reason)..."
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    if (-not (Test-ProcessAlive -ProcessId $ProcessId)) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "PID $ProcessId did not stop within 5 seconds."
}

function Wait-PortFree {
  param([int]$ListenPort)
  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    if (@(Get-PortListeners -ListenPort $ListenPort).Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Port $ListenPort is still in use."
}

function Wait-DashboardHealth {
  param(
    [int]$ListenPort,
    [int]$TimeoutSec = 30,
    [int]$ServerPid = 0
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  Write-Info "Waiting for /api/health on port $ListenPort..."
  while ((Get-Date) -lt $deadline) {
    if ($ServerPid -gt 0 -and -not (Test-ProcessAlive -ProcessId $ServerPid)) {
      throw "Server PID $ServerPid exited before health check passed."
    }
    if (Invoke-Health -ListenPort $ListenPort -TimeoutSec 3) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Health check timed out after ${TimeoutSec}s."
}

function Wait-DashboardRuntime {
  param(
    [int]$ListenPort,
    [int]$TimeoutSec = 20
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  Write-Info "Waiting for /api/runtime on port $ListenPort..."
  while ((Get-Date) -lt $deadline) {
    $runtime = Invoke-Runtime -ListenPort $ListenPort -TimeoutSec 5
    if ($runtime -and $runtime.app -eq $AppName) {
      return $runtime
    }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

function Start-WarmupProcess {
  param([int]$ListenPort)
  $warmupUrl = "http://127.0.0.1:$ListenPort/api/dashboard-warmup"
  $script = @"
try {
  Add-Content -LiteralPath '$WarmupLog' -Value ("[dashboard] Warmup started at " + (Get-Date).ToString('s') + ": $warmupUrl")
  `$response = Invoke-WebRequest -Uri '$warmupUrl' -UseBasicParsing -TimeoutSec 300
  `$snapshot = `$response.Content | ConvertFrom-Json
  if (`$response.StatusCode -eq 200 -and `$snapshot.warmed -eq `$true) {
    `$features = if (`$null -ne `$snapshot.features) { (`$snapshot.features -join ', ') } else { '' }
    Add-Content -LiteralPath '$WarmupLog' -Value "[dashboard] Warmup finished: `$(`$snapshot.totalRecords) project(s), features: `$features"
  } else {
    Add-Content -LiteralPath '$WarmupLog' -Value "[dashboard] Warmup returned HTTP `$(`$response.StatusCode), warmed=`$(`$snapshot.warmed), error=`$(`$snapshot.error)"
  }
} catch {
  Add-Content -LiteralPath '$WarmupLog' -Value "[dashboard] Warmup failed: `$(`$_.Exception.Message)"
}
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  $process = Start-Process -FilePath 'powershell' -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    $encoded
  ) -WindowStyle Hidden -PassThru
  Write-Info "Warmup process PID: $($process.Id)"
  Write-Info "Warmup log: $WarmupLog"
  return $process
}

function Wait-DashboardBootWarmup {
  param(
    [int]$ListenPort,
    [int]$TimeoutSec = 45
  )
  $warmupUrl = "http://127.0.0.1:$ListenPort/api/dashboard-warmup?scope=boot"
  Write-Info "Waiting for dashboard boot shell warmup..."
  try {
    $response = Invoke-WebRequest -Uri $warmupUrl -UseBasicParsing -TimeoutSec $TimeoutSec
    $snapshot = $response.Content | ConvertFrom-Json
    if ($response.StatusCode -eq 200 -and $snapshot.warmed -eq $true) {
      $features = if ($null -ne $snapshot.features) { ($snapshot.features -join ', ') } else { '' }
      Write-Info "Boot shell ready: $($snapshot.totalRecords) project(s), features: $features"
      return $snapshot
    }
    throw "Dashboard boot warmup returned HTTP $($response.StatusCode), warmed=$($snapshot.warmed), error=$($snapshot.error)"
  } catch {
    throw "Dashboard boot warmup failed before browser open: $($_.Exception.Message)"
  }
}

function Open-ServiceUrl {
  param([string]$OpenUrl)
  if ($env:YESWOOD_SKIP_OPEN -eq '1') {
    Write-Info "Browser open skipped by YESWOOD_SKIP_OPEN=1: $OpenUrl"
    return
  }
  Start-Process $OpenUrl
  Write-Info "Browser opened: $OpenUrl"
}

function Stop-RegisteredService {
  param([switch]$StopAll)
  $state = Read-ServiceState
  if ($state) {
    Write-Info "Registered service state: $StatePath"
    $warmupPid = [int](Get-PropertyValue -Object $state -Name 'warmupJobId' -Default 0)
    if ($warmupPid -gt 0) {
      Stop-PidIfAlive -ProcessId $warmupPid -Reason 'registered warmup process'
    }
    $registeredPid = [int](Get-PropertyValue -Object $state -Name 'pid' -Default 0)
    if ($registeredPid -gt 0) {
      $commandLine = Get-CommandLineForPid -ProcessId $registeredPid
      if ($commandLine -and -not (Test-CurrentRepoServerCommandLine -CommandLine $commandLine)) {
        Write-SoftWarn "Registered PID $registeredPid is alive but does not look like this repository server; leaving it alone."
      } else {
        Stop-PidIfAlive -ProcessId $registeredPid -Reason 'registered dashboard service'
      }
    }
  }

  foreach ($listener in Get-PortListeners -ListenPort $Port) {
    if (Test-YeswoodListener -Listener $listener -ListenPort $Port) {
      Stop-PidIfAlive -ProcessId ([int]$listener.pid) -Reason "yeswood listener on port $Port"
    } else {
      Write-SoftWarn "Port $Port is used by non-yeswood PID $($listener.pid) ($($listener.processName)); not stopping it."
    }
  }

  if ($StopAll) {
    foreach ($server in Get-RepoServerProcesses) {
      Stop-PidIfAlive -ProcessId ([int]$server.pid) -Reason 'extra yeswood server.mjs process'
    }
  }

  Remove-ServiceState
}

function Start-DashboardService {
  if ($Port -le 0) {
    throw 'Dashboard service port must be a positive fixed port.'
  }
  if (-not (Test-Path -LiteralPath $EntryPath)) {
    throw "Server entry was not found: $EntryPath"
  }

  $nodeExe = Find-NodeExecutable
  if (-not $nodeExe) {
    throw 'Node.js was not found. Install Node.js or add node.exe to PATH.'
  }

  $state = Read-ServiceState
  if ($state) {
    $statePid = [int](Get-PropertyValue -Object $state -Name 'pid' -Default 0)
    if ($statePid -gt 0 -and (Test-ProcessAlive -ProcessId $statePid)) {
      $statePort = [int](Get-PropertyValue -Object $state -Name 'port' -Default $Port)
      $stateUrl = [string](Get-PropertyValue -Object $state -Name 'url' -Default $Url)
      if ((Invoke-Health -ListenPort $statePort) -and -not $Force) {
        Write-Info "Already running: PID $statePid, URL $stateUrl"
        Wait-DashboardBootWarmup -ListenPort $statePort -TimeoutSec 45 | Out-Null
        Open-ServiceUrl -OpenUrl $stateUrl
        return
      }
      if ($Force) {
        Stop-PidIfAlive -ProcessId $statePid -Reason 'registered service replacement'
        Remove-ServiceState
      } else {
        throw "Registered PID $statePid is alive but health failed. Run npm run dev:restart or inspect with npm run dev:status."
      }
    } else {
      Write-SoftWarn "Removing stale service state: $StatePath"
      Remove-ServiceState
    }
  }

  foreach ($listener in Get-PortListeners -ListenPort $Port) {
    if (Test-YeswoodListener -Listener $listener -ListenPort $Port) {
      if ($Force) {
        Stop-PidIfAlive -ProcessId ([int]$listener.pid) -Reason "old yeswood listener on port $Port"
      } else {
        throw "Port $Port is already used by yeswood PID $($listener.pid). Run npm run dev:restart to replace it."
      }
    } else {
      throw "Port $Port is used by non-yeswood PID $($listener.pid) ($($listener.processName)); refusing to start."
    }
  }
  Wait-PortFree -ListenPort $Port

  $otherServers = @(Get-RepoServerProcesses | Where-Object {
      $ports = @($_.ports)
      $ports.Count -eq 0 -or ($ports -notcontains $Port)
    })
  if ($otherServers.Count -gt 0) {
    if ($Force) {
      foreach ($server in $otherServers) {
        Stop-PidIfAlive -ProcessId ([int]$server.pid) -Reason 'wrong-port yeswood server.mjs process'
      }
    } else {
      $ids = ($otherServers | ForEach-Object { "$($_.pid)[$(($_.ports -join ',') -replace '^$', 'no-listener')]" }) -join ', '
      throw "Found yeswood server.mjs process(es) outside port ${Port}: $ids. Run npm run dev:status or restart with -Force."
    }
  }

  Clear-Content -LiteralPath $StdoutLog -ErrorAction SilentlyContinue
  Clear-Content -LiteralPath $StderrLog -ErrorAction SilentlyContinue
  Clear-Content -LiteralPath $WarmupLog -ErrorAction SilentlyContinue

  $commit = Get-GitCommit
  $env:PORT = "$Port"
  $env:HOST = $HostName
  $env:DASHBOARD_DEV_RELOAD = '1'
  $env:DASHBOARD_AUTO_UPDATE_ENABLED = '1'
  $env:YESWOOD_DASHBOARD_SERVICE = '1'
  $env:YESWOOD_SERVICE_STATE_FILE = $StatePath
  $env:YESWOOD_GIT_COMMIT = $commit

  Write-Info "Starting $AppName"
  Write-Info "Workspace: $Root"
  Write-Info "Node: $nodeExe"
  Write-Info "Entry: $EntryPath"
  Write-Info "URL: $Url"

  $startParams = @{
    FilePath = $nodeExe
    ArgumentList = @($EntryPath)
    WorkingDirectory = $Root
    RedirectStandardOutput = $StdoutLog
    RedirectStandardError = $StderrLog
    PassThru = $true
  }
  if ($Foreground) {
    $startParams.NoNewWindow = $true
  } else {
    $startParams.WindowStyle = 'Hidden'
  }

  $server = Start-Process @startParams
  try {
    Wait-DashboardHealth -ListenPort $Port -TimeoutSec 30 -ServerPid ([int]$server.Id)
    $runtime = Wait-DashboardRuntime -ListenPort $Port -TimeoutSec 20
    if (-not $runtime -or $runtime.app -ne $AppName) {
      throw 'Runtime endpoint did not identify a yeswood dashboard service.'
    }
    if ([int]$runtime.pid -ne [int]$server.Id) {
      throw "Runtime PID $($runtime.pid) did not match started PID $($server.Id)."
    }

    Wait-DashboardBootWarmup -ListenPort $Port -TimeoutSec 45 | Out-Null
    $state = [ordered]@{
      app = $AppName
      root = $Root
      pid = [int]$server.Id
      port = [int]$runtime.port
      host = $HostName
      url = $Url
      nodePath = $nodeExe
      entryPath = $EntryPath
      startedAt = [string]$runtime.startedAt
      commit = [string]$runtime.commit
      stdoutLog = $StdoutLog
      stderrLog = $StderrLog
      warmupLog = $WarmupLog
      warmupJobId = 0
    }
    Write-ServiceState -State $state
    Write-Info "State written: $StatePath"
    Write-Info "Server PID: $($server.Id)"
    Write-Info "Logs: $StdoutLog"
    Open-ServiceUrl -OpenUrl $Url
    try {
      $warmup = Start-WarmupProcess -ListenPort $Port
      $state.warmupJobId = [int]$warmup.Id
      Write-ServiceState -State $state
    } catch {
      Write-SoftWarn "Full warmup background start failed; browser remains available. $($_.Exception.Message)"
    }
  } catch {
    if (Test-ProcessAlive -ProcessId ([int]$server.Id)) {
      Stop-PidIfAlive -ProcessId ([int]$server.Id) -Reason 'failed startup cleanup'
    }
    if (Test-Path -LiteralPath $StderrLog) {
      Write-Host '--- server stderr ---'
      Get-Content -LiteralPath $StderrLog -Tail 20 -ErrorAction SilentlyContinue
    }
    throw
  }
}

function Show-Status {
  $state = Read-ServiceState
  if ($state) {
    Write-Info "Service state: $StatePath"
    $state | ConvertTo-Json -Depth 8
  } else {
    Write-Info "No service state: $StatePath"
  }

  $statePidAlive = $false
  $statePid = [int](Get-PropertyValue -Object $state -Name 'pid' -Default 0)
  if ($statePid -gt 0) {
    $statePidAlive = Test-ProcessAlive -ProcessId $statePid
    Write-Info "State PID alive: $statePidAlive"
  }

  $listeners = @(Get-PortListeners -ListenPort $Port)
  if ($listeners.Count -eq 0) {
    Write-Info "Port $Port listener: none"
  } else {
    Write-Info "Port $Port listener(s):"
    $listeners | Select-Object pid, processName, localAddress, localPort | Format-Table -AutoSize
  }

  $healthOk = Invoke-Health -ListenPort $Port -TimeoutSec 10
  Write-Info "/api/health ok: $healthOk"
  $runtime = Invoke-Runtime -ListenPort $Port -TimeoutSec 10
  if ($runtime) {
    Write-Info "/api/runtime:"
    $runtime | ConvertTo-Json -Depth 8
  } else {
    Write-Info "/api/runtime: unavailable"
  }

  $listenerPids = @($listeners | ForEach-Object { [int]$_.pid } | Sort-Object -Unique)
  if ($statePid -gt 0 -and $listeners.Count -gt 0 -and ($listenerPids -notcontains $statePid)) {
    Write-WarnLine "State PID $statePid does not match port $Port listener PID(s): $($listenerPids -join ', ')"
  }
  if ($statePid -gt 0 -and $runtime -and [int]$runtime.pid -ne $statePid) {
    Write-WarnLine "State PID $statePid does not match runtime PID $($runtime.pid)"
  }
  if ($runtime -and $listeners.Count -gt 0 -and ($listenerPids -notcontains [int]$runtime.pid)) {
    Write-WarnLine "Runtime PID $($runtime.pid) does not match port $Port listener PID(s): $($listenerPids -join ', ')"
  }
  if ($runtime -and [int]$runtime.port -ne $Port) {
    Write-WarnLine "Runtime port $($runtime.port) does not match requested status port $Port"
  }

  $stderrPath = [string](Get-PropertyValue -Object $state -Name 'stderrLog' -Default $StderrLog)
  if (Test-Path -LiteralPath $stderrPath) {
    Write-Info "stderr last 20 lines: $stderrPath"
    Get-Content -LiteralPath $stderrPath -Tail 20 -ErrorAction SilentlyContinue
  } else {
    Write-Info "stderr log not found: $stderrPath"
  }
}

function Invoke-Doctor {
  $state = Read-ServiceState
  Write-Info "Doctor for $AppName"
  Write-Info "Root: $Root"
  Write-Info "State: $StatePath"
  $servers = @(Get-RepoServerProcesses)
  if ($servers.Count -eq 0) {
    Write-Info "No node process command line contains this repository and src/backend/server.mjs."
  } else {
    $rows = foreach ($server in $servers) {
      $ports = @($server.ports)
      $labels = @()
      $statePid = [int](Get-PropertyValue -Object $state -Name 'pid' -Default 0)
      if ($statePid -gt 0 -and $statePid -eq [int]$server.pid) {
        $labels += 'current'
      } else {
        $labels += 'stale'
      }
      if ($ports.Count -eq 0 -or ($ports -notcontains $Port)) {
        $labels += 'wrong-port'
      }
      [pscustomobject]@{
        pid = [int]$server.pid
        ports = if ($ports.Count) { $ports -join ',' } else { 'none' }
        marker = $labels -join ','
        commandLine = [string]$server.commandLine
      }
    }
    $rows | Format-Table -AutoSize -Wrap
  }

  Write-Info 'Repair suggestions:'
  Write-Host '  - Run npm run dev:status to compare state, listener, health, and runtime.'
  Write-Host '  - Run npm run dev:restart to replace stale or wrong-port yeswood services.'
  Write-Host '  - If port 4200 is non-yeswood, close that process or choose an explicit user-approved port.'
}

try {
  switch ($Command) {
    'start' {
      Invoke-WithServiceLock {
        Start-DashboardService
      }
    }
    'stop' {
      Invoke-WithServiceLock {
        Stop-RegisteredService -StopAll:$Force
      }
    }
    'restart' {
      Invoke-WithServiceLock {
        Stop-RegisteredService -StopAll:$true
        Start-DashboardService
      }
    }
    'status' {
      Show-Status
    }
    'open' {
      $state = Read-ServiceState
      if (-not $state) {
        throw "No service state found: $StatePath"
      }
      $statePort = [int](Get-PropertyValue -Object $state -Name 'port' -Default $Port)
      $stateUrl = [string](Get-PropertyValue -Object $state -Name 'url' -Default $Url)
      if (-not (Invoke-Health -ListenPort $statePort)) {
        throw "Registered service is not healthy at $stateUrl. Run npm run dev:restart."
      }
      Open-ServiceUrl -OpenUrl $stateUrl
    }
    'doctor' {
      Invoke-Doctor
    }
  }
} catch {
  Write-Host "[dashboard] ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
