# PAMS8 dev bootstrap — installs a project-local (embedded) Node + project deps.
# Re-runnable. Does NOT touch the system PATH, fnm, or the shared node24 install:
# the PATH edit below lives only in this short-lived bootstrap process.
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # faster Invoke-WebRequest (no progress UI)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root    = $PSScriptRoot
$version = 'v24.14.1'
$dist    = "node-$version-win-x64"
$nodeDir = Join-Path $root 'node'

function Test-EmbeddedNode {
  (Test-Path "$nodeDir\node.exe") -and ((& "$nodeDir\node.exe" -v) -eq $version)
}

if (Test-EmbeddedNode) {
  Write-Host "[PAMS8] Embedded Node $version already present."
} else {
  $zip = Join-Path $env:TEMP "$dist.zip"
  $url = "https://nodejs.org/dist/$version/$dist.zip"
  Write-Host "[PAMS8] Downloading $url ..."
  Invoke-WebRequest -Uri $url -OutFile $zip

  # Best-effort integrity check against the official SHASUMS256.txt for this version.
  try {
    $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/SHASUMS256.txt").Content
    $line = $sums -split "`n" | Where-Object { $_ -match [regex]::Escape("$dist.zip") } | Select-Object -First 1
    $want = ($line -split '\s+')[0]
    $got  = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($want -and ($got -ne $want.ToLower())) { throw "SHA256 mismatch (expected $want, got $got)" }
    Write-Host "[PAMS8] SHA256 verified."
  } catch {
    Write-Warning "[PAMS8] Could not verify SHA256 ($($_.Exception.Message)). Continuing."
  }

  if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
  $tmp = Join-Path $env:TEMP 'pams8-node-extract'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  Move-Item (Join-Path $tmp $dist) $nodeDir
  Remove-Item $zip, $tmp -Recurse -Force
  if (-not (Test-EmbeddedNode)) { throw "Embedded Node failed verification after extract." }
  Write-Host "[PAMS8] Embedded Node installed: $(& "$nodeDir\node.exe" -v)"
}

# Install project dependencies using the embedded Node/npm (process-local PATH only).
$env:PATH = "$nodeDir;$root\node_modules\.bin;$env:PATH"
Write-Host "[PAMS8] Installing dependencies with embedded npm ..."
& "$nodeDir\npm.cmd" install
Write-Host "[PAMS8] Done. Use .\build.cmd, .\dev.cmd, .\preview.cmd (or .\pn.cmd <args>)."
