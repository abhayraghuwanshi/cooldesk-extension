using System;
using System.Runtime.InteropServices;
using System.Diagnostics;

public class BrowserFocus {
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);

    const int SW_RESTORE = 9;
    const int SW_SHOW = 5;

    static void Main(string[] args) {
        // Simulate Alt key press/release
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        
        string[] browsers = { "chrome", "msedge", "firefox", "brave" };
        
        foreach (var name in browsers) {
            Process[] procs = Process.GetProcessesByName(name);
            foreach (var p in procs) {
                try {
                    if (p.MainWindowHandle != IntPtr.Zero) {
                        IntPtr hwnd = p.MainWindowHandle;
                        uint fgThread;
                        GetWindowThreadProcessId(GetForegroundWindow(), out fgThread);
                        uint curThread = GetCurrentThreadId();
                        AttachThreadInput(curThread, fgThread, true);

                        if (IsIconic(hwnd)) {
                            ShowWindow(hwnd, SW_RESTORE);
                        } else {
                            ShowWindow(hwnd, SW_SHOW);
                        }
                        
                        SetForegroundWindow(hwnd);
                        AttachThreadInput(curThread, fgThread, false);
                        
                        Environment.Exit(0);
                    }
                } catch {
                    // Continue to next process
                }
            }
        }
        
        // No browser found
        Environment.Exit(1);
    }
}
