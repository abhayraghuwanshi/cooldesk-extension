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
            Console.Error.WriteLine("Usage: AppFocus.exe <pid>");
            Environment.Exit(1);
        }

        int pid;
        if (!int.TryParse(args[0], out pid)) {
            Console.Error.WriteLine("Invalid PID");
            Environment.Exit(1);
        }
        
        // Simulate Alt key press/release to allow SetForegroundWindow to work
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        
        try {
            Process p = Process.GetProcessById(pid);
            if (p.MainWindowHandle != IntPtr.Zero) {
                if (IsIconic(p.MainWindowHandle)) {
                    ShowWindow(p.MainWindowHandle, SW_RESTORE);
                } else {
                    ShowWindow(p.MainWindowHandle, SW_SHOW);
                }
                SetForegroundWindow(p.MainWindowHandle);
                Environment.Exit(0);
            } else {
                Console.Error.WriteLine("No main window found");
                Environment.Exit(1);
            }
        } catch (Exception ex) {
            Console.Error.WriteLine("Error: " + ex.Message);
            Environment.Exit(1);
        }
    }
}
