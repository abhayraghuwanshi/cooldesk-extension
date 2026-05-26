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
