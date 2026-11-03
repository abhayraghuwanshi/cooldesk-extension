; Runs before files are installed.
; Finds any existing CoolDesk installation (regardless of GUID/version)
; and silently removes it so the new version replaces rather than coexists.
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Checking for existing CoolDesk installation..."

  ; Search HKCU uninstall keys (currentUser installs)
  StrCpy $0 0
  loop_hkcu:
    EnumRegKey $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" done_hkcu
    ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ${If} $2 == "CoolDesk"
      ReadRegStr $3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
      StrCmp $3 "" +3
        DetailPrint "Uninstalling previous version: $2"
        ExecWait '"$3" /S'
    ${EndIf}
    IntOp $0 $0 + 1
    Goto loop_hkcu
  done_hkcu:

  ; Search HKLM uninstall keys (perMachine installs)
  StrCpy $0 0
  loop_hklm:
    EnumRegKey $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" done_hklm
    ReadRegStr $2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ${If} $2 == "CoolDesk"
      ReadRegStr $3 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
      StrCmp $3 "" +3
        DetailPrint "Uninstalling previous version: $2"
        ExecWait '"$3" /S'
    ${EndIf}
    IntOp $0 $0 + 1
    Goto loop_hklm
  done_hklm:
!macroend

; Runs after files and shortcuts are in place.
;
; Records where this install came from, for the anonymous usage ping
; (install_source in lib.rs). One installer serves winget and direct
; downloads, so the build can't know; the command line can:
;   • winget passes /SOURCE=winget (InstallerSwitches: Custom in the manifest)
;   • any other fresh install is "direct"
;   • an in-app update (/UPDATE) leaves the existing answer alone
; Written to the app config dir ($APPDATA\<bundle id>, what Tauri's
; app_config_dir resolves to), so it survives updates; Tauri's own "delete
; application data" option removes it with the rest of that folder.
!macro NSIS_HOOK_POSTINSTALL
  StrCpy $R8 ""
  ClearErrors
  ${GetOptions} $CMDLINE "/SOURCE=" $R9
  ${IfNot} ${Errors}
  ${AndIf} $R9 != ""
    StrCpy $R8 $R9
  ${ElseIf} $UpdateMode <> 1
    StrCpy $R8 "direct"
  ${EndIf}

  ${If} $R8 != ""
    SetShellVarContext current
    CreateDirectory "$APPDATA\${BUNDLEID}"
    ClearErrors
    FileOpen $R7 "$APPDATA\${BUNDLEID}\install_source" w
    ${IfNot} ${Errors}
      FileWrite $R7 $R8
      FileClose $R7
    ${EndIf}
  ${EndIf}
!macroend

; Runs before the uninstaller deletes anything.
;
; Tauri's own CheckIfAppIsRunning (inserted right after this hook) force-kills
; the process, which skips RunEvent::Exit in lib.rs. That handler is the only
; thing that sends ABM_REMOVE for the Workspace Dock's native AppBar — without
; it Windows keeps the reserved screen edge and the user's desktop work area
; stays shrunk with no app left to fix it. So ask for a clean exit first and
; let Tauri's force-kill remain the fallback for a hung process.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    DetailPrint "Asking CoolDesk to shut down..."
    ; --quit is forwarded to the running instance by tauri-plugin-single-instance.
    ; Non-blocking: a hung app must not stall the uninstaller.
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe" --quit'
    Sleep 2000
  ${EndIf}
!macroend

; Runs after files, shortcuts and registry keys are gone.
;
; sync-data (workspaces, notes, activity, tab history) is written to the process
; CWD, which for an installed build is $INSTDIR — so it sits *inside* the
; install folder. Tauri never removes it: the uninstall section only Deletes
; known files and then calls a non-recursive RMDir "$INSTDIR", which fails while
; sync-data is there. The "delete application data" checkbox doesn't help either,
; it only clears $APPDATA\BUNDLEID and $LOCALAPPDATA\BUNDLEID. Result today is an
; orphaned folder full of user data that nothing will ever clean up.
;
; Honour the same two conditions Tauri uses for its own data deletion:
;   • the user ticked the checkbox  — never delete data they didn't ask us to
;   • not an update                 — our NSIS_HOOK_PREINSTALL runs the old
;                                     uninstaller on every update, so deleting
;                                     unconditionally here would wipe the user's
;                                     workspaces on each new version
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    DetailPrint "Removing CoolDesk data..."
    RMDir /r "$INSTDIR\sync-data"
  ${EndIf}

  ; No-op while anything remains (e.g. data the user chose to keep); this just
  ; clears the empty shell Tauri's own RMDir left behind.
  RMDir "$INSTDIR"

  ; Ask people who really uninstall why (cool-desk.com/uninstall: one optional
  ; tap on a fixed reason, anonymous — the same page the extension opens). Never during an update or a reinstall:
  ;   • /UPDATE, /S and /P runs are updates or scripted (winget, our own
  ;     NSIS_HOOK_PREINSTALL), never a person deciding to leave
  ;   • a newer installer runs the old uninstaller *in place* (`_?=`), so it
  ;     still sees its own uninstall.exe in $EXEDIR — that file can't be
  ;     deleted while it runs. A person uninstalling from Settings or Control
  ;     Panel runs NSIS's temp copy instead, where no uninstall.exe exists.
  ${If} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
  ${AndIfNot} ${FileExists} "$EXEDIR\uninstall.exe"
    ExecShell "open" "https://cool-desk.com/uninstall?v=${VERSION}&from=windows"
  ${EndIf}
!macroend
