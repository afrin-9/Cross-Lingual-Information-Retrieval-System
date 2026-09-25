# Start the CLIR web app with the clir_env conda Python (no `conda activate` needed).
# Usage (from anywhere):  .\webapp\run.ps1            -> http://localhost:8000
#                         .\webapp\run.ps1 -Port 9000 -Reload
param([int]$Port = 8000, [switch]$Reload)

$python = Join-Path $env:USERPROFILE "miniconda3\envs\clir_env\python.exe"
if (-not (Test-Path $python)) {
    Write-Error "clir_env Python not found at $python"
    exit 1
}

$uvicornArgs = @("-m", "uvicorn", "main:app", "--app-dir", (Join-Path $PSScriptRoot "backend"), "--port", $Port)
if ($Reload) { $uvicornArgs += "--reload" }

Write-Host "Starting on http://localhost:$Port (Ctrl+C to stop)"
& $python @uvicornArgs
