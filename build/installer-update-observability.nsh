!ifndef BUILD_UNINSTALLER
Var /GLOBAL KunInstallerUpdateBoundary
!endif

!macro KunAutomaticUpdateObservabilityFunctions
  Function KunRecordAutomaticUpdateBoundary
    ; Diagnostics must not alter the error flag or the caller's registers.
    Push $R8
    Push $R9
    StrCpy $R9 0
    ${if} ${Errors}
      StrCpy $R9 1
    ${endif}
    ${if} ${isUpdated}
    ${andIf} $KunInstallerDiagnosticPath != ""
      ClearErrors
      FileOpen $R8 "$KunInstallerDiagnosticPath" a
      ${ifNot} ${Errors}
        FileWrite $R8 "NSIS update-boundary=$KunInstallerUpdateBoundary$\r$\n"
        FileClose $R8
      ${endif}
    ${endif}
    ClearErrors
    ${if} $R9 == 1
      SetErrors
    ${endif}
    Pop $R9
    Pop $R8
  FunctionEnd

  Function KunRecordPreparedAutomaticUpdate
    StrCpy $KunInstallerUpdateBoundary "prepared"
    Call KunRecordAutomaticUpdateBoundary
  FunctionEnd

  Function KunRecordCutoverAutomaticUpdate
    StrCpy $KunInstallerUpdateBoundary "cutover"
    Call KunRecordAutomaticUpdateBoundary
  FunctionEnd

  Function .onInstFailed
    ; NSIS invokes this for installation failures, not every Quit or process
    ; termination. Never manufacture a failure result while work is in flight.
    ${ifNot} ${isUpdated}
      Return
    ${endif}
    ${if} $KunInstallerUpdateBoundary != "prepared"
      Return
    ${endif}
    StrCpy $KunInstallerUpdateBoundary "failed-before-cutover"
    Call KunRecordAutomaticUpdateBoundary
    ReadEnvStr $KunInstallerPendingResultPath "KUN_PENDING_UPDATE_RESULT"
    ${if} $KunInstallerPendingResultPath == ""
      Return
    ${endif}
    ; Keep recovery artifacts intact. The existing authenticated recovery path
    ; owns rollback; this callback only reports an observed NSIS failure.
    StrCpy $KunInstallerAbortCode "installer_failed_before_cutover"
    StrCpy $KunInstallerAbortPhase "prepared"
    StrCpy $KunInstallerAbortMessage "The update installer failed before activating the candidate. Recovery files were retained."
    Call KunWriteAutomaticUpdateResult
  FunctionEnd
!macroend
