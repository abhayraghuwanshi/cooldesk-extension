# build-appscanner.ps1
# Compiles AppScanner.cs and copies the output to src-tauri/bin/
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-appscanner.ps1

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$projectFile = Join-Path $scriptDir "AppScanner.csproj"
$publishDir = Join-Path $scriptDir "publish"
$destination = Join-Path $repoRoot "src-tauri\bin\AppScanner-x86_64-pc-windows-msvc.exe"

# Find dotnet
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    $dotnet = "C:\Program Files\dotnet\dotnet.exe"
    if (-not (Test-Path $dotnet)) {
        Write-Error "dotnet SDK not found. Install from: https://dotnet.microsoft.com/download/dotnet/8.0"
        exit 1
    }
}

Write-Host "Building AppScanner..." -ForegroundColor Cyan

& $dotnet publish $projectFile `
    -c Release `
    -r win-x64 `
    --self-contained true `
    /p:PublishSingleFile=true `
    /p:IncludeNativeLibrariesForSelfExtract=true `
    -o $publishDir

if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

$builtExe = Join-Path $publishDir "AppScanner.exe"
if (-not (Test-Path $builtExe)) {
    Write-Error "Build succeeded but exe not found at: $builtExe"
    exit 1
}

Write-Host "Copying to $destination ..." -ForegroundColor Cyan
Copy-Item -Path $builtExe -Destination $destination -Force

Write-Host "Done. AppScanner.exe -> src-tauri/bin/AppScanner-x86_64-pc-windows-msvc.exe" -ForegroundColor Green
