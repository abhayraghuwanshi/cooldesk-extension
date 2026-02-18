using System;
using System.Runtime.InteropServices;
using System.Diagnostics;

public class AppFocus {
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);

    const int SW_RESTORE = 9;
    const int SW_SHOW = 5;

    static void Main(string[] args) {
        if (args.Length == 0) {
            Console.Error.WriteLine("Usage: AppFocus.exe <pid> [process_name]");
            Environment.Exit(1);
        }

        int pid;
        if (!int.TryParse(args[0], out pid)) {
            Console.Error.WriteLine("Invalid PID");
            Environment.Exit(1);
        }

        string processName = args.Length > 1 ? args[1] : null;
        if (processName != null && processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
            processName = processName.Substring(0, processName.Length - 4);
        }
        
        // Simulate Alt key press/release to allow SetForegroundWindow to work
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        
        try {
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

    static bool TryFocusPid(int pid) {
        try {
            Process p = Process.GetProcessById(pid);
            if (p.MainWindowHandle != IntPtr.Zero) {
                if (IsIconic(p.MainWindowHandle)) {
                    ShowWindow(p.MainWindowHandle, SW_RESTORE);
                } else {
                    ShowWindow(p.MainWindowHandle, SW_SHOW);
                }
                SetForegroundWindow(p.MainWindowHandle);
                return true;
            }
        } catch { }
        return false;
    }
}
