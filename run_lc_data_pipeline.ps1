<#
.SYNOPSIS
    Builds the land-cover terrain bundle for the PAMS8 Placement Advisor.

.DESCRIPTION
    Activates the pipeline's Python virtual environment (tools\terrain-pipeline\.venv,
    created and filled from requirements.txt if missing or out of date) and runs the
    pipeline steps that the Makefile in that folder defines, in order:

        fetch -> grid -> derive -> classify -> profiles -> tile -> validate -> package

    There is no `make` on a stock Windows machine, so the steps are run directly here with
    the same skip-if-done behaviour (a step with a work\<step>\.done stamp is skipped unless
    an earlier step re-ran, or -Force is used).

    The GDAL command-line tools (gdalwarp, gdal_rasterize, ogr2ogr, ...) must be reachable.
    If they are not on PATH, the script looks in -GdalBin, $env:GDAL_BIN, an installed QGIS
    (C:\Program Files\QGIS *\bin) and OSGeo4W, and appends the first match to PATH for this
    run only.

    WARNING: `fetch` downloads several GB of open data (ESA WorldCover, JRC water, Copernicus
    DEM, OSM) and the grid is ~2 billion pixels at 30 m. Expect tens of GB of disk and hours
    of run time. Check tools\terrain-pipeline\sources.lock (URLs are marked "verify") first.

.EXAMPLE
    .\run_lc_data_pipeline.ps1 -Check
    Set up the venv, install packages, find GDAL, print a summary. Runs no pipeline step.

.EXAMPLE
    .\run_lc_data_pipeline.ps1
    Full run (skips steps that already completed).

.EXAMPLE
    .\run_lc_data_pipeline.ps1 -RulesOnly
    After editing rules.yaml / classes.yaml: re-run profiles -> package only.

.EXAMPLE
    .\run_lc_data_pipeline.ps1 -From derive -ZMax 12 -Workers 8
    Re-run from the derive step onward.

.EXAMPLE
    .\run_lc_data_pipeline.ps1 -DryRun
    Print the commands that would run; execute nothing and change nothing.

    If script execution is blocked:
        powershell -ExecutionPolicy Bypass -File .\run_lc_data_pipeline.ps1
#>
[CmdletBinding()]
param(
    # Run only these steps (forced, ignoring stamps).
    [ValidateSet('fetch', 'grid', 'derive', 'classify', 'profiles', 'tile', 'validate', 'package')]
    [string[]] $Only,

    # Run this step and everything after it (forced).
    [ValidateSet('fetch', 'grid', 'derive', 'classify', 'profiles', 'tile', 'validate', 'package')]
    [string] $From,

    # rules.yaml / classes.yaml changed: re-run profiles, tile, validate, package.
    [switch] $RulesOnly,

    # Ignore .done stamps and re-run every step.
    [switch] $Force,

    # Set up the venv, packages and GDAL, print a summary, then stop.
    [switch] $Check,

    # Print what would run; execute nothing and change nothing.
    [switch] $DryRun,

    # Do not run pip install (use the venv as it is).
    [switch] $SkipInstall,

    # Base Python (3.11+) used only to create the venv. Default: auto-detect.
    [string] $Python,

    # Folder with the GDAL command-line tools. Default: PATH, then QGIS / OSGeo4W.
    [string] $GdalBin,

    # HYBRID build: the NCGDB geodatabase (.gdb folder) to combine with the open data.
    # Default: $env:NCGDB_PATH, else the path in classes.yaml if that folder exists, else open data only.
    [string] $Ncgdb,

    # Open data only: ignore the NCGDB even if it is present (the bundle is then not restricted).
    [switch] $NoNcgdb,

    # What bounds the data:
    #   frame (default) = the extent of the Survey of Pakistan relief map (a plain rectangle, see -Frame):
    #                     all of Jammu & Kashmir, Gilgit-Baltistan and the Junagadh inset are inside it, and
    #                     nothing inside the rectangle is clipped
    #   official        = a clip polygon of the Survey of Pakistan border built from the NCGDB
    #   osm             = OpenStreetMap's boundary (stops at the Line of Control: Indian-administered
    #                     Kashmir is NOT covered)
    # -Boundary <geojson> overrides all of them with a polygon of your own. 'official' needs the NCGDB.
    [ValidateSet('frame', 'official', 'osm')]
    [string] $BoundaryMode = 'frame',

    # West,south,east,north (WGS84) of the data extent for -BoundaryMode frame.
    # Default 59.5,20.5,80.5,37.5 = the Survey of Pakistan relief-map sheet (+ the Junagadh inset in the south).
    [string] $Frame = '',

    # Pipeline settings (same names and defaults as the Makefile).
    # -Aoi is normally NOT needed: it is taken from the boundary (west,south,east,north in WGS84).
    [string] $Aoi = '',
    [int]    $ResM = 30,                      # target ground resolution in metres
    [int]    $ZMin = 8,
    [int]    $ZMax = 12,
    [int]    $Workers = 4,
    [int]    $Block = 2048,                   # processing block in px; lower it on small RAM
    [string] $OutDir = 'out\terrain-bundle',  # must be inside tools\terrain-pipeline (it is wiped by `tile`)
    [string] $Boundary = ''                   # optional GeoJSON clip polygon (default: OSM admin_level=2)
)

