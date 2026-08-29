!macro KunAbortAutomaticUpdate CODE PHASE MESSAGE
  !ifndef BUILD_UNINSTALLER
  ${if} ${isUpdated}
    StrCpy $KunInstallerAbortCode "${CODE}"
    StrCpy $KunInstallerAbortPhase "${PHASE}"
    StrCpy $KunInstallerAbortMessage "${MESSAGE}"
    Call KunRestoreAutomaticUpdateBackup
    Call KunTryRelaunchOldApp
    Call KunWriteAutomaticUpdateResult
  ${endif}
  !endif
  SetErrorLevel 2
  Quit
!macroend

!macro KunCompleteAutomaticUpdate
  ${if} ${isUpdated}
    ; The probe validates only the candidate payload. User-data migrations begin
    ; on the first normal launch after CommitUpdateTransaction succeeds.
    Call KunRunAutomaticUpdateHealthCheck
    ${if} $KunInstallerHelperExitCode != 0
      StrCpy $KunInstallerAbortCode "health_check_failed"
      StrCpy $KunInstallerAbortPhase "health"
      StrCpy $KunInstallerAbortMessage "The candidate application did not pass its first-launch health check."
      Call KunRestoreAutomaticUpdateBackup
      Call KunTryRelaunchOldApp
      Call KunWriteAutomaticUpdateResult
      SetErrorLevel 2
      Quit
    ${endif}
    !insertmacro kunRunMigrationHelper CommitUpdateTransaction
    ${if} $KunInstallerHelperExitCode != 0
      StrCpy $KunInstallerAbortPhase "cleanup_pending"
      StrCpy $KunInstallerAbortMessage "The candidate application is healthy; recovery cleanup is pending."
      DetailPrint "Kun installed successfully but recovery cleanup is pending: $KunInstallerHelperOutput"
    ${else}
      StrCpy $KunInstallerAbortPhase "committed"
      StrCpy $KunInstallerAbortMessage "The candidate application passed its first-launch health check."
    ${endif}
    StrCpy $KunInstallerAbortCode "success"
    Call KunWriteAutomaticUpdateResult
  ${endif}
!macroend

