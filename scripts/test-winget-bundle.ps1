<#
.SYNOPSIS
  Download release installers, verify hashes, generate winget manifests, and optionally install.

.PARAMETER Tag
  Release tag to test (e.g. v1.2.7). Defaults to the latest git tag.

.PARAMETER Install
  After generating and validating manifests, run: winget install --manifest

.PARAMETER SkipValidate
  Skip the winget validate step (useful if winget CLI not installed).

.EXAMPLE
  .\scripts\test-winget-bundle.ps1
  .\scripts\test-winget-bundle.ps1 -Tag v1.2.7
  .\scripts\test-winget-bundle.ps1 -Tag v1.2.7 -Install
#>
param(
    [string]$Tag = "",
    [switch]$Install,
    [switch]$SkipValidate
)

$ErrorActionPreference = "Stop"

$Repo      = "abhayraghuwanshi/cooldesk-extension"
$PkgId     = "CoolDesk.CoolDesk"
$Publisher = "CoolDesk"
$Author    = "Abhay Raghuwanshi"
$PkgName   = "CoolDesk"
$PkgUrl    = "https://github.com/$Repo"

# ── Resolve tag ──────────────────────────────────────────────────────────────
if (-not $Tag) {
    $Tag = git describe --tags --abbrev=0 2>$null
    if (-not $Tag) {
        Write-Error "No tag found. Pass -Tag v1.2.7 or create a git tag first."
        exit 1
    }
}

$Version = $Tag.TrimStart("v")
Write-Host ""
Write-Host "==> Testing winget bundle for $Tag  (package version $Version)" -ForegroundColor Cyan

# ── Fetch release asset URLs via gh CLI ──────────────────────────────────────
Write-Host "==> Fetching release asset URLs from GitHub..."

$releaseJson = (gh release view $Tag --repo $Repo --json assets) -join ""
if (-not $releaseJson) {
    Write-Error "Release $Tag not found or gh is not authenticated."
    exit 1
}
$allAssets = ($releaseJson | ConvertFrom-Json).assets

$nsisAsset = $allAssets | Where-Object { $_.name -like "*setup.exe"   } | Select-Object -First 1
$msiAsset  = $allAssets | Where-Object { $_.name -like "*en-US.msi"   } | Select-Object -First 1

Write-Host "  Found assets:"
$allAssets | ForEach-Object { Write-Host "    $($_.name)" }

if (-not $nsisAsset -and -not $msiAsset) {
    Write-Error "No NSIS (.exe) or MSI installer found in release $Tag."
    exit 1
}

$nsisName = if ($nsisAsset) { $nsisAsset.name } else { $null }
$msiName  = if ($msiAsset)  { $msiAsset.name  } else { $null }

# Construct download URLs from the known GitHub release URL pattern
$baseUrl = "https://github.com/$Repo/releases/download/$Tag"
$nsisUrl = if ($nsisName) { "$baseUrl/$nsisName" } else { $null }
$msiUrl  = if ($msiName)  { "$baseUrl/$msiName"  } else { $null }

# ── Download via gh release download & hash ───────────────────────────────────
$tmpDir = Join-Path $env:TEMP "cooldesk-winget-$Version"
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

Write-Host "==> Downloading installers..."
if ($nsisName) {
    gh release download $Tag --repo $Repo --pattern "*setup.exe" --dir $tmpDir --clobber
}
if ($msiName) {
    gh release download $Tag --repo $Repo --pattern "*_en-US.msi" --dir $tmpDir --clobber
}

$installerEntries = @()