$ErrorActionPreference = 'Stop'
$script:BoundParams = $PSBoundParameters      # functions cannot see the script's own bound parameters

$RepoRoot    = $PSScriptRoot
$PipelineDir = Join-Path $RepoRoot 'tools\terrain-pipeline'
$VenvDir     = Join-Path $PipelineDir '.venv'
$VenvPy      = Join-Path $VenvDir 'Scripts\python.exe'
$ReqFile     = Join-Path $PipelineDir 'requirements.txt'
$ReqStamp    = Join-Path $VenvDir '.requirements.sha256'

$AllSteps = @('fetch', 'grid', 'derive', 'classify', 'profiles', 'tile', 'validate', 'package')
$Stamps = @{
    fetch    = 'work\raw\.done'
    grid     = 'work\grid\.done'
    derive   = 'work\derive\.done'
    classify = 'work\classify\.done'
    profiles = 'work\profiles\.done'
    tile     = 'work\tile\.done'
}
$GdalTools = @('gdalwarp', 'gdal_rasterize', 'gdal_translate', 'gdalbuildvrt', 'ogr2ogr')

function Write-Step([string] $m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Info([string] $m) { Write-Host "    $m" }
function Write-Warn([string] $m) { Write-Host "WARNING: $m" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------------------------
# Python / venv
# ---------------------------------------------------------------------------------------------

# Returns "major.minor" when $exe is a working Python >= 3.11, otherwise $null.
function Get-PythonVersion([string] $exe) {
    try {
        $v = & $exe -c "import sys; print('%d.%d' % sys.version_info[:2])"
        if ($LASTEXITCODE -ne 0 -or -not $v) { return $null }
    } catch { return $null }
    $parts = "$v".Trim().Split('.')
    if ([int]$parts[0] -lt 3 -or ([int]$parts[0] -eq 3 -and [int]$parts[1] -lt 11)) { return $null }
    return "$v".Trim()
}

function Find-BasePython {
    if ($Python) {
        if (-not (Test-Path $Python)) { throw "-Python '$Python' does not exist." }
        if (-not (Get-PythonVersion $Python)) { throw "-Python '$Python' is not a working Python 3.11+." }
        return (Resolve-Path $Python).Path
    }
    # The py launcher knows the real interpreters (the bare `python` on PATH is often the Store stub).
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($sel in '-3.13', '-3.12', '-3.11') {
            try { $exe = & py $sel -c "import sys; print(sys.executable)" } catch { continue }
            if ($LASTEXITCODE -eq 0 -and $exe -and (Get-PythonVersion "$exe".Trim())) { return "$exe".Trim() }
        }
    }
    $roots = @("$env:LOCALAPPDATA\Programs\Python", "$env:ProgramFiles")
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        foreach ($d in (Get-ChildItem $root -Directory -Filter 'Python3*' | Sort-Object Name -Descending)) {
            $exe = Join-Path $d.FullName 'python.exe'
            if ((Test-Path $exe) -and (Get-PythonVersion $exe)) { return $exe }
        }
    }
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notmatch 'WindowsApps' -and (Get-PythonVersion $cmd.Source)) { return $cmd.Source }
    throw "Python 3.11+ not found. Install it from python.org, or pass -Python <path to python.exe>."
}

