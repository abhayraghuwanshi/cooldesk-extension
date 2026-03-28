using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;
using System.Linq;

public class AppScanner {
    // Virtual Desktop Manager COM Interface (Windows 10+)
    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
    interface IVirtualDesktopManager {
        bool IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow);
        Guid GetWindowDesktopId(IntPtr topLevelWindow);
        void MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
    }

    [ComImport]
    [Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")]
    class VirtualDesktopManager { }

    // For reading .lnk shortcut targets
    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    class ShellLink {}

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("000214F9-0000-0000-C000-000000000046")]
    interface IShellLink {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszFile, int cchMaxPath, IntPtr pfd, int fFlags);
        void GetIDList(out IntPtr ppidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszName, int cchMaxName);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszDir, int cchMaxPath);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszArgs, int cchMaxPath);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
        void GetHotkey(out short pwHotkey);
        void SetHotkey(short wHotkey);
        void GetShowCmd(out int piShowCmd);
        void SetShowCmd(int iShowCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszIconPath, int cchIconPath, out int piIcon);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, int dwReserved);
        void Resolve(IntPtr hwnd, int fFlags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
    }

    [ComImport]
    [Guid("0000010b-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPersistFile {
        void GetClassID(out Guid pClassID);
        void IsDirty();
        void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, int dwMode);
        void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, bool fRemember);
        void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
        void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
    }

    static Dictionary<string, AppInfo> apps = new Dictionary<string, AppInfo>(StringComparer.OrdinalIgnoreCase);

    class AppInfo {
        public string id;
        public string name;
        public string title;
        public string path;
        public string source;
        public string iconBase64;
        public string category; // Start Menu folder category
        public uint pid;
        public bool isRunning;
        public int cloaked;
        public bool isVisible;
        public string desktopId; // Virtual Desktop GUID
        public bool isOnCurrentDesktop; // Quick flag for current desktop
    }

    static bool debug = false;
    static HashSet<string> seenExePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    static Dictionary<string, List<uint>> pathPidMap = new Dictionary<string, List<uint>>(StringComparer.OrdinalIgnoreCase);
    static Dictionary<string, List<uint>> namePidMap = new Dictionary<string, List<uint>>(StringComparer.OrdinalIgnoreCase);
    static HashSet<uint> windowPids = new HashSet<uint>();
    // hwnd (as long) paired with title text — lets us expand to per-window entries downstream
    static Dictionary<uint, List<Tuple<long, string>>> pidToTitles = new Dictionary<uint, List<Tuple<long, string>>>();
    static Dictionary<uint, Tuple<bool, int>> pidToWindowStates = new Dictionary<uint, Tuple<bool, int>>();
    static Dictionary<uint, Guid> pidToDesktopId = new Dictionary<uint, Guid>();
    static Guid currentDesktopId = Guid.Empty;
    static IVirtualDesktopManager vdManager = null;

    static void Main(string[] args) {
        // IMPORTANT: Force UTF-8 output so Rust's read_to_string() can parse it
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        foreach (var arg in args) {
            if (arg == "--debug") debug = true;
        }

        try {
            // Initialize Virtual Desktop Manager (Windows 10+)
            try {
                Type vdmType = Type.GetTypeFromCLSID(new Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a"));
                vdManager = (IVirtualDesktopManager)Activator.CreateInstance(vdmType);
                if (debug) Console.Error.WriteLine("[VirtualDesktop] Manager initialized successfully");
            } catch (Exception e) {
                // Windows 10+ only, gracefully degrade on older systems
                if (debug) Console.Error.WriteLine("[VirtualDesktop] Not available (Windows 10+ required): " + e.Message);
            }

            // Method 1: Scan Start Menu shortcuts (most reliable)
            ScanStartMenu();

            // Method 2: Scan Registry (for apps without shortcuts)
            ScanRegistry();

            // Method 3: Scan Running Processes
            ScanRunning();

            // Final dedup pass: prefer startmenu > registry. Dedup by exe path AND by normalized name.
            var dedupedApps = new Dictionary<string, AppInfo>(StringComparer.OrdinalIgnoreCase);
            var seenFinalPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var seenFinalNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string[] sourceOrder = { "startmenu", "registry", "apppaths", "programfiles" };
            foreach (string src in sourceOrder) {
                foreach (var kvp in apps) {
                    if (kvp.Value.source != src) continue;
                    string exePath = kvp.Value.path ?? "";
                    string normName = NormalizeAppName(kvp.Value.name).ToLower();
                    if (!seenFinalPaths.Contains(exePath) && !seenFinalNames.Contains(normName)) {
                        dedupedApps[kvp.Key] = kvp.Value;
                        if (!string.IsNullOrEmpty(exePath)) seenFinalPaths.Add(exePath);
                        seenFinalNames.Add(normName);
                    }
                }
            }
            apps = dedupedApps;

            // Output JSON: { "installed": [...], "windows": [...] }
            Console.Write("{\"installed\":[");
            bool first = true;
            foreach (var app in apps.Values) {
                if (!first) Console.Write(",");
                first = false;
                Console.Write("{");
                Console.Write("\"id\":\"installed-" + EscapeJson(app.name) + "\",");
                Console.Write("\"name\":\"" + EscapeJson(app.name) + "\",");
                Console.Write("\"path\":\"" + EscapeJson(app.path) + "\",");
                Console.Write("\"source\":\"" + app.source + "\",");
                Console.Write("\"category\":\"" + EscapeJson(app.category ?? "Other") + "\"");
                if (!string.IsNullOrEmpty(app.iconBase64)) {
                    Console.Write(",\"icon\":\"data:image/png;base64," + app.iconBase64 + "\"");
                }
                Console.Write("}");
            }
            Console.Write("],\"windows\":[");

            // Build reverse lookup: pid -> path
            var pidToPath = new Dictionary<uint, string>();
            foreach (var kvp in pathPidMap) {
                foreach (uint pid2 in kvp.Value) {
                    if (!pidToPath.ContainsKey(pid2)) pidToPath[pid2] = kvp.Key;
                }
            }

            bool firstWin = true;
            foreach (uint pid in windowPids) {
                string wPath;
                if (!pidToPath.TryGetValue(pid, out wPath) || string.IsNullOrEmpty(wPath)) continue;

                // Skip Windows OS processes — they're never user-switchable apps.
                // Legitimate System32 user tools (cmd, notepad) are in the installed list via Start Menu
                // so they'll still get isRunning:true via AppMatcher path-matching.
                string exeName = Path.GetFileNameWithoutExtension(wPath);
                if (_windowsOSProcesses.Contains(exeName)) continue;
                string wPathLower = wPath.ToLower();
                if (wPathLower.Contains("\\windows\\system32\\") ||
                    wPathLower.Contains("\\windows\\syswow64\\")) continue;
                List<Tuple<long, string>> titles;
                if (!pidToTitles.TryGetValue(pid, out titles)) titles = new List<Tuple<long, string>>();

                bool isVisible = false;
                int cloaked = 0;
                Tuple<bool, int> state;
                if (pidToWindowStates.TryGetValue(pid, out state)) {
                    isVisible = state.Item1;
                    cloaked = state.Item2;
                }

                bool isOnCurrentDesktop = true;
                string desktopIdStr = null;
                Guid deskId;
                if (pidToDesktopId.TryGetValue(pid, out deskId)) {
                    desktopIdStr = deskId.ToString();
                    isOnCurrentDesktop = (deskId == currentDesktopId);
                }

                if (!firstWin) Console.Write(",");
                firstWin = false;
                Console.Write("{");
                Console.Write("\"pid\":" + pid + ",");
                Console.Write("\"exeName\":\"" + EscapeJson(exeName) + "\",");
                Console.Write("\"path\":\"" + EscapeJson(wPath) + "\",");
                Console.Write("\"titles\":[");
                bool firstTitle = true;
                foreach (var t in titles) {
                    if (!firstTitle) Console.Write(",");
                    firstTitle = false;
                    Console.Write("{\"hwnd\":" + t.Item1 + ",\"text\":\"" + EscapeJson(t.Item2) + "\"}");
                }
                Console.Write("],");
                Console.Write("\"isVisible\":" + (isVisible ? "true" : "false") + ",");
                Console.Write("\"cloaked\":" + cloaked + ",");
                Console.Write("\"isOnCurrentDesktop\":" + (isOnCurrentDesktop ? "true" : "false"));
                if (!string.IsNullOrEmpty(desktopIdStr)) {
                    Console.Write(",\"desktopId\":\"" + desktopIdStr + "\"");
                }
                Console.Write("}");
            }
            Console.WriteLine("]}");

        } catch (Exception ex) {
            Console.Error.WriteLine("Error: " + ex.Message);
            Console.WriteLine("{\"installed\":[],\"windows\":[]}");
        }
    }

    static void ScanStartMenu() {
        string[] startMenuPaths = {
            Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu) + "\\Programs",
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu) + "\\Programs"
        };

        foreach (string startPath in startMenuPaths) {
            if (!Directory.Exists(startPath)) continue;

            foreach (string lnkFile in Directory.GetFiles(startPath, "*.lnk", SearchOption.AllDirectories)) {
                try {
                    string target = GetShortcutTarget(lnkFile);
                    if (string.IsNullOrEmpty(target)) continue;
                    if (!target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) continue;
                    if (!File.Exists(target)) continue;
                    if (ShouldSkipPath(target)) continue;  // Filter by path

                    string name = Path.GetFileNameWithoutExtension(lnkFile);
                    if (name.ToLower().EndsWith(".exe")) name = name.Substring(0, name.Length - 4);

                    // Generic cleanup: Remove common suffixes like "-cli", " (x64)", "(64bit)", etc.
                    name = name.Replace("-cli", "")
                               .Replace(" (x64)", "").Replace(" (x86)", "")
                               .Replace(" (32-bit)", "").Replace(" (64-bit)", "")
                               .Replace(" (64bit)", "").Replace(" (32bit)", "")
                               .Replace(" (64-Bit)", "").Replace(" (32-Bit)", "")
                               .Trim();

                    if (ShouldSkip(name)) continue;

                    // Extract category from Start Menu folder structure
                    string category = "Other";
                    string relativePath = lnkFile.Substring(startPath.Length).TrimStart('\\');
                    string folderPart = Path.GetDirectoryName(relativePath);
                    if (!string.IsNullOrEmpty(folderPart)) {
                        // Use the top-level folder as category (e.g., "Microsoft Office Tools" or "Games")
                        int sep = folderPart.IndexOf('\\');
                        category = sep > 0 ? folderPart.Substring(0, sep) : folderPart;
                    }

                    // Use normalized key so registry entries that strip version/arch will match
                    string key = NormalizeAppName(name).ToLower();
                    if (!apps.ContainsKey(key) && seenExePaths.Add(target)) {
                        apps[key] = new AppInfo {
                            name = name,
                            path = target,
                            source = "startmenu",
                            category = category,
                            iconBase64 = ExtractIconAsBase64(target)
                        };
                    }
                } catch { }
            }
        }
    }

    static void ScanAppPaths() {
        // HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths
        // This is the Windows-curated registry of explicitly launchable apps.
        // These are high-confidence user-facing apps — Chrome, VSCode, Notepad++, etc.
        string[] appPathsKeys = {
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
            @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths"
        };

        foreach (string regPath in appPathsKeys) {
            try {
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(regPath)) {
                    if (key == null) continue;
                    foreach (string subKeyName in key.GetSubKeyNames()) {
                        try {
                            using (RegistryKey subKey = key.OpenSubKey(subKeyName)) {
                                if (subKey == null) continue;

                                // Key name is the exe filename e.g. "chrome.exe"
                                string exeFileName = Path.GetFileNameWithoutExtension(subKeyName);
                                if (string.IsNullOrEmpty(exeFileName)) continue;

                                // Default value is the full path to the exe
                                string exePath = subKey.GetValue(null) as string;
                                if (string.IsNullOrEmpty(exePath)) continue;
                                exePath = exePath.Trim('"').Trim();

                                if (!exePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) continue;
                                if (!File.Exists(exePath)) continue;
                                if (ShouldSkipPath(exePath)) continue;
                                if (ShouldSkipExeName(exeFileName)) continue;

                                // Use a clean display name: title-case the exe name as fallback
                                // Many App Paths entries are bare exe names; a better name comes from file version info
                                string displayName = GetExeProductName(exePath);
                                if (string.IsNullOrEmpty(displayName))
                                    displayName = System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(exeFileName.Replace("-", " ").Replace("_", " "));

                                string keyLower = displayName.ToLower();
                                string exeKeyLower = exeFileName.ToLower();
                                if (apps.ContainsKey(keyLower) || apps.ContainsKey(exeKeyLower)) continue;

                                apps[keyLower] = new AppInfo {
                                    name = displayName,
                                    path = exePath,
                                    source = "apppaths",
                                    iconBase64 = ExtractIconAsBase64(exePath)
                                };
                            }
                        } catch { }
                    }
                }
            } catch { }
        }
    }

    // Read ProductName from the exe's version info — cleaner than using the exe filename
    static string GetExeProductName(string exePath) {
        try {
            var info = System.Diagnostics.FileVersionInfo.GetVersionInfo(exePath);
            if (!string.IsNullOrWhiteSpace(info.ProductName)) return info.ProductName.Trim();
        } catch { }
        return null;
    }

    static void ScanProgramDirs() {
        string[] programDirs = {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps")
        };

        foreach (string dir in programDirs) {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) continue;

            try {
                foreach (string subDir in Directory.GetDirectories(dir)) {
                    try {
                        string folderName = Path.GetFileName(subDir);
                        if (ShouldSkip(folderName)) continue;

                        // Find main exe
                        string[] exeFiles = Directory.GetFiles(subDir, "*.exe", SearchOption.TopDirectoryOnly);
                        string mainExe = null;

                        // Prefer exe matching folder name
                        foreach (string exe in exeFiles) {
                            if (ShouldSkipPath(exe)) continue;  // Filter by path
                            string exeName = Path.GetFileNameWithoutExtension(exe);
                            if (ShouldSkip(exeName)) continue;

                            if (exeName.Equals(folderName, StringComparison.OrdinalIgnoreCase)) {
                                mainExe = exe;
                                break;
                            }
                            if (mainExe == null) mainExe = exe;
                        }

                        if (mainExe != null) {
                            string key = folderName.ToLower();
                            if (!apps.ContainsKey(key)) {
                                apps[key] = new AppInfo { 
                                    name = folderName, 
                                    path = mainExe, 
                                    source = "programfiles",
                                    iconBase64 = ExtractIconAsBase64(mainExe)
                                };
                            }
                        }
                    } catch { }
                }
            } catch { }
        }
    }

    static void ScanRegistry() {
        string[] regPaths = {
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
        };

        foreach (string regPath in regPaths) {
            try {
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(regPath)) {
                    if (key == null) continue;

                    foreach (string subKeyName in key.GetSubKeyNames()) {
                        try {
                            using (RegistryKey subKey = key.OpenSubKey(subKeyName)) {
                                if (subKey == null) continue;

                                string name = subKey.GetValue("DisplayName") as string;
                                string installLocation = subKey.GetValue("InstallLocation") as string;
                                string displayIcon = subKey.GetValue("DisplayIcon") as string;

                                if (string.IsNullOrEmpty(name) || ShouldSkip(name)) continue;

                                // SystemComponent=1 is the Windows flag for "hide from Add/Remove Programs"
                                // Drivers, OEM services, redistributables, and background components all set this.
                                // This replaces almost every OEM name-based heuristic.
                                object sysComp = subKey.GetValue("SystemComponent");
                                if (sysComp is int scInt && scInt == 1) continue;

                                // NoRemove=1 with no install location = system glue, not a user app
                                object noRemove = subKey.GetValue("NoRemove");
                                if (noRemove is int nrInt && nrInt == 1 && string.IsNullOrEmpty(installLocation)) continue;

                                // Normalize name to deduplicate against startmenu entries
                                // e.g. "Beyond Compare 5.0.5" → "beyond compare 5", "Cursor (User)" → "cursor"
                                string normalizedName = NormalizeAppName(name);
                                string keyLower = normalizedName.ToLower();
                                if (apps.ContainsKey(keyLower)) continue;
                                // Also check the original key in case startmenu used the unnormalized name
                                if (apps.ContainsKey(name.ToLower())) continue;

                                // Try InstallLocation first
                                bool added = false;
                                if (!string.IsNullOrEmpty(installLocation) && Directory.Exists(installLocation)) {
                                    try {
                                        string[] exeFiles = Directory.GetFiles(installLocation, "*.exe", SearchOption.TopDirectoryOnly);
                                        foreach (string exe in exeFiles) {
                                            if (ShouldSkipPath(exe)) continue;
                                            if (!ShouldSkip(Path.GetFileNameWithoutExtension(exe)) && seenExePaths.Add(exe)) {
                                                apps[keyLower] = new AppInfo {
                                                    name = normalizedName,
                                                    path = exe,
                                                    source = "registry",
                                                    iconBase64 = ExtractIconAsBase64(exe)
                                                };
                                                added = true;
                                                break;
                                            }
                                        }
                                    } catch { }
                                }

                                // Fallback: use DisplayIcon path (many apps set this even without InstallLocation)
                                if (!added && !string.IsNullOrEmpty(displayIcon)) {
                                    try {
                                        // DisplayIcon may be "C:\path\app.exe,0" — strip the icon index
                                        string iconPath = displayIcon.Split(',')[0].Trim().Trim('"');
                                        if (iconPath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) &&
                                            File.Exists(iconPath) &&
                                            !ShouldSkipPath(iconPath) &&
                                            !ShouldSkip(Path.GetFileNameWithoutExtension(iconPath)) &&
                                            seenExePaths.Add(iconPath)) {
                                            apps[keyLower] = new AppInfo {
                                                name = normalizedName,
                                                path = iconPath,
                                                source = "registry",
                                                iconBase64 = ExtractIconAsBase64(iconPath)
                                            };
                                        }
                                    } catch { }
                                }
                            }
                        } catch { }
                    }
                }
            } catch { }
        }

        // Also check HKCU
        try {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")) {
                if (key != null) {
                    foreach (string subKeyName in key.GetSubKeyNames()) {
                        try {
                            using (RegistryKey subKey = key.OpenSubKey(subKeyName)) {
                                if (subKey == null) continue;

                                string name = subKey.GetValue("DisplayName") as string;
                                string installLocation = subKey.GetValue("InstallLocation") as string;
                                string displayIcon = subKey.GetValue("DisplayIcon") as string;

                                if (string.IsNullOrEmpty(name) || ShouldSkip(name)) continue;

                                object sysComp = subKey.GetValue("SystemComponent");
                                if (sysComp is int scInt2 && scInt2 == 1) continue;

                                string normalizedName = NormalizeAppName(name);
                                string keyLower = normalizedName.ToLower();
                                if (apps.ContainsKey(keyLower)) continue;
                                if (apps.ContainsKey(name.ToLower())) continue;

                                bool added = false;
                                if (!string.IsNullOrEmpty(installLocation) && Directory.Exists(installLocation)) {
                                    try {
                                        string[] exeFiles = Directory.GetFiles(installLocation, "*.exe", SearchOption.TopDirectoryOnly);
                                        foreach (string exe in exeFiles) {
                                            if (ShouldSkipPath(exe)) continue;
                                            if (!ShouldSkip(Path.GetFileNameWithoutExtension(exe)) && seenExePaths.Add(exe)) {
                                                apps[keyLower] = new AppInfo {
                                                    name = normalizedName,
                                                    path = exe,
                                                    source = "registry",
                                                    iconBase64 = ExtractIconAsBase64(exe)
                                                };
                                                added = true;
                                                break;
                                            }
                                        }
                                    } catch { }
                                }

                                if (!added && !string.IsNullOrEmpty(displayIcon)) {
                                    try {
                                        string iconPath = displayIcon.Split(',')[0].Trim().Trim('"');
                                        if (iconPath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) &&
                                            File.Exists(iconPath) &&
                                            !ShouldSkipPath(iconPath) &&
                                            !ShouldSkip(Path.GetFileNameWithoutExtension(iconPath)) &&
                                            seenExePaths.Add(iconPath)) {
                                            apps[keyLower] = new AppInfo {
                                                name = normalizedName,
                                                path = iconPath,
                                                source = "registry",
                                                iconBase64 = ExtractIconAsBase64(iconPath)
                                            };
                                        }
                                    } catch { }
                                }
                            }
                        } catch { }
                    }
                }
            }
        } catch { }
    }

    static void ScanRunning() {
        // Clear maps for each scan
        pathPidMap.Clear();
        namePidMap.Clear();
        windowPids.Clear();
        pidToTitles.Clear();
        pidToWindowStates.Clear();

        // 1. Collect all processes and their paths
        foreach (var proc in System.Diagnostics.Process.GetProcesses()) {
            try {
                uint pid = (uint)proc.Id;
                string path = GetProcessPath(pid);
                if (!string.IsNullOrEmpty(path)) {
                    if (!pathPidMap.ContainsKey(path)) pathPidMap[path] = new List<uint>();
                    pathPidMap[path].Add(pid);
                    
                    string exeName = Path.GetFileNameWithoutExtension(path).ToLower();
                    if (!namePidMap.ContainsKey(exeName)) namePidMap[exeName] = new List<uint>();
                    namePidMap[exeName].Add(pid);
                }
            } catch { }
        }

        // 2. Scan windows to find which processes have UI (including ALL virtual desktops)
        EnumWindows((hWnd, lParam) => {
            // 1. Basic visibility and title check
            bool isVisible = IsWindowVisible(hWnd);
            int length = GetWindowTextLength(hWnd);
            if (length == 0) return true;

            StringBuilder sb = new StringBuilder(length + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            string title = sb.ToString();

            // 2. NOISE FILTER: Skip common background/utility windows
            string titleLower = title.ToLower();
            if (string.IsNullOrWhiteSpace(title) ||
                titleLower == "program manager" ||
                titleLower == "microsoft text input application" ||
                titleLower == "windows input experience" ||
                titleLower == "settings" ||
                titleLower.Contains("msctfime ui") ||
                titleLower.Contains("default ime") ||
                titleLower.Contains("gdi+ window") ||
                titleLower == "cptmsg" || // Zoom helper
                titleLower == "nvcontainer" ||
                titleLower.StartsWith("uwp-") ||
                titleLower == "media context menu" ||
                // System host / service windows
                titleLower == "hidden window" ||
                titleLower == "task host window" ||
                titleLower == "windows push notifications platform" ||
                titleLower == "hcontrol" ||
                // Background event / broadcast windows
                titleLower.StartsWith(".net-broadcasteventwindow") ||
                titleLower.Contains("broadcastlistenerwindow") ||
                titleLower.Contains("messageonly") ||
                titleLower.Contains("ms_webcheck") ||
                titleLower.Contains("wingetmessage") ||
                // GUID-style titles like {5AEA657D-F3F5-...} — message-only sinks
                (title.Length == 38 && title[0] == '{' && title[37] == '}') ||
                // Very short titles (1–2 chars) are never real app windows
                title.Trim().Length <= 2 ||
                // DDE Server Window — universal Windows IPC pattern used by background services
                titleLower == "dde server window" ||
                // Path-as-title: background helpers that set their exe path as window title
                title.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
                // Windows containing "hidden wnd" are explicitly hidden helper windows
                titleLower.Contains("hidden wnd") ||
                // Toast notification windows are internal OS/app infrastructure
                titleLower.EndsWith(" toast") ||
                // Programmatic/class-name-style titles: no spaces and length > 12.
                // Real app windows always have human-readable titles with spaces (e.g. "Visual Studio Code").
                // Background services create windows named after their class: "CrossDeviceResumeWindow",
                // "BluetoothNotificationAreaIconWindowClass", "MediaContextNotificationWindow", etc.
                (!title.Contains(' ') && title.Length > 12)) {
                return true;
            }

            // 3. CLASS FILTER: Background/service window classes are never user-facing app windows.
            // These class names are set by the framework (.NET, NVIDIA driver stack, Realtek driver),
            // not by individual exe names — so this is stable across OEM hardware.
            StringBuilder clsb = new StringBuilder(256);
            GetClassName(hWnd, clsb, clsb.Capacity);
            string cls = clsb.ToString();
            string clsLower = cls.ToLower();
            if (clsLower.StartsWith(".net-broadcasteventwindow") ||  // .NET internal event pump
                clsLower.EndsWith("backgroundprocessclass") ||        // driver/service background class
                clsLower.StartsWith("nvcontainerwindowclass")) {      // NVIDIA container
                return true;
            }

            int cloaked = 0;
            DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, 4);

            // 4. CLOAKED FILTER: 
            // 0 = Visible, 1 = Cloaked by app (usually hidden/suspended), 2 = Cloaked by Shell (Virtual Desktops)
            // We want 0 and 2. We usually want to SKIP 1 as it's often a "zombie" UWP app.
            if (cloaked == 1) return true;

            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);

            // Get Virtual Desktop ID for this window (Windows 10+)
            Guid desktopId = Guid.Empty;
            bool isOnCurrentDesktop = true;
            if (vdManager != null) {
                try {
                    isOnCurrentDesktop = vdManager.IsWindowOnCurrentVirtualDesktop(hWnd);
                    desktopId = vdManager.GetWindowDesktopId(hWnd);

                    // Track current desktop ID from first window we find
                    if (currentDesktopId == Guid.Empty && isOnCurrentDesktop) {
                        currentDesktopId = desktopId;
                    }

                    // Store desktop ID for this PID
                    if (pid != 0 && !pidToDesktopId.ContainsKey(pid)) {
                        pidToDesktopId[pid] = desktopId;
                    }
                } catch {
                    // Ignore errors for windows that don't support virtual desktops
                }
            }

            if (debug) {
                string desktopInfo = desktopId != Guid.Empty ?
                    (isOnCurrentDesktop ? "Current" : "Other:" + desktopId.ToString().Substring(0, 8)) : "N/A";
                Console.Error.WriteLine(string.Format("Window: '{0}' (PID: {1}) Visible: {2}, Cloaked: {3}, Desktop: {4}",
                    title, pid, isVisible, cloaked, desktopInfo));
            }

            // MULTI-DESKTOP SUPPORT: Very permissive filtering
            int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
            bool isToolWindow = (exStyle & WS_EX_TOOLWINDOW) != 0;
            bool isAppWindow = (exStyle & WS_EX_APPWINDOW) != 0;
            IntPtr owner = GetWindow(hWnd, GW_OWNER);
            bool hasOwner = owner != IntPtr.Zero;

            // Skip tool windows UNLESS they're explicitly marked as app windows
            if (!isAppWindow && isToolWindow) return true;

            // CRITICAL: Include windows from other desktops (cloaked > 0)
            // Only skip windows that are:
            // - Not marked as app window AND
            // - Have an owner AND
            // - NOT cloaked (on current desktop) AND
            // - Not visible
            // This means: If cloaked > 0 (other desktop), ALWAYS include!
            if (cloaked == 0 && !isAppWindow && hasOwner && !isVisible) return true;

            if (pid != 0) {
                windowPids.Add(pid);
                if (!pidToTitles.ContainsKey(pid)) pidToTitles[pid] = new List<Tuple<long, string>>();
                if (!string.IsNullOrEmpty(title)) {
                    long hwndVal = hWnd.ToInt64();
                    bool alreadyHave = false;
                    foreach (var t in pidToTitles[pid]) { if (t.Item2 == title) { alreadyHave = true; break; } }
                    if (!alreadyHave) pidToTitles[pid].Add(new Tuple<long, string>(hwndVal, title));
                }

                // Track state for the "best" window we find for this PID
                // Prefer: visible > not visible, uncloaked > cloaked, lower cloaked value
                if (!pidToWindowStates.ContainsKey(pid)) {
                    pidToWindowStates[pid] = new Tuple<bool, int>(isVisible, cloaked);
                } else {
                    var existing = pidToWindowStates[pid];
                    bool existingVisible = existing.Item1;
                    int existingCloaked = existing.Item2;

                    // Replace if this window is "better" (more visible)
                    bool shouldReplace = false;

                    // Priority 1: Visible and uncloaked is best
                    if (isVisible && cloaked == 0 && (!existingVisible || existingCloaked > 0)) {
                        shouldReplace = true;
                    }
                    // Priority 2: Visible but cloaked is better than invisible
                    else if (isVisible && !existingVisible) {
                        shouldReplace = true;
                    }
                    // Priority 3: If both cloaked, prefer lower cloaked value
                    else if (isVisible == existingVisible && cloaked < existingCloaked) {
                        shouldReplace = true;
                    }

                    if (shouldReplace) {
                        pidToWindowStates[pid] = new Tuple<bool, int>(isVisible, cloaked);
                    }
                }
            }

            return true;
        }, IntPtr.Zero);

    }

    static string GetProcessPath(uint pid) {
        StringBuilder sb = new StringBuilder(1024);
        // Try query limited first (standard)
        IntPtr hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (hProcess == IntPtr.Zero) {
            // Fallback to query information (if legacy)
            hProcess = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid);
        }

        if (hProcess != IntPtr.Zero) {
            try {
                int size = sb.Capacity;
                if (QueryFullProcessImageName(hProcess, 0, sb, ref size)) {
                    return sb.ToString();
                }
            } finally {
                CloseHandle(hProcess);
            }
        }
        return null;
    }

    // ShouldSkip: lightweight filter for display names.
    // Heavy lifting (OEM services, system components) is done via SystemComponent=1 in registry.
    // Only filter things that are truly never user-launchable regardless of source.
    static bool ShouldSkip(string name) {
        if (string.IsNullOrEmpty(name)) return true;
        string lower = name.ToLower();

        // Installers, setup, crash handlers, redistributables — never user apps
        if (lower.Contains("uninstall") || lower.Contains("setup") ||
            lower.Contains("installer") || lower.Contains("redistributable") ||
            lower.Contains("vcredist") || lower.Contains("directx")) return true;

        // Start Menu shortcut noise: these appear as .lnk files but aren't launchable apps
        if (lower.Contains("native tools command prompt") ||
            lower.Contains("cross tools command prompt") ||
            lower.Contains("developer command prompt") ||
            lower.Contains("developer powershell for vs")) return true;

        // Module docs, configure/about dialogs that get .lnk shortcuts
        if (lower.Contains("module docs") || lower == "about java" ||
            lower == "configure java") return true;

        // .NET / SDK runtimes — components, not apps
        if (lower.Contains(".net runtime") || lower.Contains(".net sdk") ||
            lower.Contains(".net desktop runtime") || lower.Contains("visual c++ ") ||
            lower.Contains("visual c++ redistributable")) return true;

        // Background services and helpers
        if (lower.EndsWith(" service") || lower.EndsWith(" services") ||
            lower.Contains("sdk service") || lower.Contains("framesdk") ||
            lower.Contains("helper compact") || lower.Contains("nativepush")) return true;

        // Updaters, error reporters, autostart helpers — not user apps
        if (lower.EndsWith(" updater") || lower.Contains("error reporter") ||
            lower.Contains("autostart") || lower == "check for updates") return true;

        // Terminal/shell shortcuts that aren't real apps
        if ((lower.Contains("command prompt") || lower.Contains("powershell prompt")) &&
            lower != "command prompt" && lower != "windows powershell") return true;
        if (lower.Contains("sdk shell") || lower.Contains("cloud tools for powershell")) return true;

        // Office sub-tools (not standalone apps)
        if (lower.Contains("database compare") || lower.Contains("spreadsheet compare") ||
            lower.Contains("telemetry log") || lower.Contains("recording manager") ||
            lower.Contains("language preferences") || lower == "send to onenote") return true;

        // App sub-components / stores
        if (lower == "bluestacks store" || lower.Contains("bluestacks services") ||
            lower.Contains("bluestacks_") || lower == "bluestacks x") return true;

        // LibreOffice Safe Mode shortcut
        if (lower.Contains("safe mode") && lower.Contains("libreoffice")) return true;

        // Windows admin/system tools listed in start menu
        if (lower == "resource monitor" || lower == "recovery drive" || lower == "recoverydrive" ||
            lower == "administrative tools" || lower == "task manager" ||
            lower == "livecaptions" || lower == "live captions") return true;
        if (lower.Contains("windows software development kit") ||
            lower.Contains("windows app cert") ||
            lower.Contains("application verifier") ||
            lower.Contains("powershell ise")) return true;

        // Background services / libraries (not user-launchable apps)
        if (lower == "bonjour" || lower.Contains("riot vanguard") ||
            lower.Contains("frameview sdk") || lower.Contains("framesdk") ||
            lower == "espeak" || lower.StartsWith("espeak ")) return true;

        // Dev version managers / CLI tools registered in Uninstall (no GUI)
        if (lower == "fast node manager" || lower == "fnm") return true;
        // Office suite umbrella entry (individual Office apps come from startmenu)
        if (lower.Contains("365 apps for enterprise") || lower.Contains("office 365")) return true;
        // Git is a CLI tool; Git Bash/CMD/GUI come from startmenu
        if (lower == "git") return true;

        // Misc junk
        if (lower.Contains("antigravity") || lower.Contains("access logs")) return true;
        if (lower.Contains("additional tools for node")) return true;
        if (lower.Contains("microsoft silverlight")) return true;
        if (lower == "ttsapp") return true;

        return false;
    }

    // ShouldSkipExeName: used for App Paths entries where we only have the exe filename.
    // Filters clear non-app exes — background services, updaters, helpers.
    static bool ShouldSkipExeName(string name) {
        if (string.IsNullOrEmpty(name)) return true;
        string lower = name.ToLower();
        if (lower.Contains("unins") || lower.Contains("setup") ||
            lower.Contains("update") || lower.Contains("updater") ||
            lower.Contains("crash") || lower.Contains("helper") ||
            lower.Contains("svc") || lower.EndsWith("service") ||
            lower.Contains("daemon") || lower.Contains("agent") ||
            lower.Contains("launcher") && lower.Contains("helper")) return true;
        return false;
    }

    // Normalize a registry display name for dedup: strip suffixes so names match their start menu equivalents.
    static string NormalizeAppName(string name) {
        if (string.IsNullOrEmpty(name)) return name;
        // Strip " (User)" suffix
        name = System.Text.RegularExpressions.Regex.Replace(name, @"\s*\(User\)\s*$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
        // Strip arch suffixes FIRST so they don't block version stripping
        // e.g. "WinRAR 5.91 (64-bit)" → "WinRAR 5.91" → "WinRAR"
        name = System.Text.RegularExpressions.Regex.Replace(name, @"\s*\((x64|x86|32-bit|64-bit)\)\s*$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
        name = System.Text.RegularExpressions.Regex.Replace(name, @"\s+x64\s*$", "").Trim();
        // Strip trailing version numbers like " 5.0.5", " 1.1", " 7.3", " 11.76.9"
        name = System.Text.RegularExpressions.Regex.Replace(name, @"\s+[\d]+(\.\d+)+\s*$", "").Trim();
        // Strip trailing "version X.X.X" or bare "version" suffix
        name = System.Text.RegularExpressions.Regex.Replace(name, @"\s+version\s+[\d.]+\s*$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
        name = System.Text.RegularExpressions.Regex.Replace(name, @"\s+version\s*$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
        // Strip leading "Microsoft " prefix so "Microsoft Visual Studio Code" matches "Visual Studio Code"
        name = System.Text.RegularExpressions.Regex.Replace(name, @"^Microsoft\s+", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
        return name;
    }

    // Core Windows OS host processes. These are documented OS internals that have been stable
    // for 20+ years and will never be user-launchable apps regardless of system configuration.
    // Kept intentionally small — no OEM/third-party names here.
    private static readonly HashSet<string> _windowsOSProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "svchost", "taskhostw", "wininit", "winlogon", "services", "lsass", "csrss", "smss",
        "RuntimeBroker", "dllhost", "sihost", "WerFault", "conhost",
        "SearchHost", "StartMenuExperienceHost", "ShellExperienceHost", "TextInputHost",
    };

    // Windows admin/system tools that pollute the start menu but aren't user apps.
    // Identified by their exe filename (without extension).
    private static readonly HashSet<string> _systemAdminExeNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        // Admin / maintenance tools
        "dfrgui", "cleanmgr", "iscsicpl", "mdsched", "odbcad32", "recdisc", "recoverydrive",
        "regedit", "resmon", "msconfig", "msinfo32", "psr", "wfs",
        "mstsc", "charmap", "fxscover",
        // Accessibility (rarely searched by name in a spotlight launcher)
        "magnify", "narrator", "osk", "voiceaccess",
        // Legacy media / Office tools
        "wmplayer", "databasecompare", "spreadsheetcompare",
        // Silverlight
        "silverlight",
        // Windows SDK / certification tools
        "appcertui", "appverif"
    };

    static bool ShouldSkipPath(string path) {
        if (string.IsNullOrEmpty(path)) return false;
        string lowerPath = path.ToLower();

        // Windows system-only paths
        if (lowerPath.Contains("c:\\windows\\syswow64") ||
            lowerPath.Contains("c:\\windows\\inf") ||
            lowerPath.Contains("c:\\windows\\resources") ||
            lowerPath.Contains("c:\\windows\\debug") ||
            lowerPath.Contains("c:\\windows\\servicing")) return true;

        // WindowsApps contains raw UWP package folders (e.g. Microsoft.Paint_8wekyb3d8bbwe)
        // These are already captured with clean names via Start Menu shortcuts — skip entirely
        if (lowerPath.Contains("\\windowsapps\\")) return true;

        // Block known Windows admin/system tool executables by name
        string exeName = Path.GetFileNameWithoutExtension(path);
        if (_systemAdminExeNames.Contains(exeName)) return true;

        return false;
    }

    static string GetShortcutTarget(string lnkPath) {
        try {
            ShellLink link = new ShellLink();
            ((IPersistFile)link).Load(lnkPath, 0);
            System.Text.StringBuilder sb = new System.Text.StringBuilder(260);
            ((IShellLink)link).GetPath(sb, sb.Capacity, IntPtr.Zero, 0);
            return sb.ToString();
        } catch {
            return null;
        }
    }

    static string ExtractIconAsBase64(string exePath) {
        try {
            if (string.IsNullOrEmpty(exePath) || !File.Exists(exePath)) return null;
            
            Icon icon = null;
            
            // Method 1: Use SHGetFileInfo (most reliable for all file types)
            try {
                SHFILEINFO shinfo = new SHFILEINFO();
                IntPtr hSuccess = SHGetFileInfo(exePath, 0, ref shinfo, (uint)Marshal.SizeOf(shinfo), 
                    SHGFI_ICON | SHGFI_LARGEICON);
                
                if (hSuccess != IntPtr.Zero && shinfo.hIcon != IntPtr.Zero) {
                    icon = Icon.FromHandle(shinfo.hIcon);
                }
            } catch { }
            
            // Method 2: Try Icon.ExtractAssociatedIcon as fallback
            if (icon == null) {
                try {
                    icon = Icon.ExtractAssociatedIcon(exePath);
                } catch { }
            }
            
            // Method 3: If .lnk file, try to get icon from the target
            if (icon == null && exePath.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase)) {
                try {
                    string target = GetShortcutTarget(exePath);
                    if (!string.IsNullOrEmpty(target) && File.Exists(target)) {
                        SHFILEINFO shinfo = new SHFILEINFO();
                        IntPtr hSuccess = SHGetFileInfo(target, 0, ref shinfo, (uint)Marshal.SizeOf(shinfo), 
                            SHGFI_ICON | SHGFI_LARGEICON);
                        
                        if (hSuccess != IntPtr.Zero && shinfo.hIcon != IntPtr.Zero) {
                            icon = Icon.FromHandle(shinfo.hIcon);
                        }
                    }
                } catch { }
            }
            
            // Convert icon to base64 if we got one
            if (icon != null) {
                try {
                    using (Bitmap bitmap = icon.ToBitmap()) {
                        using (MemoryStream ms = new MemoryStream()) {
                            bitmap.Save(ms, ImageFormat.Png);
                            byte[] imageBytes = ms.ToArray();
                            return Convert.ToBase64String(imageBytes);
                        }
                    }
                } finally {
                    icon.Dispose();
                }
            }
            
            return null;
        } catch {
            return null;
        }
    }
    
    // P/Invoke for SHGetFileInfo (more robust than ExtractAssociatedIcon)
    [DllImport("shell32.dll", CharSet = CharSet.Auto)]
    static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);
    
    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("dwmapi.dll")]
    static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    [DllImport("kernel32.dll")]
    static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern bool QueryFullProcessImageName([In] IntPtr hProcess, [In] int dwFlags, [Out] StringBuilder lpExeName, [In, Out] ref int lpdwSize);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    const int GWL_EXSTYLE = -20;
    const int GWL_STYLE = -16;
    const int WS_EX_TOOLWINDOW = 0x00000080;
    const int WS_EX_APPWINDOW = 0x00040000;
    const uint GW_OWNER = 4;
    const int DWMWA_CLOAKED = 14;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint PROCESS_QUERY_INFORMATION = 0x0400;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    struct SHFILEINFO {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string szTypeName;
    }
    
    const uint SHGFI_ICON = 0x100;
    const uint SHGFI_LARGEICON = 0x0;

    static string EscapeJson(string s) {

        if (string.IsNullOrEmpty(s)) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
    }
}
