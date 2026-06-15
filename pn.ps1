# PAMS8 "project node" runner (PowerShell-native). Same isolation as pn.cmd:
# $env:PATH is edited only for the duration of this call and restored afterward,
# so your interactive session, fnm, and node24 are never affected.
# Usage:  .\pn.ps1 run build   |   .\pn.ps1 install   |   .\pn.ps1 run dev
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not (Test-Path "$root\node\node.exe")) {
  Write-Error "[PAMS8] Embedded Node missing. Run: .\setup.ps1"
  exit 1
}
$saved = $env:PATH
try {
  $env:PATH = "$root\node;$root\node_modules\.bin;$saved"
  & "$root\node\npm.cmd" @args
  exit $LASTEXITCODE
} finally {
  $env:PATH = $saved
}
