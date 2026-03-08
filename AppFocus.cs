using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;

public class AppFocus {
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int dwProcessId);
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);

    const int SW_RESTORE = 9;
    const int SW_SHOW = 5;
    const int SW_SHOWNORMAL = 1;
    const int ASFW_ANY = -1;

    static void Main(string[] args) {
        if (args.Length == 0) {
            Console.Error.WriteLine("Usage: AppFocus.exe --hwnd <handle> | <pid> [process_name]");
            Environment.Exit(1);
        }

        try {
            // Allow any process to set foreground window
            AllowSetForegroundWindow(ASFW_ANY);

            // Simulate Alt key press/release to allow SetForegroundWindow to work
            keybd_event(0x12, 0, 0, UIntPtr.Zero); // Alt down
            keybd_event(0x12, 0, 2, UIntPtr.Zero); // Alt up

            // Mode 1: Focus specific window by HWND
            if (args[0] == "--hwnd") {
                if (args.Length < 2) { Console.Error.WriteLine("Missing hwnd value"); Environment.Exit(1); }
                long hwndVal;
                if (!long.TryParse(args[1], out hwndVal)) { Console.Error.WriteLine("Invalid hwnd"); Environment.Exit(1); }
                IntPtr hwnd = new IntPtr(hwndVal);
                FocusWindowAggressive(hwnd);
                Environment.Exit(0);
            }

            // Mode 2: Focus by PID (original behaviour)
            int pid;
            if (!int.TryParse(args[0], out pid)) {
                Console.Error.WriteLine("Invalid PID");
                Environment.Exit(1);
            }

            string processName = args.Length > 1 ? args[1] : null;
            if (processName != null && processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
                processName = processName.Substring(0, processName.Length - 4);
            }

            // Try by PID first
            if (TryFocusPid(pid)) {
                Environment.Exit(0);
            }

            // Fallback: Try by name if provided
            if (!string.IsNullOrEmpty(processName)) {
                Process[] processes = Process.GetProcessesByName(processName);
                foreach (Process p in processes) {
                    if (TryFocusPid(p.Id)) {
                        Environment.Exit(0);
                    }
                }
            }

            Console.Error.WriteLine("No window found for PID " + pid + (processName != null ? " or process " + processName : ""));
            Environment.Exit(1);

        } catch (Exception ex) {
            Console.Error.WriteLine("Error: " + ex.Message);
            Environment.Exit(1);
        }
    }

    static void FocusWindowAggressive(IntPtr hwnd) {
        // Get foreground window's thread
        IntPtr foregroundWnd = GetForegroundWindow();
        uint unusedPid1, unusedPid2;
        uint foregroundThread = GetWindowThreadProcessId(foregroundWnd, out unusedPid1);
        uint currentThread = GetCurrentThreadId();
        uint targetThread = GetWindowThreadProcessId(hwnd, out unusedPid2);

        // Attach to foreground thread to get permission to set foreground window
        bool attached = false;
        if (foregroundThread != currentThread) {
            attached = AttachThreadInput(currentThread, foregroundThread, true);
        }

        try {
            // Restore if minimized
            if (IsIconic(hwnd)) {
                ShowWindow(hwnd, SW_RESTORE);
            }

            // Multiple attempts to focus the window
            // Method 1: SwitchToThisWindow - most aggressive, works across virtual desktops
            SwitchToThisWindow(hwnd, true);

            // Small delay to let the desktop switch happen
            Thread.Sleep(50);

            // Method 2: BringWindowToTop + SetForegroundWindow
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);

            // Method 3: Show window again to ensure visibility
            ShowWindow(hwnd, SW_SHOW);

        } finally {
            // Detach thread input
            if (attached) {
                AttachThreadInput(currentThread, foregroundThread, false);
            }
        }
    }

    static bool TryFocusPid(int pid) {
        bool focused = false;
        EnumWindows((hWnd, lParam) => {
            uint windowPid;
            GetWindowThreadProcessId(hWnd, out windowPid);

            if (windowPid == (uint)pid) {
                // Must have a title or be visible
                int len = GetWindowTextLength(hWnd);
                if (len > 0 || IsWindowVisible(hWnd)) {
                    FocusWindowAggressive(hWnd);
                    focused = true;
                    return false; // Stop enumerating
                }
            }
            return true;
        }, IntPtr.Zero);

        return focused;
    }

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
