# Generates a self-signed code signing cert and outputs the GitHub secret values.
# Run this once on your local machine, then paste the output into GitHub Secrets.
#
# Usage:
#   .\scripts\generate-cert-secret.ps1
#   .\scripts\generate-cert-secret.ps1 -Publisher "CN=Your Name" -Password "yourpassword"

param(
    [string]$Publisher = "",
    [string]$Password  = "",
    [string]$OutPfx    = "$PSScriptRoot\CoolDesk.pfx"
)

Write-Host ""
Write-Host "=== CoolDesk Certificate Generator ===" -ForegroundColor Cyan
Write-Host ""

# --- Collect inputs ---
if (-not $Publisher) {
    Write-Host "Enter your Publisher identity from Microsoft Partner Center." -ForegroundColor Yellow
    Write-Host "  Partner Center -> Account settings -> Legal info -> Publisher display name" -ForegroundColor DarkGray
    Write-Host "  It looks like: CN=Your Name, O=Your Org, ..." -ForegroundColor DarkGray
    Write-Host ""
    $Publisher = Read-Host "Publisher (CN=...)"
}

if (-not $Publisher.StartsWith("CN=")) {
    $Publisher = "CN=$Publisher"
    Write-Host "  -> Using: $Publisher" -ForegroundColor DarkGray
}

if (-not $Password) {
    $SecurePass = Read-Host "Certificate password" -AsSecureString
    $Password   = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePass))
} else {
    $SecurePass = ConvertTo-SecureString -String $Password -Force -AsPlainText
}

Write-Host ""

# --- Create self-signed cert ---
Write-Host "Creating self-signed certificate..." -ForegroundColor Cyan

$existingCert = Get-ChildItem "Cert:\CurrentUser\My" | Where-Object { $_.Subject -eq $Publisher } | Select-Object -First 1
if ($existingCert) {
    Write-Host "  Found existing cert for '$Publisher' — reusing it." -ForegroundColor DarkGray
    $cert = $existingCert
} else {
    $cert = New-SelfSignedCertificate `
        -Type Custom `
        -Subject $Publisher `
        -KeyUsage DigitalSignature `
        -FriendlyName "CoolDesk Store Signing" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
    Write-Host "  Created: $($cert.Thumbprint)" -ForegroundColor Green
}

# --- Export PFX ---
Write-Host "Exporting PFX to: $OutPfx" -ForegroundColor Cyan
Export-PfxCertificate -Cert $cert -FilePath $OutPfx -Password $SecurePass | Out-Null
Write-Host "  Done." -ForegroundColor Green

# --- Base64 encode ---
Write-Host "Encoding to base64..." -ForegroundColor Cyan
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($OutPfx))

# Write base64 to a text file alongside the PFX
$b64File = [IO.Path]::ChangeExtension($OutPfx, ".b64.txt")
$base64 | Out-File -Encoding ascii $b64File
Write-Host "  Saved to: $b64File" -ForegroundColor Green

# --- Output ---
Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host "  Add these two secrets to your GitHub repository:" -ForegroundColor Green
Write-Host "  Repo -> Settings -> Secrets -> Actions -> New secret" -ForegroundColor DarkGray
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Secret 1 — Name:  WINDOWS_CERT_PFX_BASE64" -ForegroundColor Yellow
Write-Host "           Value: (contents of $b64File)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Secret 2 — Name:  WINDOWS_CERT_PASSWORD" -ForegroundColor Yellow
Write-Host "           Value: $Password" -ForegroundColor White
Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Cert thumbprint : $($cert.Thumbprint)" -ForegroundColor DarkGray
Write-Host "Cert subject    : $($cert.Subject)" -ForegroundColor DarkGray
Write-Host "Cert expires    : $($cert.NotAfter.ToString('yyyy-MM-dd'))" -ForegroundColor DarkGray
Write-Host ""
Write-Host "IMPORTANT: Keep CoolDesk.pfx safe — do not commit it to git." -ForegroundColor Red
Write-Host ""

# Remind to add PFX to .gitignore
$gitignore = "$PSScriptRoot\..\gitignore"
$gitignorePath = Resolve-Path "$PSScriptRoot\.." | Join-Path -ChildPath ".gitignore"
if (Test-Path $gitignorePath) {
    $content = Get-Content $gitignorePath -Raw
    if ($content -notmatch "\.pfx") {
        Add-Content $gitignorePath "`n# Code signing certs`n*.pfx`n*.b64.txt"
        Write-Host "Added *.pfx and *.b64.txt to .gitignore" -ForegroundColor DarkGray
    }
}