foreach ($entry in @(
    @{ Name = $nsisName; Url = $nsisUrl; IsNsis = $true  },
    @{ Name = $msiName;  Url = $msiUrl;  IsNsis = $false }
)) {
    if (-not $entry.Url) { continue }

    $outPath = Join-Path $tmpDir $entry.Name
    if (-not (Test-Path $outPath)) {
        Write-Error "Expected file not found after download: $outPath"
        exit 1
    }

    $hash = (Get-FileHash -Algorithm SHA256 $outPath).Hash
    Write-Host ""
    Write-Host "  File   : $($entry.Name)" -ForegroundColor Yellow
    Write-Host "  SHA256 : $hash" -ForegroundColor Green
    Write-Host "  URL    : $($entry.Url)"

    $installerEntries += [PSCustomObject]@{
        Architecture    = "x64"
        InstallerType   = if ($entry.IsNsis) { "nullsoft" } else { "msi" }
        Scope           = if ($entry.IsNsis) { "user" }     else { "machine" }
        InstallerUrl    = $entry.Url
        InstallerSha256 = $hash
    }
}

# ── Generate manifest files ──────────────────────────────────────────────────
$manifestDir = Join-Path $tmpDir "manifests"
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null

# PS 5.1 Set-Content -Encoding utf8 writes a BOM; winget rejects it — use explicit no-BOM writer
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
function Write-Manifest($path, $content) {
    [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

# version manifest
Write-Manifest (Join-Path $manifestDir "$PkgId.yaml") @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.version.1.12.0.schema.json

PackageIdentifier: $PkgId
PackageVersion: $Version
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.12.0
"@

# locale manifest
Write-Manifest (Join-Path $manifestDir "$PkgId.locale.en-US.yaml") @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.defaultLocale.1.12.0.schema.json

PackageIdentifier: $PkgId
PackageVersion: $Version
PackageLocale: en-US
Publisher: $Publisher
PublisherUrl: $PkgUrl
PublisherSupportUrl: $PkgUrl/issues
Author: $Author
PackageName: $PkgName
PackageUrl: $PkgUrl
License: Proprietary
ShortDescription: AI-powered desktop workspace manager
Description: CoolDesk is an AI-powered desktop workspace manager that organizes your browser tabs, apps, and workflows. It features a global spotlight search, smart tab grouping, workspace management, and real-time sync across browsers.
Moniker: cooldesk
Tags:
- productivity
- workspace
- tabs
- browser
- ai
ReleaseNotesUrl: $PkgUrl/releases/tag/$Tag
ManifestType: defaultLocale
ManifestVersion: 1.12.0
"@

# installer manifest — build YAML block without leading newline (avoids Installers: null)
$installerBlock = ($installerEntries | ForEach-Object {
    "- Architecture: $($_.Architecture)`n  InstallerType: $($_.InstallerType)`n  Scope: $($_.Scope)`n  InstallerUrl: $($_.InstallerUrl)`n  InstallerSha256: $($_.InstallerSha256)"
}) -join "`n"

Write-Manifest (Join-Path $manifestDir "$PkgId.installer.yaml") @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.installer.1.12.0.schema.json

PackageIdentifier: $PkgId
PackageVersion: $Version
Platform:
- Windows.Desktop
MinimumOSVersion: 10.0.0.0
InstallModes:
- interactive
- silent
- silentWithProgress
UpgradeBehavior: install
ReleaseDate: $(Get-Date -Format "yyyy-MM-dd")
Installers:
$installerBlock
ManifestType: installer
ManifestVersion: 1.12.0
"@

Write-Host ""
Write-Host "==> Manifests written to: $manifestDir" -ForegroundColor Cyan
Get-ChildItem $manifestDir | ForEach-Object { Write-Host "    $($_.Name)" }

# ── winget validate ───────────────────────────────────────────────────────────
if (-not $SkipValidate) {
    Write-Host ""
    Write-Host "==> Running: winget validate --manifest $manifestDir" -ForegroundColor Yellow
    winget validate --manifest $manifestDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Validation failed (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "Validation passed." -ForegroundColor Green
}

# ── optional local install ────────────────────────────────────────────────────
if ($Install) {
    Write-Host ""
    Write-Host "==> Running: winget install --manifest $manifestDir" -ForegroundColor Yellow
    winget install --manifest $manifestDir
}

Write-Host ""
Write-Host "==> Done. Manifests are at: $manifestDir" -ForegroundColor Cyan
Write-Host "    To submit manually, copy that folder to:"
Write-Host "    winget-pkgs/manifests/c/CoolDesk/CoolDesk/$Version/"
