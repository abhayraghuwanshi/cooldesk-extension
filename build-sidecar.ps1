# Build Sidecar Server for Tauri
Write-Host "Building Sidecar Server..." -ForegroundColor Cyan

# Step 1: Bundle with esbuild
Write-Host "Step 1: Bundling with esbuild..." -ForegroundColor Yellow
npx esbuild sidecar/server.js --bundle --platform=node --outfile=sidecar/server.bundle.cjs --format=cjs --external:ws

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to bundle sidecar" -ForegroundColor Red
    exit 1
}

# Step 2: Compile to exe with pkg
Write-Host "Step 2: Compiling to executable with pkg..." -ForegroundColor Yellow
npx pkg sidecar/server.bundle.cjs --targets node18-win-x64 --output src-tauri/bin/SidecarServer-x86_64-pc-windows-msvc.exe

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to compile sidecar" -ForegroundColor Red
    exit 1
}

Write-Host "Sidecar built successfully!" -ForegroundColor Green
Write-Host "Output: src-tauri/bin/SidecarServer-x86_64-pc-windows-msvc.exe"
