using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

public class AppScanner {
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
        public string name;
        public string path;
        public string source;
    }

    static void Main(string[] args) {
        try {
            // Method 1: Scan Start Menu shortcuts (most reliable)
            ScanStartMenu();

            // Method 2: Scan Program Files directories
            ScanProgramDirs();

            // Method 3: Scan Registry (for apps without shortcuts)
            ScanRegistry();

            // Output JSON
            Console.Write("[");
            bool first = true;
            foreach (var app in apps.Values) {
                if (!first) Console.Write(",");
                first = false;
                Console.Write("{");
                Console.Write("\"id\":\"installed-" + EscapeJson(app.name) + "\",");
                Console.Write("\"name\":\"" + EscapeJson(app.name) + "\",");
                Console.Write("\"title\":\"" + EscapeJson(app.name) + "\",");
                Console.Write("\"path\":\"" + EscapeJson(app.path) + "\",");
                Console.Write("\"type\":\"app\",");
                Console.Write("\"source\":\"" + app.source + "\",");
                Console.Write("\"isRunning\":false");
                Console.Write("}");
            }
            Console.WriteLine("]");

        } catch (Exception ex) {
            Console.Error.WriteLine("Error: " + ex.Message);
            Console.WriteLine("[]");
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

                    string name = Path.GetFileNameWithoutExtension(lnkFile);
                    if (ShouldSkip(name)) continue;

                    string key = name.ToLower();
                    if (!apps.ContainsKey(key)) {
                        apps[key] = new AppInfo { name = name, path = target, source = "startmenu" };
                    }
                } catch { }
            }
        }
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
                                apps[key] = new AppInfo { name = folderName, path = mainExe, source = "programfiles" };
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

                                if (string.IsNullOrEmpty(name) || ShouldSkip(name)) continue;
                                if (string.IsNullOrEmpty(installLocation) || !Directory.Exists(installLocation)) continue;

                                string keyLower = name.ToLower();
                                if (apps.ContainsKey(keyLower)) continue;

                                // Find an exe in install location
                                try {
                                    string[] exeFiles = Directory.GetFiles(installLocation, "*.exe", SearchOption.TopDirectoryOnly);
                                    foreach (string exe in exeFiles) {
                                        if (!ShouldSkip(Path.GetFileNameWithoutExtension(exe))) {
                                            apps[keyLower] = new AppInfo { name = name, path = exe, source = "registry" };
                                            break;
                                        }
                                    }
                                } catch { }
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

                                if (string.IsNullOrEmpty(name) || ShouldSkip(name)) continue;
                                if (string.IsNullOrEmpty(installLocation) || !Directory.Exists(installLocation)) continue;

                                string keyLower = name.ToLower();
                                if (apps.ContainsKey(keyLower)) continue;

                                try {
                                    string[] exeFiles = Directory.GetFiles(installLocation, "*.exe", SearchOption.TopDirectoryOnly);
                                    foreach (string exe in exeFiles) {
                                        if (!ShouldSkip(Path.GetFileNameWithoutExtension(exe))) {
                                            apps[keyLower] = new AppInfo { name = name, path = exe, source = "registry" };
                                            break;
                                        }
                                    }
                                } catch { }
                            }
                        } catch { }
                    }
                }
            }
        } catch { }
    }

    static bool ShouldSkip(string name) {
        if (string.IsNullOrEmpty(name)) return true;
        string lower = name.ToLower();
        return lower.Contains("uninstall") || lower.Contains("setup") ||
               lower.Contains("update") || lower.Contains("helper") ||
               lower.Contains("crash") || lower.Contains("install");
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

    static string EscapeJson(string s) {
        if (string.IsNullOrEmpty(s)) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
    }
}