function Initialize-Venv {
    if (-not (Test-Path $VenvPy)) {
        $base = Find-BasePython
        Write-Step "Creating virtual environment .venv with $base"
        & $base -m venv $VenvDir
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPy)) { throw "Could not create the virtual environment at $VenvDir." }
    }
    $ver = Get-PythonVersion $VenvPy
    if (-not $ver) { throw "The venv at $VenvDir is broken or older than Python 3.11. Delete the .venv folder and run this script again." }
    return $ver
}

function Enter-Venv {
    $activate = Join-Path $VenvDir 'Scripts\Activate.ps1'
    try {
        . $activate
    } catch {
        # Execution policy can block Activate.ps1; this is exactly what it does.
        $env:VIRTUAL_ENV = $VenvDir
        $env:PATH = (Join-Path $VenvDir 'Scripts') + ';' + $env:PATH
    }
    Write-Info "venv active: $env:VIRTUAL_ENV"
}

function Install-Requirements {
    if ($SkipInstall) { Write-Info 'pip install skipped (-SkipInstall)'; return }
    $hash = (Get-FileHash $ReqFile -Algorithm SHA256).Hash
    $have = if (Test-Path $ReqStamp) { (Get-Content $ReqStamp -Raw).Trim() } else { '' }
    if ($have -eq $hash) { Write-Info 'requirements.txt unchanged since last install'; return }
    Write-Step 'Installing requirements.txt into the venv'
    & $VenvPy -m pip install -r $ReqFile
    if ($LASTEXITCODE -ne 0) { throw 'pip install failed. See the output above.' }
    Set-Content -Path $ReqStamp -Value $hash -Encoding ASCII
}

function Test-PythonPackages {
    & $VenvPy -c "import numpy, scipy, rasterio, pyogrio, shapely, yaml, PIL"
    if ($LASTEXITCODE -ne 0) { throw 'Required Python packages are missing from the venv. Run again without -SkipInstall.' }
    $v = & $VenvPy -c "import numpy, scipy, rasterio, pyogrio, shapely; print('numpy', numpy.__version__, '| scipy', scipy.__version__, '| rasterio', rasterio.__version__, '| pyogrio', pyogrio.__version__, '| shapely', shapely.__version__)"
    Write-Info $v
}

# ---------------------------------------------------------------------------------------------
# GDAL command-line tools
# ---------------------------------------------------------------------------------------------

function Test-GdalOnPath {
    foreach ($t in $GdalTools) { if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { return $false } }
    return $true
}

function Test-GdalDir([string] $dir) {
    foreach ($t in $GdalTools) { if (-not (Test-Path (Join-Path $dir "$t.exe"))) { return $false } }
    return $true
}

function Find-GdalDir {
    $cands = New-Object System.Collections.Generic.List[string]
    if ($GdalBin) { $cands.Add($GdalBin) }
    if ($env:GDAL_BIN) { $cands.Add($env:GDAL_BIN) }
    foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($pf -and (Test-Path $pf)) {
            foreach ($q in (Get-ChildItem $pf -Directory -Filter 'QGIS*' | Sort-Object Name -Descending)) { $cands.Add((Join-Path $q.FullName 'bin')) }
        }
    }
    $cands.Add('C:\OSGeo4W\bin')
    $cands.Add('C:\OSGeo4W64\bin')
    foreach ($c in $cands) { if ($c -and (Test-GdalDir $c)) { return (Resolve-Path $c).Path } }
    return $null
}

