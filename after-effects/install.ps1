# Depth Scanner - one-shot Windows installer
# ------------------------------------------
# Installs the Python deps and copies the panel into After Effects'
# ScriptUI Panels folder. Self-elevates for the Program Files copy.
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1

$ErrorActionPreference = "Stop"

# Re-launch as Administrator if needed (Program Files copy requires it).
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Requesting administrator rights for the After Effects copy..."
    Start-Process powershell "-ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs -Wait
    exit
}

$src = $PSScriptRoot

# --- 1. Python dependencies -------------------------------------------
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = (Get-Command python3 -ErrorAction SilentlyContinue).Source }
if ($python) {
    Write-Host "Installing Python dependencies via $python ..."
    & $python -m pip install -r (Join-Path $src "requirements.txt")
} else {
    Write-Warning "Python not found on PATH. Install it from https://python.org (tick 'Add to PATH'),"
    Write-Warning "then run:  pip install -r `"$src\requirements.txt`""
}

# --- 2. Find the newest After Effects ---------------------------------
$adobe = "C:\Program Files\Adobe"
$ae = Get-ChildItem $adobe -Directory -Filter "Adobe After Effects*" -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending | Select-Object -First 1
if (-not $ae) {
    Write-Error "After Effects not found under $adobe - copy the files manually to <AE>\Support Files\Scripts\ScriptUI Panels"
    Read-Host "Press Enter to close"
    exit 1
}
$panels = Join-Path $ae.FullName "Support Files\Scripts\ScriptUI Panels"
if (-not (Test-Path $panels)) { New-Item -ItemType Directory -Path $panels -Force | Out-Null }

# --- 3. Copy the plugin (the .jsx looks for depth_estimate.py beside it)
Copy-Item (Join-Path $src "Depth Scanner.jsx") $panels -Force
Copy-Item (Join-Path $src "depth_estimate.py") $panels -Force
Copy-Item (Join-Path $src "requirements.txt")  $panels -Force

Write-Host ""
Write-Host "================================================================"
Write-Host " Installed to: $panels"
if ($python) { Write-Host " Python path for the panel:  $python" }
Write-Host ""
Write-Host " Last steps (manual, inside After Effects):"
Write-Host "   1. Restart After Effects"
Write-Host "   2. Edit > Preferences > Scripting & Expressions >"
Write-Host "      'Allow Scripts to Write Files and Access Network'  ->  ON"
Write-Host "   3. Window menu (bottom) > Depth Scanner.jsx"
Write-Host "   4. Paste the Python path above into the panel's Python field"
Write-Host "================================================================"
Read-Host "Press Enter to close"
