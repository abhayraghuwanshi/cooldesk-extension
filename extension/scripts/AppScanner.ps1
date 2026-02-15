# AppScanner.ps1
# Fast Windows App Scanner - outputs JSON list of installed applications
# Run: powershell -ExecutionPolicy Bypass -File AppScanner.ps1

$apps = @{}

# Method 1: Start Menu Shortcuts (most reliable for user-facing apps)
$startMenuPaths = @(
    [Environment]::GetFolderPath('CommonStartMenu') + '\Programs',
    [Environment]::GetFolderPath('StartMenu') + '\Programs'
)

$shell = New-Object -ComObject WScript.Shell

foreach ($path in $startMenuPaths) {
    if (Test-Path $path) {
        Get-ChildItem $path -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $shortcut = $shell.CreateShortcut($_.FullName)
                $targetPath = $shortcut.TargetPath

                if ($targetPath -and $targetPath -match '\.exe$' -and (Test-Path $targetPath)) {
                    $name = $_.BaseName
                    $key = $name.ToLower()

                    # Skip duplicates and system utilities
                    if (-not $apps.ContainsKey($key) -and
                        $name -notmatch 'uninstall|setup|update|helper|crash') {
                        $apps[$key] = @{
                            name = $name
                            path = $targetPath
                            source = 'startmenu'
                        }
                    }
                }
            } catch {}
        }
    }
}

# Method 2: Program Files directories
$programDirs = @(
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    "$env:LOCALAPPDATA\Programs",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps"
) | Where-Object { $_ -and (Test-Path $_) }

foreach ($dir in $programDirs) {
    Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $folderName = $_.Name
        $folderPath = $_.FullName

        # Find main exe (prefer one matching folder name)
        $exeFiles = Get-ChildItem $folderPath -Filter *.exe -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notmatch 'unins|update|crash|helper|setup' }

        if ($exeFiles) {
            $mainExe = $exeFiles | Where-Object {
                $_.BaseName -ieq $folderName
            } | Select-Object -First 1

            if (-not $mainExe) {
                $mainExe = $exeFiles | Select-Object -First 1
            }

            $key = $folderName.ToLower()
            if (-not $apps.ContainsKey($key)) {
                $apps[$key] = @{
                    name = $folderName
                    path = $mainExe.FullName
                    source = 'programfiles'
                }
            }
        }
    }
}

# Method 3: Registry (for apps without shortcuts)
$regPaths = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

foreach ($regPath in $regPaths) {
    Get-ItemProperty $regPath -ErrorAction SilentlyContinue | ForEach-Object {
        $name = $_.DisplayName
        $installLocation = $_.InstallLocation

        if ($name -and $installLocation -and (Test-Path $installLocation)) {
            $key = $name.ToLower()
            if (-not $apps.ContainsKey($key)) {
                # Try to find exe in install location
                $exe = Get-ChildItem $installLocation -Filter *.exe -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -notmatch 'unins|update|crash|helper' } |
                    Select-Object -First 1

                if ($exe) {
                    $apps[$key] = @{
                        name = $name
                        path = $exe.FullName
                        source = 'registry'
                    }
                }
            }
        }
    }
}

# Convert to array and output JSON
$result = $apps.Values | ForEach-Object {
    @{
        id = "installed-$($_.name)"
        name = $_.name
        title = $_.name
        path = $_.path
        type = 'app'
        source = $_.source
        isRunning = $false
    }
} | Sort-Object { $_.name }

# Output JSON
$result | ConvertTo-Json -Depth 3