function Initialize-Gdal {
    if (-not (Test-GdalOnPath)) {
        $dir = Find-GdalDir
        if (-not $dir) {
            throw ("GDAL command-line tools not found ($($GdalTools -join ', ')).`n" +
                   "Install one of: QGIS (https://qgis.org, ships GDAL), OSGeo4W (gdal package), or conda-forge gdal,`n" +
                   "then run again, or pass -GdalBin <folder containing gdalwarp.exe>.")
        }
        # Appended (not prepended) so the venv's python and the system tools keep priority.
        $env:PATH = $env:PATH + ';' + $dir
        Write-Info "GDAL tools added to PATH for this run: $dir"
    }
    $ver = & gdalinfo --version
    Write-Info "GDAL: $ver"
}

# ---------------------------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------------------------

function Resolve-OutDir {
    $full = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $PipelineDir $OutDir }
    $full = [System.IO.Path]::GetFullPath($full).TrimEnd('\')
    $root = [System.IO.Path]::GetFullPath($PipelineDir).TrimEnd('\')
    $reserved = @($root, "$root\scripts", "$root\work", "$root\.venv", "$root\out")
    if (-not $full.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase) -or ($reserved -contains $full)) {
        throw "-OutDir must be a folder inside $root (not $root itself, scripts, work, .venv or out): the tile step deletes it before writing. Copy the finished bundle elsewhere afterwards."
    }
    return $full
}

# Arguments that tell grid.py which clip polygon to use. For the OFFICIAL boundary this first builds it from
# the NCGDB (make_boundary.py); it falls back to OSM, loudly, when there is no NCGDB.
$script:GridBoundaryArgs = @()
function Resolve-BoundaryArgs {
    if ($Boundary) { return @('--boundary', $Boundary, '--boundary-source', 'custom') }
    if ($BoundaryMode -eq 'frame') {
        $fa = @('scripts\make_boundary.py', '--out', 'work\boundary')
        $fa += if ($Frame) { @('--frame', $Frame) } else { @('--frame') }
        if (-not $DryRun) {
            & $VenvPy @fa | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'make_boundary.py --frame failed. See the output above.' }
        }
        return @('--boundary', 'work\boundary\clip.geojson', '--boundary-source', 'frame')
    }
    if ($NoNcgdb -and $BoundaryMode -eq 'official') {
        Write-Warn 'The official boundary is built from the NCGDB, which -NoNcgdb disables: using the OSM boundary. Indian-administered Kashmir will NOT be covered; pass -Boundary <geojson> to include it.'
        return @('--boundary-source', 'osm')
    }
    if ($BoundaryMode -eq 'osm') { return @('--boundary-source', 'osm') }
    if ($DryRun) { return @('--boundary', 'work\boundary\clip.geojson', '--boundary-source', 'official') }
    $mb = @('scripts\make_boundary.py', '--out', 'work\boundary')
    if ($Ncgdb) { $mb += @('--ncgdb', $Ncgdb) }
    $out = & $VenvPy @mb
    if ($LASTEXITCODE -ne 0) { throw 'make_boundary.py failed. See the output above.' }
    $file = Join-Path $PipelineDir 'work\boundary\pakistan_official.geojson'
    if (Test-Path $file) { return @('--boundary', 'work\boundary\clip.geojson', '--boundary-source', 'official') }
    Write-Warn 'No NCGDB found, so the official boundary cannot be built: using the OSM boundary. Indian-administered Kashmir will NOT be covered. Point -Ncgdb at the geodatabase, or pass -Boundary <geojson>.'
    return @('--boundary-source', 'osm')
}

