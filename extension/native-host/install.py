import os
import sys
import platform
import json
import shutil
try:
    import winreg
except ImportError:
    winreg = None

def install():
    print("Cooldesk Sync - Native Bridge Installer")
    print("---------------------------------------")
    
    # 1. Get Extension ID
    extension_id = input("Enter your Chrome Extension ID (found in chrome://extensions): ").strip()
    if not extension_id:
        print("Error: Extension ID is required.")
        return

    # 2. Paths
    current_dir = os.path.dirname(os.path.abspath(__file__))
    host_py_path = os.path.join(current_dir, 'host.py')
    manifest_path = os.path.join(current_dir, 'com.cooldesk.sync.json')
    
    if platform.system() == 'Windows':
        # Windows Setup
        # Create host.bat
        python_executable = sys.executable
        # Use pythonw.exe if possible to avoid console window, but for debugging python.exe is okay.
        # However, stdio requires matching consoles. 
        # Standard practice: use standard python.exe but the chrome process handles the pipes.
        # "python" in bat might use a different python.
        
        bat_path = os.path.join(current_dir, 'host.bat')
        with open(bat_path, 'w') as f:
            f.write(f'@echo off\n"{python_executable}" -u "{host_py_path}" %*')
        
        print(f"Created {bat_path}")
        
        # Update Manifest path to absolute path of bat
        manifest_content = {
            "name": "com.cooldesk.sync",
            "description": "Cooldesk Native Bridge",
            "path": bat_path,
            "type": "stdio",
            "allowed_origins": [f"chrome-extension://{extension_id}/"]
        }
        
        # Write final manifest
        with open(manifest_path, 'w') as f:
            json.dump(manifest_content, f, indent=2)
            
        # Registry Key
        key_path = r"Software\Google\Chrome\NativeMessagingHosts\com.cooldesk.sync"
        try:
            key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path)
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, manifest_path)
            winreg.CloseKey(key)
            print(f"Registered Native Host in HKCU\\{key_path}")
        except Exception as e:
            print(f"Error modifying registry: {e}")
            
    else:
        # macOS / Linux Setup
        # Create executable wrapper or just use python directly in manifest?
        # Manifest "path" can be absolute path to python script if executable.
        
        os.chmod(host_py_path, 0o755)
        
        # On Unix, we often use a shell wrapper to ensure correct environment
        wrapper_path = os.path.join(current_dir, 'host.sh')
        with open(wrapper_path, 'w') as f:
            f.write(f'#!/bin/sh\n"{sys.executable}" -u "{host_py_path}" "$@"\n')
        os.chmod(wrapper_path, 0o755)
        
        manifest_content = {
            "name": "com.cooldesk.sync",
            "description": "Cooldesk Native Bridge",
            "path": wrapper_path,
            "type": "stdio",
            "allowed_origins": [f"chrome-extension://{extension_id}/"]
        }
        
        # Location for manifest
        if platform.system() == 'Darwin':
            target_dir = os.path.expanduser("~/Library/Application Support/Google/Chrome/NativeMessagingHosts")
        else:
            target_dir = os.path.expanduser("~/.config/google-chrome/NativeMessagingHosts")
            
        if not os.path.exists(target_dir):
            os.makedirs(target_dir)
            
        target_manifest = os.path.join(target_dir, 'com.cooldesk.sync.json')
        with open(target_manifest, 'w') as f:
            json.dump(manifest_content, f, indent=2)
            
        print(f"Installed manifest to {target_manifest}")

    print("\nInstallation Complete!")
    print("Please reload your extension in Chrome.")

if __name__ == '__main__':
    install()
