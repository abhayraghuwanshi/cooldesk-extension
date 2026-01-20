import sys
import json
import struct
import platform
import subprocess
import os

# Check for psutil
try:
    import psutil
except ImportError:
    # We can't log to stdout effectively without breaking the channel, 
    # but we could write to stderr or a log file.
    sys.stderr.write("Error: psutil module is required. Please run: pip install psutil\n")
    sys.exit(1)

def get_message():
    """Read a message from stdin."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        sys.exit(0)
    message_length = struct.unpack('=I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(message)

def send_message(message_content):
    """Send a message to stdout."""
    encoded_content = json.dumps(message_content).encode("utf-8")
    header = struct.pack('=I', len(encoded_content))
    sys.stdout.buffer.write(header)
    sys.stdout.buffer.write(encoded_content)
    sys.stdout.buffer.flush()

def get_system_stats():
    """Get CPU and Memory usage."""
    try:
        cpu_percent = psutil.cpu_percent(interval=None) # Non-blocking
        mem = psutil.virtual_memory()
        return {
            "cpu": cpu_percent,
            "memory": {
                "total": mem.total,
                "available": mem.available,
                "percent": mem.percent,
                "used": mem.used
            }
        }
    except Exception as e:
        return {"error": str(e)}

def get_visible_pids_windows():
    """Get PIDs of processes with visible windows using ctypes (Windows only)."""
    visible_pids = set()
    try:
        import ctypes
        user32 = ctypes.windll.user32
        
        # Constants for Window Styles
        GWL_EXSTYLE = -20
        WS_EX_TOOLWINDOW = 0x00000080
        WS_EX_APPWINDOW = 0x00040000
        GW_OWNER = 4

        # Callback function for EnumWindows
        def enum_windows_proc(hwnd, lParam):
            if user32.IsWindowVisible(hwnd):
                # 1. Get Extended Style
                ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
                
                # 2. Check for Tool Window (exclude unless it forces AppWindow)
                if (ex_style & WS_EX_TOOLWINDOW) and not (ex_style & WS_EX_APPWINDOW):
                    return True # Skip, continue enumeration
                
                # 3. Check for Owner (exclude owned windows unless they force AppWindow)
                # "GetWindow" with GW_OWNER retrieves the owner window
                owner = user32.GetWindow(hwnd, GW_OWNER)
                if owner and not (ex_style & WS_EX_APPWINDOW):
                    return True # Skip, continue enumeration
                
                # 4. Check Title Length (skip empty titles, common for hidden helper windows)
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    pid = ctypes.c_ulong()
                    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                    visible_pids.add(pid.value)
            return True
            
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        user32.EnumWindows(WNDENUMPROC(enum_windows_proc), 0)
    except Exception as e:
        # Fallback if ctypes fails
        pass
    return visible_pids

def get_processes():
    """Get a list of running processes (filtered for UI relevance)."""
    processes = []
    
    # Platform specific filtering
    filter_pids = None
    if platform.system() == "Windows":
        filter_pids = get_visible_pids_windows()

    # Iterate over all running processes
    for proc in psutil.process_iter(['pid', 'name', 'memory_info', 'exe']):
        try:
            # Basic filters
            if not proc.info['name']:
                continue
                
            pid = proc.info['pid']
            
            # If we have a filter set (Windows), check it
            if filter_pids is not None:
                if pid not in filter_pids:
                    continue
            
            # Additional cleanup: Filter out known noise if needed
            # e.g. "ApplicationFrameHost.exe" often hosts UWP apps but isn't the app itself, 
            # but sometimes it's the only visible one. We'll stick to visible window filter first.

            processes.append({
                "pid": pid,
                "name": proc.info['name'],
                "exe": proc.info['exe'] or "",
                "memory": proc.info['memory_info'].rss if proc.info['memory_info'] else 0
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
            
    # Deduplicate by Name (keep highest memory usage) to avoid clutter
    # Many apps (like Chrome/Edge) have multiple processes but we often only care about one "App" entry.
    # However, if we filter by visible windows, we might still get multiple windows.
    # Let's group by name and only show the one with the highest memory use (likely the main process).
    
    unique_apps = {}
    for p in processes:
        name = p['name']
        if name not in unique_apps or p['memory'] > unique_apps[name]['memory']:
            unique_apps[name] = p
            
    sorted_processes = sorted(unique_apps.values(), key=lambda p: p['memory'], reverse=True)
    return sorted_processes[:50] 

def launch_app(app_name_or_path):
    """Launch an application."""
    system = platform.system()
    try:
        if system == "Windows":
            # Start via shell
            os.startfile(app_name_or_path)
        elif system == "Darwin": # macOS
            subprocess.Popen(["open", "-a", app_name_or_path])
        elif system == "Linux":
            subprocess.Popen(["xdg-open", app_name_or_path])
        return {"status": "success", "launched": app_name_or_path}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def process_message(msg):
    """Dispatch commands based on message content."""
    cmd = msg.get("command")
    
    if cmd == "ping":
        send_message({"response": "pong", "version": "1.0.0"})
    
    elif cmd == "get_system_stats":
        stats = get_system_stats()
        send_message({"command": "system_stats", "data": stats})
        
    elif cmd == "get_processes":
        procs = get_processes()
        send_message({"command": "process_list", "data": procs})
        
    elif cmd == "launch_app":
        app_name = msg.get("app")
        if app_name:
            result = launch_app(app_name)
            send_message({"command": "launch_result", "data": result})
        else:
            send_message({"status": "error", "message": "No app name provided"})
            
def focus_window(pid):
    """Bring a window with the given PID to the foreground (Windows only)."""
    try:
        import ctypes
        import time
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        
        # Constants
        GWL_EXSTYLE = -20
        WS_EX_TOOLWINDOW = 0x00000080
        WS_EX_APPWINDOW = 0x00040000
        GW_OWNER = 4
        SW_RESTORE = 9
        SW_SHOW = 5
        
        # We need to find the MAIN window for this PID
        # Using the same strict filtering as get_processes
        target_hwnd = []
        
        def enum_windows_proc(hwnd, lParam):
            if user32.IsWindowVisible(hwnd):
                window_pid = ctypes.c_ulong()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(window_pid))
                
                if window_pid.value == pid:
                    # STRICT FILTERING to find the *actual* app window
                    ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
                    if (ex_style & WS_EX_TOOLWINDOW) and not (ex_style & WS_EX_APPWINDOW):
                        return True
                    
                    owner = user32.GetWindow(hwnd, GW_OWNER)
                    if owner and not (ex_style & WS_EX_APPWINDOW):
                        return True
                        
                    length = user32.GetWindowTextLengthW(hwnd)
                    if length == 0:
                        return True
                        
                    # Found a valid candidate
                    target_hwnd.append(hwnd)
                    return False # Stop enumerating
            return True
            
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        user32.EnumWindows(WNDENUMPROC(enum_windows_proc), 0)
        
        if target_hwnd:
            hwnd = target_hwnd[0]
            
            # --- Aggressive Focus Logic ---
            
            # 1. Trick Windows into thinking user input occurred (Alt key press)
            # This is a common bypass for "Foreground Lock Timeout"
            VK_MENU = 0x12
            user32.keybd_event(VK_MENU, 0, 0, 0) # Press Alt
            user32.keybd_event(VK_MENU, 0, 2, 0) # Release Alt
            
            # 2. Attach Thread Input (The "Velcro" Method)
            current_thread_id = kernel32.GetCurrentThreadId()
            foreground_hwnd = user32.GetForegroundWindow()
            foreground_thread_id = user32.GetWindowThreadProcessId(foreground_hwnd, None)
            target_thread_id = user32.GetWindowThreadProcessId(hwnd, None)
            
            if current_thread_id != foreground_thread_id:
                user32.AttachThreadInput(current_thread_id, foreground_thread_id, True)
            if target_thread_id != current_thread_id:
                user32.AttachThreadInput(current_thread_id, target_thread_id, True)
            
            # 3. Bring to front
            if user32.IsIconic(hwnd):
                user32.ShowWindow(hwnd, SW_RESTORE)
            else:
                 user32.ShowWindow(hwnd, SW_SHOW)
            
            user32.SetForegroundWindow(hwnd)
            
            # Also try SwitchToThisWindow (deprecated but powerful)
            # user32.SwitchToThisWindow(hwnd, True) 

            # 4. Detach
            if current_thread_id != foreground_thread_id:
                user32.AttachThreadInput(current_thread_id, foreground_thread_id, False)
            if target_thread_id != current_thread_id:
                user32.AttachThreadInput(current_thread_id, target_thread_id, False)

            return {"status": "success", "message": f"Focused PID {pid}"}
        else:
            return {"status": "error", "message": f"No launchable window found for PID {pid}"}
            
    except Exception as e:
        return {"status": "error", "message": str(e)}

def process_message(msg):
    """Dispatch commands based on message content."""
    cmd = msg.get("command")
    
    if cmd == "ping":
        send_message({"response": "pong", "version": "1.0.0"})
    
    elif cmd == "get_system_stats":
        stats = get_system_stats()
        send_message({"command": "system_stats", "data": stats})
        
    elif cmd == "get_processes":
        procs = get_processes()
        send_message({"command": "process_list", "data": procs})
        
    elif cmd == "launch_app":
        app_name = msg.get("app")
        if app_name:
            result = launch_app(app_name)
            send_message({"command": "launch_result", "data": result})
        else:
            send_message({"status": "error", "message": "No app name provided"})
            
    elif cmd == "focus_window":
        pid = msg.get("pid")
        if pid:
            result = focus_window(pid)
            send_message({"command": "focus_result", "data": result})
        
    else:
        send_message({"status": "error", "message": f"Unknown command: {cmd}"})

if __name__ == '__main__':
    # Initial CPU call to start the counter (returns 0.0 usually)
    psutil.cpu_percent(interval=None)
    
    while True:
        try:
            msg = get_message()
            process_message(msg)
        except Exception as e:
            # Log error separately if possible, or attempt to send error back
            # But if stdin/stdout is broken, we assume connection close
            # send_message({"error": "Host exception: " + str(e)})
            sys.exit(1)