!macro KunAutomaticUpdateFunctions
  Function KunWriteAutomaticUpdateResult
    ${ifNot} ${isUpdated}
      Return
    ${endif}
    ReadEnvStr $KunInstallerPendingResultPath "KUN_PENDING_UPDATE_RESULT"
    ${if} $KunInstallerPendingResultPath == ""
      !insertmacro kunRunMigrationHelper FinalizeUpdateTransaction
      Return
    ${endif}
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_PENDING_RESULT", "$KunInstallerPendingResultPath").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_ABORT_CODE", "$KunInstallerAbortCode").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_ABORT_PHASE", "$KunInstallerAbortPhase").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_ABORT_MESSAGE", "$KunInstallerAbortMessage").r0'
    !insertmacro kunRunMigrationHelper WriteUpdateResult
    ${if} $KunInstallerHelperExitCode != 0
      DetailPrint "Kun could not record the automatic-update result: $KunInstallerHelperOutput"
      Return
    ${endif}
    ; The application owns FinalizeUpdateTransaction after its first complete
    ; runtime health check. Until then, keep the rollback payload and journal.
  FunctionEnd

  Function KunSetAutomaticUpdateShellEnvironment
    SetShellVarContext current
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_CURRENT_DESKTOP", "$DESKTOP").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_CURRENT_PROGRAMS", "$SMPROGRAMS").r0'
    SetShellVarContext all
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_COMMON_DESKTOP", "$DESKTOP").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_COMMON_PROGRAMS", "$SMPROGRAMS").r0'
    ${if} $installMode != "all"
      SetShellVarContext current
    ${endif}
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_INSTALL_REGISTRY_KEY", "${INSTALL_REGISTRY_KEY}").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_UNINSTALL_REGISTRY_KEY", "${UNINSTALL_REGISTRY_KEY}").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_PRESERVE_OTHER_SCOPE", "$KunInstallerPreserveOtherScope").r0'
  FunctionEnd

  Function KunRecoverInterruptedAutomaticUpdate
    ${ifNot} ${isUpdated}
      Return
    ${endif}
    ${if} $installMode == "all"
    ${andIfNot} ${UAC_IsInnerInstance}
      Return
    ${endif}
    StrCpy $KunInstallerJournalPath "$APPDATA\KunInstallerRecovery\${APP_GUID}.json"
    StrCpy $KunInstallerTransactionPath "$APPDATA\KunInstallerRecovery\${APP_GUID}-update.json"
    StrCpy $KunInstallerTargetDir $INSTDIR
    Call KunSetMigrationEnvironment
    !insertmacro kunRunMigrationHelper RecoverUpdateTransaction
    ${if} $KunInstallerHelperExitCode != 0
      MessageBox MB_OK|MB_ICONSTOP "Kun could not recover an interrupted automatic update.$\r$\n$KunInstallerHelperOutput" /SD IDOK
      !insertmacro KunAbortAutomaticUpdate recovery_failed recovery "An interrupted automatic update could not be recovered."
    ${endif}
  FunctionEnd

  Function KunRunAutomaticUpdateHealthCheck
    ${if} $KunInstallerHealthResultPath == ""
      StrCpy $KunInstallerHealthResultPath "$TEMP\Kun-update-health-$KunInstallerCurrentPid.json"
    ${endif}
    Delete "$KunInstallerHealthResultPath"
    Delete "$KunInstallerResultPath"
    !insertmacro kunRunMigrationHelper ResolveHealthToken
    ${if} $KunInstallerHelperExitCode == 0
      Call KunReadMigrationResult
    ${endif}
    ${if} $KunInstallerHelperExitCode != 0
    ${orIf} $KunInstallerHelperOutput == ""
      StrCpy $KunInstallerHelperExitCode 1
      Return
    ${endif}
    StrCpy $KunInstallerHealthToken "$KunInstallerHelperOutput"
    ${StdUtils.ExecShellAsUser} $R0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" '--kun-update-health-check="$KunInstallerHealthResultPath" --kun-update-health-token="$KunInstallerHealthToken" --kun-update-target="$INSTDIR"'
    StrCpy $KunInstallerHealthAttempt 0
    KunUpdateHealthWait:
      ${if} ${FileExists} "$KunInstallerHealthResultPath"
        !insertmacro kunRunMigrationHelper ValidateHealthResult
        Return
      ${endif}
      IntOp $KunInstallerHealthAttempt $KunInstallerHealthAttempt + 1
      ${if} $KunInstallerHealthAttempt >= 60
        StrCpy $KunInstallerHelperExitCode 1
        StrCpy $KunInstallerHelperOutput "The candidate application health check timed out."
        Return
      ${endif}
      Sleep 1000
      Goto KunUpdateHealthWait
  FunctionEnd

  Function KunFinishAutomaticUpdateTransaction
    StrCpy $KunInstallerTargetDir $KunInstallerFinalTargetDir
    Call KunSetMigrationEnvironment
    ; File extraction leaves NSIS inside the staging directory. Move the
    ; installer and helper working directory out before renaming that tree.
    SetOutPath "$PLUGINSDIR"
    !insertmacro kunRunMigrationHelper SwitchUpdatePayload
    ${if} $KunInstallerHelperExitCode != 0
      !insertmacro KunAbortAutomaticUpdate payload_switch_failed switch "The candidate payload could not be activated safely."
    ${endif}
    StrCpy $INSTDIR $KunInstallerFinalTargetDir
    StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    StrCpy $launchLink "$appExe"
  FunctionEnd

  Function KunRestoreAutomaticUpdateBackup
    ${ifNot} ${isUpdated}
      Return
    ${endif}
    ${if} $KunInstallerTransactionPath == ""
      Return
    ${endif}
    !insertmacro kunRunMigrationHelper RollbackUpdateTransaction
    ${if} $KunInstallerHelperExitCode != 0
      DetailPrint "Kun could not complete automatic-update rollback: $KunInstallerHelperOutput"
    ${else}
      System::Call 'user32::SendMessageTimeout(i 0xffff, i 0x001A, i 0, t "Environment", i 2, i 5000, *i .r0)'
    ${endif}
  FunctionEnd

  Function KunTryRelaunchOldApp
    ${ifNot} ${isUpdated}
      Return
    ${endif}
    Delete "$KunInstallerResultPath"
    !insertmacro kunRunMigrationHelper ResolveRecoveryExecutable
    ${if} $KunInstallerHelperExitCode == 0
      Call KunReadMigrationResult
    ${endif}
    ${if} $KunInstallerHelperExitCode != 0
    ${orIf} $KunInstallerHelperOutput == ""
      DetailPrint "The preserved ${PRODUCT_NAME} executable could not be resolved after automatic-update failure."
      Return
    ${endif}
    StrCpy $R0 "$KunInstallerHelperOutput"
    ${if} ${FileExists} "$R0"
      DetailPrint "Restarting the preserved ${PRODUCT_NAME} application after automatic-update failure."
      Exec '"$R0"'
    ${else}
      DetailPrint "The preserved ${PRODUCT_NAME} executable is unavailable after automatic-update failure."
    ${endif}
  FunctionEnd
!macroend
