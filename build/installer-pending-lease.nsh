; Old released GUIs do not recognize a live installer and may unlink their
; pending record. Keep it readable but immutable until the result is published.
; This is a metadata lease, not a lock on application startup or runtime files.
!macro KunAbortPendingLease MESSAGE
  ; No Prepare mutation has happened. Never publish a result to a path whose
  ; authentication failed, or alter an existing recovery transaction here.
  ; The desktop app already quit to launch this installer. Return to the
  ; installed executable. The unauthenticated record gets no result file.
  Call KunReleasePendingLease
  DetailPrint "${MESSAGE}"
  Call KunTryRelaunchOldApp
  SetErrorLevel 2
  Quit
!macroend

!macro KunPendingLeaseFunctions
  Function KunReleasePendingLease
    Push $R0
    Push $R1
    StrCpy $R1 0
    ${if} ${Errors}
      StrCpy $R1 1
    ${endif}
    ${if} $KunInstallerPendingLease != ""
    ${andIf} $KunInstallerPendingLease != 0
    ${andIf} $KunInstallerPendingLease != -1
      System::Call 'kernel32::CloseHandle(p $KunInstallerPendingLease)i.R0'
    ${endif}
    StrCpy $KunInstallerPendingLease ""
    ClearErrors
    ${if} $R1 == 1
      SetErrors
    ${endif}
    Pop $R1
    Pop $R0
  FunctionEnd

  Function KunAcquirePendingLease
    ReadEnvStr $KunInstallerPendingLeasePath "KUN_PENDING_UPDATE_PATH"
    ; Installer-only callers have no GUI pending record to protect.
    ${if} $KunInstallerPendingLeasePath == ""
      Return
    ${endif}
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_PENDING_EXECUTABLE", "$EXEPATH").R0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_PENDING_VERSION", "${VERSION}").R0'
    !insertmacro kunRunMigrationHelper ValidatePendingLease
    ${if} $KunInstallerHelperExitCode != 0
      !insertmacro KunAbortPendingLease "The GUI update record could not be authenticated."
    ${endif}
    ; OPEN_EXISTING, FILE_SHARE_READ only, non-inheritable. No ACL changes or
    ; background helper: even forced installer termination releases the lease.
    Push $R8
    Push $R9
    StrCpy $R9 $KunInstallerPendingLeasePath
    System::Call 'kernel32::CreateFileW(w R9, i 0x80000000, i 1, p 0, i 3, i 0x00200000, p 0)p.R8'
    StrCpy $KunInstallerPendingLease $R8
    ; Do not depend on System plugin pointer formatting of INVALID_HANDLE_VALUE.
    ; A validated regular pending file must yield a valid FILE_TYPE_DISK handle.
    System::Call 'kernel32::GetFileType(p R8)i.R9'
    ${if} $R9 != 1
      Pop $R9
      Pop $R8
      !insertmacro KunAbortPendingLease "The GUI update record could not be protected."
    ${endif}
    Pop $R9
    Pop $R8
    ; Revalidate under the handle: another writer cannot replace or change the
    ; authenticated record between validation and the extraction window.
    !insertmacro kunRunMigrationHelper ValidatePendingLease
    ${if} $KunInstallerHelperExitCode != 0
      !insertmacro KunAbortPendingLease "The protected GUI update record did not match this installer."
    ${endif}
  FunctionEnd
!macroend