function Get-StepArgs([string] $step, [string] $outDir) {
    $boundaryArgs = $script:GridBoundaryArgs
    switch ($step) {
        'fetch'    { return @('scripts\fetch.py', '--lock', 'sources.lock', '--out', 'work\raw', '--record', '--verify-size') }
        'grid'     {
            $a = @()
            if ($Aoi) { $a = @('--aoi', $Aoi) }
            return @('scripts\grid.py') + $a + @('--zmin', "$ZMin", '--zmax', "$ZMax", '--target-res-m', "$ResM",
                              '--raw', 'work\raw', '--out', 'work\grid') + $boundaryArgs }
        'derive'   {
            $nc = @()
            if ($NoNcgdb) { $nc = @('--ncgdb', 'none') } elseif ($Ncgdb) { $nc = @('--ncgdb', $Ncgdb) }
            return @('scripts\derive.py', '--grid', 'work\grid', '--raw', 'work\raw', '--out', 'work\derive',
                     '--classes', 'classes.yaml', '--block', "$Block", '--workers', "$Workers") + $nc }
        'classify' { return @('scripts\classify.py', '--grid', 'work\grid', '--derive', 'work\derive', '--out', 'work\classify',
                              '--classes', 'classes.yaml', '--block', "$Block") }
        'profiles' { return @('scripts\profiles.py', '--rules', 'rules.yaml', '--classes', 'classes.yaml', '--grid', 'work\grid',
                              '--class-tif', 'work\classify\class.tif', '--out', 'work\profiles', '--block', "$Block") }
        'tile'     { return @('scripts\tile.py', '--grid', 'work\grid', '--class-tif', 'work\classify\class.tif',
                              '--profiles', 'work\profiles', '--out', $outDir, '--workers', "$Workers") }
        'validate' { return @('scripts\validate.py', '--bundle', $outDir, '--golden', 'golden_points.yaml') }
        'package'  { return @('scripts\package.py', '--bundle', $outDir, '--grid', 'work\grid\grid.json',
                              '--rules-json', 'work\profiles\rules.json', '--rules', 'rules.yaml', '--lock', 'sources.lock',
                              '--checksums', 'work\raw\checksums.json', '--zip', 'out\terrain-bundle.zip') }
    }
}

function Invoke-PipelineStep([string] $step, [string] $outDir) {
    # fetch needs the boundary too (it downloads only the DEM tiles the country touches), grid uses it.
    if ($step -eq 'grid' -or $step -eq 'fetch') { $script:GridBoundaryArgs = Resolve-BoundaryArgs }
    $stepArgs = Get-StepArgs $step $outDir
    Write-Step "[$step]"
    Write-Info ("python " + ($stepArgs -join ' '))
    if ($DryRun) { return }

    if ($Stamps.ContainsKey($step)) { Remove-Item (Join-Path $PipelineDir $Stamps[$step]) -Force -ErrorAction SilentlyContinue }
    if ($step -eq 'tile' -and (Test-Path $outDir)) {
        Write-Info "removing previous output $outDir"
        Remove-Item $outDir -Recurse -Force
    }
    if ($step -eq 'package') { New-Item -ItemType Directory -Force (Join-Path $PipelineDir 'out') | Out-Null }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $VenvPy @stepArgs
    if ($LASTEXITCODE -ne 0) { throw "Step '$step' failed (exit code $LASTEXITCODE). Fix the cause, then re-run; completed earlier steps are kept." }
    if ($Stamps.ContainsKey($step)) {
        $stamp = Join-Path $PipelineDir $Stamps[$step]
        New-Item -ItemType Directory -Force (Split-Path $stamp) | Out-Null
        New-Item -ItemType File -Force $stamp | Out-Null
    }
    Write-Info ("done in {0:hh\:mm\:ss}" -f $sw.Elapsed)
}

# If the user switched between hybrid and open-data mode since derive last ran, its output is for the other
# mode: drop the stamps so derive, classify, profiles and tile re-run (derive.py records the mode it used).
function Sync-DataMode {
    $modeFile = Join-Path $PipelineDir 'work\derive\.mode'
    $want = if ($NoNcgdb) { 'open' } elseif ($Ncgdb) { 'hybrid' } else { $null }
    if ($want -and (Test-Path $modeFile)) {
        $have = (Get-Content $modeFile -Raw).Trim()
        if ($have -ne $want) {
            Write-Warn "data mode changed ($have -> $want): derive and every later step will re-run"
            foreach ($s in 'derive', 'classify', 'profiles', 'tile') {
                Remove-Item (Join-Path $PipelineDir $Stamps[$s]) -Force -ErrorAction SilentlyContinue
            }
        }
    }
    # Same for the boundary: a different clip polygon changes the grid and everything after it.
    $bFile = Join-Path $PipelineDir 'work\grid\.boundary'
    # Only when the user chose a mode on this command line (the default 'official' can fall back to OSM
    # without an NCGDB, which would otherwise look like a change on every run).
    $wantB = if ($Boundary) { 'custom' } elseif ($script:BoundParams.ContainsKey('BoundaryMode') -or $BoundaryMode -eq 'frame') { $BoundaryMode } else { $null }
    if ($wantB -and (Test-Path $bFile)) {
        $haveB = (Get-Content $bFile -Raw).Trim()
        if ($haveB -ne $wantB) {
            Write-Warn "boundary changed ($haveB -> $wantB): grid and every later step will re-run"
            foreach ($s in 'grid', 'derive', 'classify', 'profiles', 'tile') {
                Remove-Item (Join-Path $PipelineDir $Stamps[$s]) -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function Get-Selection {
    if ($RulesOnly) { return @{ Steps = @('profiles', 'tile', 'validate', 'package'); Forced = $true } }
    if ($Only)      { return @{ Steps = @($AllSteps | Where-Object { $Only -contains $_ }); Forced = $true } }
    if ($From)      { return @{ Steps = @($AllSteps[([array]::IndexOf($AllSteps, $From))..($AllSteps.Count - 1)]); Forced = $true } }
    return @{ Steps = $AllSteps; Forced = [bool]$Force }
}

# ---------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------

$origPath = $env:PATH
$origVenv = $env:VIRTUAL_ENV
$transcribing = $false
$exitCode = 0
Push-Location $PipelineDir
try {
    if ($ZMax -lt $ZMin) { throw '-ZMax must be >= -ZMin.' }
    if ($Boundary -and -not (Test-Path $Boundary)) { throw "-Boundary file not found: $Boundary" }
    if ($Boundary) { $Boundary = (Resolve-Path $Boundary).Path }
    if ($NoNcgdb -and $Ncgdb) { throw '-Ncgdb and -NoNcgdb are mutually exclusive.' }
    if ($Ncgdb) {
        if (-not (Test-Path -LiteralPath $Ncgdb -PathType Container)) { throw "-Ncgdb folder not found: $Ncgdb" }
        $Ncgdb = (Resolve-Path -LiteralPath $Ncgdb).Path
    }
    $outFull = Resolve-OutDir
    $sel = Get-Selection

    Write-Step 'Land-cover terrain pipeline'
    Write-Info "pipeline : $PipelineDir"
    Write-Info "steps    : $($sel.Steps -join ', ')$(if ($sel.Forced) { '  (forced)' } else { '  (skipping completed steps)' })"
    $aoiText = if ($Aoi) { $Aoi } else { 'from the boundary' }
    Write-Info "settings : AOI=$aoiText  ResM=$ResM  Z=$ZMin..$ZMax  Workers=$Workers  Block=$Block"
    $bText = if ($Boundary) { "custom: $Boundary" } elseif ($BoundaryMode -eq 'frame') { "map frame (rectangle $(if ($Frame) { $Frame } else { 'default: Survey of Pakistan relief-map extent' }), nothing clipped inside)" } elseif ($BoundaryMode -eq 'osm') { 'OpenStreetMap (stops at the Line of Control: Indian-administered Kashmir NOT covered)' } else { 'official (Survey of Pakistan, all of Jammu & Kashmir included; needs the NCGDB)' }
    Write-Info "boundary : $bText"
    $dataMode = if ($NoNcgdb) { 'open data only (NCGDB ignored)' } elseif ($Ncgdb) { "HYBRID with $Ncgdb  (bundle will be RESTRICTED)" } else { 'auto: hybrid if the NCGDB in classes.yaml / $env:NCGDB_PATH exists, else open data only' }
    Write-Info "data     : $dataMode"
    Write-Info "output   : $outFull"

    if ($DryRun) {
        Write-Warn 'DRY RUN - nothing is created, installed or executed.'
    } else {
        Write-Step 'Python environment'
        $pyVer = Initialize-Venv
        Write-Info "venv python: $pyVer ($VenvPy)"
        Enter-Venv
        Install-Requirements
        Test-PythonPackages
    }

    $needsGdal = ($sel.Steps -contains 'grid') -or ($sel.Steps -contains 'derive') -or $Check
    if ($needsGdal -and -not $DryRun) {
        Write-Step 'GDAL command-line tools'
        Initialize-Gdal
    }

    if (-not $DryRun) {
        $drive = Get-PSDrive -Name ([System.IO.Path]::GetPathRoot($PipelineDir).Substring(0, 1)) -ErrorAction SilentlyContinue
        if ($drive) {
            $freeGb = [math]::Round($drive.Free / 1GB, 0)
            Write-Info "free disk on $($drive.Name): ${freeGb} GB"
            if ($freeGb -lt 100 -and ($sel.Steps -contains 'fetch' -or $sel.Steps -contains 'grid' -or $sel.Steps -contains 'derive')) {
                Write-Warn "Under 100 GB free. A full Pakistan run needs tens of GB (the grid is ~2 billion pixels at ZMAX 12). Lower memory use with -Block, or free space first."
            }
        }
    }

    if ($Check) {
        Write-Step 'Check complete - environment is ready. Run again without -Check to build the bundle.'
        return
    }

    if (-not $DryRun) {
        New-Item -ItemType Directory -Force (Join-Path $PipelineDir 'work\logs') | Out-Null
        $log = Join-Path $PipelineDir ("work\logs\run_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))
        try { Start-Transcript -Path $log -Append | Out-Null; $transcribing = $true; Write-Info "log: $log" } catch { }
        if ($sel.Steps -contains 'fetch') {
            Write-Warn 'fetch downloads several GB of open data. It also records source checksums into sources.lock.'
        }
    }

    if (-not $DryRun) { Sync-DataMode }

    if ($RulesOnly -and -not $DryRun) {
        foreach ($s in 'profiles', 'tile') { Remove-Item (Join-Path $PipelineDir $Stamps[$s]) -Force -ErrorAction SilentlyContinue }
    }

    $total = [System.Diagnostics.Stopwatch]::StartNew()
    $cascade = $false
    foreach ($step in $sel.Steps) {
        $stamped = $Stamps.ContainsKey($step)
        $stampOk = $stamped -and (Test-Path (Join-Path $PipelineDir $Stamps[$step]))
        if ($stamped -and $stampOk -and -not $sel.Forced -and -not $cascade) {
            Write-Step "[$step] already done (work\... .done) - skipping"
            continue
        }
        Invoke-PipelineStep $step $outFull
        if ($stamped) { $cascade = $true }   # anything downstream of a re-run step is stale
    }

    if (-not $DryRun) {
        Write-Step ("Pipeline finished in {0:hh\:mm\:ss}" -f $total.Elapsed)
        if (Test-Path $outFull) {
            $mb = [math]::Round((Get-ChildItem $outFull -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
            Write-Info "bundle : $outFull  ($mb MB)"
            Write-Info "zip    : $(Join-Path $PipelineDir 'out\terrain-bundle.zip')"
            Write-Info 'To use it in the harness: copy the folder to public\terrain-bundle (or serve it anywhere and set placement.bundleUrl).'
        }
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
} finally {
    if ($transcribing) { try { Stop-Transcript | Out-Null } catch { } }
    Pop-Location
    $env:PATH = $origPath
    if ($null -eq $origVenv) { Remove-Item Env:VIRTUAL_ENV -ErrorAction SilentlyContinue } else { $env:VIRTUAL_ENV = $origVenv }
}
exit $exitCode
