!ifndef BUILD_UNINSTALLER
Var /GLOBAL KunInstallerSourceDir
Var /GLOBAL KunInstallerPrimarySourceDir
Var /GLOBAL KunInstallerSecondarySourceDir
Var /GLOBAL KunInstallerTargetDir
Var /GLOBAL KunInstallerFinalTargetDir
Var /GLOBAL KunInstallerStageDir
Var /GLOBAL KunInstallerTransactionPath
Var /GLOBAL KunInstallerResultPath
Var /GLOBAL KunInstallerResultHandle
Var /GLOBAL KunInstallerMigrationPrepared
Var /GLOBAL KunInstallerSnapshotMode
Var /GLOBAL KunInstallerPrimarySourceStale
Var /GLOBAL KunInstallerSecondarySourceStale
Var /GLOBAL KunInstallerCandidateExplicit
Var /GLOBAL KunInstallerPresentedTargetDir
Var /GLOBAL KunInstallerUpdateSourceDir
Var /GLOBAL KunInstallerPreserveOtherScope
Var /GLOBAL KunInstallerOtherUninstallString
Var /GLOBAL KunInstallerOtherQuietUninstallString
Var /GLOBAL KunInstallerRestoreInteractive
Var /GLOBAL KunInstallerCurrentUserShortcutName
Var /GLOBAL KunInstallerCurrentUserMenuDirectory
Var /GLOBAL KunInstallerInPlaceUpdate
Var /GLOBAL KunInstallerAbortCode
Var /GLOBAL KunInstallerAbortPhase
Var /GLOBAL KunInstallerAbortMessage
Var /GLOBAL KunInstallerPendingResultPath
Var /GLOBAL KunInstallerHealthResultPath
Var /GLOBAL KunInstallerHealthToken
Var /GLOBAL KunInstallerHealthAttempt
!endif
Var /GLOBAL KunInstallerHelperPath
Var /GLOBAL KunInstallerJournalPath
Var /GLOBAL KunInstallerPowerShellPath
Var /GLOBAL KunInstallerHelperExitCode
Var /GLOBAL KunInstallerHelperOutput
Var /GLOBAL KunInstallerCurrentPid
!ifdef BUILD_UNINSTALLER
Var /GLOBAL KunInstallerStopAttempt
Var /GLOBAL KunInstallerStopResult
Var /GLOBAL KunInstallerStopDiagnosticPath
!endif

!macro kunRunMigrationHelper ACTION
  !ifdef BUILD_UNINSTALLER
    nsExec::ExecToStack `"$KunInstallerPowerShellPath" -NoProfile -ExecutionPolicy Bypass -File "$KunInstallerHelperPath" -Action ${ACTION}`
  !else
    nsExec::ExecToStack `"$KunInstallerPowerShellPath" -NoProfile -ExecutionPolicy Bypass -File "$KunInstallerHelperPath" -Action ${ACTION} -ResultPath "$KunInstallerResultPath"`
  !endif
  Pop $KunInstallerHelperExitCode
  Pop $KunInstallerHelperOutput
!macroend

!include "${PROJECT_DIR}\build\installer-automatic-update.nsh"
!include "${PROJECT_DIR}\build\installer-process-check.nsh"

!macro kunSetEnvironmentFromRegister NAME REGISTER
  # System::Call reparses quoted variable expansions. Copy arbitrary registry
  # text into a local NSIS register and let the plugin read it directly so an
  # UninstallString containing quotes is preserved verbatim.
  Push $9
  StrCpy $9 ${REGISTER}
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("${NAME}", r9).r0'
  Pop $9
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_PRE KunInstallDirectoryPagePre
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE KunInstallDirectoryPageLeave
  !insertmacro MUI_PAGE_DIRECTORY
  !define MUI_PAGE_CUSTOMFUNCTION_PRE KunInstallFilesPagePre
!macroend

!macro customInit
  InitPluginsDir
  StrCpy $KunInstallerPowerShellPath "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  File /oname=$PLUGINSDIR\kun-windows-installer-migration.ps1 "${PROJECT_DIR}\build\windows-installer-migration.ps1"
  File /oname=$PLUGINSDIR\windows-installer-migration-paths.ps1 "${PROJECT_DIR}\build\windows-installer-migration-paths.ps1"
  File /oname=$PLUGINSDIR\windows-installer-migration-journal.ps1 "${PROJECT_DIR}\build\windows-installer-migration-journal.ps1"
  File /oname=$PLUGINSDIR\windows-installer-migration-filesystem.ps1 "${PROJECT_DIR}\build\windows-installer-migration-filesystem.ps1"
  File /oname=$PLUGINSDIR\windows-installer-migration-actions.ps1 "${PROJECT_DIR}\build\windows-installer-migration-actions.ps1"
  File /oname=$PLUGINSDIR\windows-installer-migration-transaction.ps1 "${PROJECT_DIR}\build\windows-installer-migration-transaction.ps1"
  StrCpy $KunInstallerHelperPath "$PLUGINSDIR\kun-windows-installer-migration.ps1"
  StrCpy $KunInstallerResultPath "$PLUGINSDIR\kun-windows-installer-result.txt"
  System::Call 'kernel32::GetCurrentProcessId() i .r0'
  StrCpy $KunInstallerCurrentPid $0
  StrCpy $KunInstallerMigrationPrepared 0
  StrCpy $KunInstallerSnapshotMode ""
  StrCpy $KunInstallerPrimarySourceStale 0
  StrCpy $KunInstallerSecondarySourceStale 0
  StrCpy $KunInstallerCandidateExplicit 0
  StrCpy $KunInstallerPresentedTargetDir ""
  StrCpy $KunInstallerFinalTargetDir ""
  StrCpy $KunInstallerStageDir ""
  StrCpy $KunInstallerTransactionPath ""
  StrCpy $KunInstallerUpdateSourceDir ""
  StrCpy $KunInstallerPreserveOtherScope 0
  StrCpy $KunInstallerOtherUninstallString ""
  StrCpy $KunInstallerOtherQuietUninstallString ""
  !ifndef BUILD_UNINSTALLER
    StrCpy $KunInstallerRestoreInteractive 0
    StrCpy $KunInstallerInPlaceUpdate 0
  !endif

  ${if} ${isUpdated}
    # electron-updater always passes --updated, including older Kun versions
    # that launched the assisted installer without /S. Force only that path
    # into silent mode so retry/cancel dialogs use their safe default while a
    # manually launched installer remains interactive.
    SetSilent silent
  ${endif}

  !insertmacro GetDParameter $R0
  ${if} $R0 != ""
    StrCpy $KunInstallerCandidateExplicit 1
  ${endif}

  Call KunSetProductEnvironment
  Call KunSelectAutomaticUpdateMode
  Call KunRecoverInterruptedAutomaticUpdate
  Call KunRefreshInstallPaths

  ${if} ${UAC_IsInnerInstance}
  ${andIf} ${Silent}
    Call KunPrepareInstallMigration
  ${endif}
!macroend

!macro customUnInstallCheck
  ${if} ${isUpdated}
    # Automatic updates retain the old payload through candidate health validation.
    ClearErrors
    StrCpy $R0 0
    DetailPrint "Automatic update; deferring removal of $KunInstallerPrimarySourceDir until commit."
  ${elseIf} $KunInstallerPrimarySourceStale != 1
    StrCpy $KunInstallerSourceDir $KunInstallerPrimarySourceDir
    Call KunHandleOldUninstallerResult
  ${else}
    ClearErrors
    StrCpy $R0 0
  ${endif}
  ${if} $installMode != "all"
    Call KunRestoreInteractiveInstaller
  ${elseIf} $KunInstallerPreserveOtherScope == 1
    Call KunSuspendCurrentUserUninstallRegistration
  ${endif}
!macroend

!macro customUnInstallCheckCurrentUser
  ${if} ${isUpdated}
    ${if} $KunInstallerPreserveOtherScope == 1
      Call KunRestoreCurrentUserUninstallRegistration
    ${endif}
    ClearErrors
    StrCpy $R0 0
    StrCpy $KunInstallerSourceDir $KunInstallerPrimarySourceDir
    Call KunRestoreInteractiveInstaller
    Return
  ${endif}
  ${if} $KunInstallerPreserveOtherScope == 1
    Call KunRestoreCurrentUserUninstallRegistration
    ClearErrors
    StrCpy $R0 0
    StrCpy $KunInstallerSourceDir $KunInstallerPrimarySourceDir
    Call KunRestoreInteractiveInstaller
    Return
  ${endif}
  ${if} $KunInstallerSecondarySourceStale != 1
    StrCpy $KunInstallerSourceDir $KunInstallerSecondarySourceDir
    Call KunHandleOldUninstallerResult
  ${else}
    ClearErrors
    StrCpy $R0 0
  ${endif}
  # installSection invokes this callback only while an all-users install is
  # retiring an existing current-user registration. The old uninstaller usually
  # removes this shell state itself; fallback cleanup must finish the same scoped
  # transition after the validated application payload is gone.
  Call KunRetireCurrentUserShellState
  StrCpy $KunInstallerSourceDir $KunInstallerPrimarySourceDir
  Call KunRestoreInteractiveInstaller
!macroend

!macro customInstall
  ${if} ${isUpdated}
    Call KunFinishAutomaticUpdateTransaction
  ${else}
    StrCpy $KunInstallerTargetDir $INSTDIR
    Call KunSetMigrationEnvironment
  ${endif}

  !insertmacro kunRunMigrationHelper Restore
  ${if} $KunInstallerHelperExitCode != 0
    MessageBox MB_OK|MB_ICONSTOP "Kun was installed, but preserved files could not be restored without overwriting another file. The recovery directory and log were retained.$\r$\n$KunInstallerHelperOutput" /SD IDOK
    !insertmacro KunAbortAutomaticUpdate restore_failed restore "Preserved files could not be restored."
  ${endif}

  !insertmacro kunRunMigrationHelper ValidatePayload
  ${if} $KunInstallerHelperExitCode != 0
    MessageBox MB_OK|MB_ICONSTOP "Kun installation is incomplete. No PATH changes were made; run the installer again to repair it.$\r$\n$KunInstallerHelperOutput" /SD IDOK
    !insertmacro KunAbortAutomaticUpdate payload_invalid validate "The installed payload did not pass validation."
  ${endif}

  ${if} ${isUpdated}
    # Rebuild final shell state after payload cutover.
    StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro registryAddInstallInfo
    !insertmacro setLinkVars
    !insertmacro addStartMenuLink "false"
    !insertmacro addDesktopLink "false"
  ${endif}

  ${if} $KunInstallerInPlaceUpdate == 1
    !insertmacro kunRunMigrationHelper CleanupInPlaceLeftovers
    ${if} $KunInstallerHelperExitCode != 0
      DetailPrint "Kun could not remove obsolete in-place update leftovers: $KunInstallerHelperOutput"
    ${endif}
  ${endif}

  !insertmacro kunRunMigrationHelper UpdatePath
  ${if} $KunInstallerHelperExitCode != 0
    DetailPrint "Kun could not update the user PATH: $KunInstallerHelperOutput"
    !insertmacro KunAbortAutomaticUpdate path_migration_failed path "The user PATH could not be migrated safely."
  ${else}
    DetailPrint "Reconciled the user PATH from $KunInstallerSourceDir\bin to $INSTDIR\bin."
  ${endif}
  System::Call 'user32::SendMessageTimeout(i 0xffff, i 0x001A, i 0, t "Environment", i 2, i 5000, *i .r0)'
  ${if} ${isUpdated}
    !insertmacro kunRunMigrationHelper ValidateCutover
    ${if} $KunInstallerHelperExitCode != 0
      !insertmacro KunAbortAutomaticUpdate cutover_invalid cutover "The installed shell state did not pass validation."
    ${endif}
  ${endif}
  !insertmacro KunCompleteAutomaticUpdate
!macroend

!macro customUnInstall
  DetailPrint "Removing $INSTDIR\bin from PATH."
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_CLI_BIN", "$INSTDIR\bin").r0'
  nsExec::ExecToLog `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$p=[Environment]::GetEnvironmentVariable('Path','User');$$parts=@($$p -split ';' | ? { $$_.Trim() -ne '' -and -not $$_.TrimEnd('\').Equals($$env:KUN_CLI_BIN.TrimEnd('\'),'OrdinalIgnoreCase') });[Environment]::SetEnvironmentVariable('Path',($$parts -join ';'),'User')"`
  Pop $0
  System::Call 'user32::SendMessageTimeout(i 0xffff, i 0x001A, i 0, t "Environment", i 2, i 5000, *i .r0)'
  ${ifNot} ${isUpdated}
    StrCpy $KunInstallerJournalPath "$APPDATA\KunInstallerRecovery\${APP_GUID}.json"
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_SOURCE", "$INSTDIR").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_SECONDARY_SOURCE", "").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_TARGET", "$INSTDIR").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_JOURNAL", "$KunInstallerJournalPath").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_INSTALL_MODE", "$installMode").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_APP_GUID", "${APP_GUID}").r0'
    !insertmacro kunRunMigrationHelper CleanupJournal
    ${if} $KunInstallerHelperExitCode != 0
      DetailPrint "Kun preserved installer recovery state during uninstall: $KunInstallerHelperOutput"
    ${endif}
  ${endif}
!macroend

!macro customHeader
!ifndef BUILD_UNINSTALLER
!insertmacro KunAutomaticUpdateFunctions
  Function KunSetProductEnvironment
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_CANONICAL_LEAF", "${APP_FILENAME}").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_APP_EXECUTABLE", "${APP_EXECUTABLE_FILENAME}").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_PRODUCT_NAME", "${PRODUCT_NAME}").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_APP_GUID", "${APP_GUID}").r0'
  FunctionEnd

  Function KunSetMigrationEnvironment
    # Recovery state follows the selected shell context.
    StrCpy $KunInstallerJournalPath "$APPDATA\KunInstallerRecovery\${APP_GUID}.json"

    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_SOURCE", "$KunInstallerSourceDir").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_SECONDARY_SOURCE", "$KunInstallerSecondarySourceDir").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_TARGET", "$KunInstallerTargetDir").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_JOURNAL", "$KunInstallerJournalPath").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_SELF_PID", "$KunInstallerCurrentPid").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_PRIMARY_SOURCE_STALE", "$KunInstallerPrimarySourceStale").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_SECONDARY_SOURCE_STALE", "$KunInstallerSecondarySourceStale").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_CANDIDATE_EXPLICIT", "$KunInstallerCandidateExplicit").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_TRANSACTION", "$KunInstallerTransactionPath").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_STAGE", "$KunInstallerStageDir").r0'
    Call KunSetAutomaticUpdateShellEnvironment
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_IN_PLACE_UPDATE", "$KunInstallerInPlaceUpdate").r0'
    ${if} ${isUpdated}
      System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_AUTOMATIC_UPDATE", "1").r0'
    ${else}
      System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_AUTOMATIC_UPDATE", "0").r0'
    ${endif}
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_INSTALL_MODE", "$installMode").r0'
  FunctionEnd

  Function KunReadMigrationResult
    ClearErrors
    StrCpy $KunInstallerHelperOutput ""
    FileOpen $KunInstallerResultHandle "$KunInstallerResultPath" r
    IfErrors KunMigrationResultMissing
    FileReadUTF16LE $KunInstallerResultHandle $KunInstallerHelperOutput
    FileClose $KunInstallerResultHandle
    Delete "$KunInstallerResultPath"
    Return

    KunMigrationResultMissing:
      StrCpy $KunInstallerHelperExitCode 1
      StrCpy $KunInstallerHelperOutput "The installer helper did not produce a result file."
      Delete "$KunInstallerResultPath"
  FunctionEnd

  Function KunResolveRegisteredSource
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_SOURCE", "$KunInstallerSourceDir").r0'
    !insertmacro kunSetEnvironmentFromRegister "KUN_INSTALLER_UNINSTALL_STRING" $R9
    Delete "$KunInstallerResultPath"
    !insertmacro kunRunMigrationHelper ResolveSource
    ${if} $KunInstallerHelperExitCode == 0
      Call KunReadMigrationResult
    ${endif}
    ${if} $KunInstallerHelperExitCode != 0
    ${orIf} $KunInstallerHelperOutput == ""
      MessageBox MB_OK|MB_ICONSTOP "Kun found an existing installation registration but could not recover its program directory.$\r$\n$KunInstallerHelperOutput" /SD IDOK
      !insertmacro KunAbortAutomaticUpdate resolve_source source "The registered program directory could not be recovered."
    ${endif}
    StrCpy $KunInstallerSourceDir $KunInstallerHelperOutput
  FunctionEnd

  Function KunSelectAutomaticUpdateMode
    ${ifNot} ${isUpdated}
      Return
    ${endif}
    ReadEnvStr $KunInstallerUpdateSourceDir "KUN_INSTALLER_UPDATE_SOURCE"
    ${if} $KunInstallerUpdateSourceDir == ""
      ReadRegStr $R0 HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" InstallLocation
      ReadRegStr $R1 HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString
      ReadRegStr $R2 HKEY_LOCAL_MACHINE "${INSTALL_REGISTRY_KEY}" InstallLocation
      ReadRegStr $R3 HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" UninstallString
      ${if} $R0 == ""
      ${andIf} $R1 == ""
        ${if} $R2 != ""
        ${orIf} $R3 != ""
          StrCpy $hasPerMachineInstallation 1
          StrCpy $hasPerUserInstallation 0
          !insertmacro setInstallModePerAllUsers
          DetailPrint "Automatic update selected the only registered all-users ${PRODUCT_NAME} installation."
        ${else}
          DetailPrint "Automatic update found no existing ${PRODUCT_NAME} registration; keeping the requested install mode."
        ${endif}
        Return
      ${endif}
      ${if} $R2 == ""
      ${andIf} $R3 == ""
        StrCpy $hasPerMachineInstallation 0
        StrCpy $hasPerUserInstallation 1
        !insertmacro setInstallModePerUser
        DetailPrint "Automatic update selected the only registered current-user ${PRODUCT_NAME} installation."
        Return
      ${endif}
      DetailPrint "Automatic update source marker is unavailable with registrations in both scopes; aborting the update."
      MessageBox MB_OK|MB_ICONSTOP "${PRODUCT_NAME} found both a current-user and an all-users installation, and this updater could not determine which one is running. The automatic update was cancelled and both installations were left unchanged. The previously running installation could not be identified; restart ${PRODUCT_NAME} manually, then run the latest installer to merge or remove one installation." /SD IDOK
      !insertmacro KunAbortAutomaticUpdate scope_ambiguous scope "The update source marker is unavailable with registrations in both scopes."
    ${endif}

    ReadRegStr $R0 HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $R1 HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ReadRegStr $R2 HKEY_LOCAL_MACHINE "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $R3 HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" UninstallString
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_CURRENT_USER_SOURCE", "$R0").r0'
    !insertmacro kunSetEnvironmentFromRegister "KUN_INSTALLER_CURRENT_USER_UNINSTALL_STRING" $R1
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_ALL_USERS_SOURCE", "$R2").r0'
    !insertmacro kunSetEnvironmentFromRegister "KUN_INSTALLER_ALL_USERS_UNINSTALL_STRING" $R3
    Delete "$KunInstallerResultPath"
    !insertmacro kunRunMigrationHelper ResolveUpdateScope
    ${if} $KunInstallerHelperExitCode == 0
      Call KunReadMigrationResult
    ${endif}
    ${if} $KunInstallerHelperExitCode != 0
    ${orIf} $KunInstallerHelperOutput == ""
      MessageBox MB_OK|MB_ICONSTOP "${PRODUCT_NAME} could not match this automatic update to one installed application.$\r$\n$KunInstallerHelperOutput" /SD IDOK
      !insertmacro KunAbortAutomaticUpdate scope_mismatch scope "The installed update scope could not be matched."
    ${endif}

    ${if} $KunInstallerHelperOutput == "current"
      StrCpy $hasPerMachineInstallation 0
      StrCpy $hasPerUserInstallation 1
      !insertmacro setInstallModePerUser
      DetailPrint "Automatic update selected the current-user ${PRODUCT_NAME} registration."
      Return
    ${endif}
    ${if} $KunInstallerHelperOutput == "all"
      StrCpy $KunInstallerPreserveOtherScope 1
      StrCpy $hasPerMachineInstallation 1
      StrCpy $hasPerUserInstallation 0
      !insertmacro setInstallModePerAllUsers
      DetailPrint "Automatic update selected the all-users ${PRODUCT_NAME} registration."
      Return
    ${endif}

    MessageBox MB_OK|MB_ICONSTOP "${PRODUCT_NAME} received an invalid automatic update scope: $KunInstallerHelperOutput" /SD IDOK
    !insertmacro KunAbortAutomaticUpdate invalid_scope scope "The installer returned an invalid update scope."
  FunctionEnd

  Function KunRetireSelectedShellState
    ReadRegStr $KunInstallerCurrentUserShortcutName SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName
    ReadRegStr $KunInstallerCurrentUserMenuDirectory SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" MenuDirectory

    ${if} $KunInstallerCurrentUserShortcutName != ""
      Delete "$DESKTOP\$KunInstallerCurrentUserShortcutName.lnk"
      Delete "$SMPROGRAMS\$KunInstallerCurrentUserShortcutName.lnk"
      ${if} $KunInstallerCurrentUserMenuDirectory != ""
        Delete "$SMPROGRAMS\$KunInstallerCurrentUserMenuDirectory\$KunInstallerCurrentUserShortcutName.lnk"
      ${endif}
    ${endif}

    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\DeepSeek GUI.lnk"
    Delete "$SMPROGRAMS\DeepSeek GUI.lnk"
    ${if} $KunInstallerCurrentUserMenuDirectory != ""
      Delete "$SMPROGRAMS\$KunInstallerCurrentUserMenuDirectory\${SHORTCUT_NAME}.lnk"
      Delete "$SMPROGRAMS\$KunInstallerCurrentUserMenuDirectory\DeepSeek GUI.lnk"
      RMDir "$SMPROGRAMS\$KunInstallerCurrentUserMenuDirectory"
    ${endif}

    DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
  FunctionEnd

  Function KunRetireCurrentUserShellState
    ReadRegStr $KunInstallerCurrentUserShortcutName HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" ShortcutName
    ReadRegStr $KunInstallerCurrentUserMenuDirectory HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" MenuDirectory
    SetShellVarContext current

    ${if} $KunInstallerCurrentUserShortcutName != ""
      Delete "$DESKTOP\$KunInstallerCurrentUserShortcutName.lnk"
      Delete "$SMPROGRAMS\$KunInstallerCurrentUserShortcutName.lnk"
      ${if} $KunInstallerCurrentUserMenuDirectory != ""
        Delete "$SMPROGRAMS\$KunInstallerCurrentUserMenuDirectory\$KunInstallerCurrentUserShortcutName.lnk"
      ${endif}
    ${endif}

    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\DeepSeek GUI.lnk"
    Delete "$SMPROGRAMS\DeepSeek GUI.lnk"
    ${if} $KunInstallerCurrentUserMenuDirectory != ""
      Delete "$SMPROGRAMS\$KunInstallerCurrentUserMenuDirectory\${SHORTCUT_NAME}.lnk"
      Delete "$SMPROGRAMS\$KunInstallerCurrentUserMenuDirectory\DeepSeek GUI.lnk"
      RMDir "$SMPROGRAMS\$KunInstallerCurrentUserMenuDirectory"
    ${endif}

    DeleteRegKey HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}"
    SetShellVarContext all
  FunctionEnd

  Function KunReadRegisteredSource
    ReadRegStr $KunInstallerSourceDir SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $R9 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${if} $R9 == ""
    ${andIf} $installMode != "all"
      ReadRegStr $R9 HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${endif}
    ${if} $KunInstallerSourceDir != ""
    ${orIf} $R9 != ""
      Call KunResolveRegisteredSource
    ${endif}
    StrCpy $KunInstallerPrimarySourceDir $KunInstallerSourceDir
    StrCpy $KunInstallerSecondarySourceDir ""
    ${if} $installMode == "all"
    ${andIf} $KunInstallerPreserveOtherScope != 1
      StrCpy $KunInstallerSourceDir ""
      ReadRegStr $KunInstallerSourceDir HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" InstallLocation
      ReadRegStr $R9 HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString
      ${if} $KunInstallerSourceDir != ""
      ${orIf} $R9 != ""
        Call KunResolveRegisteredSource
      ${endif}
      StrCpy $KunInstallerSecondarySourceDir $KunInstallerSourceDir
    ${endif}
    StrCpy $KunInstallerSourceDir $KunInstallerPrimarySourceDir
  FunctionEnd

  Function KunResolveInstallTarget
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_SOURCE", "$KunInstallerSourceDir").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_CANDIDATE", "$INSTDIR").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_CANDIDATE_EXPLICIT", "$KunInstallerCandidateExplicit").r0'
    Delete "$KunInstallerResultPath"
    !insertmacro kunRunMigrationHelper ResolvePath
    ${if} $KunInstallerHelperExitCode == 0
      Call KunReadMigrationResult
    ${endif}
    ${if} $KunInstallerHelperExitCode != 0
    ${orIf} $KunInstallerHelperOutput == ""
      MessageBox MB_OK|MB_ICONSTOP "Kun could not resolve a safe installation directory.$\r$\n$KunInstallerHelperOutput" /SD IDOK
      !insertmacro KunAbortAutomaticUpdate resolve_target target "A safe installation directory could not be resolved."
    ${endif}
    StrCpy $KunInstallerTargetDir $KunInstallerHelperOutput
    StrCpy $INSTDIR $KunInstallerTargetDir
  FunctionEnd

  Function KunRefreshInstallPaths
    # The old uninstaller removes its registration. Keep the first source snapshot
    # for the selected mode and only refresh it if the user changes install mode.
    ${if} $KunInstallerSnapshotMode != $installMode
      Call KunReadRegisteredSource
      StrCpy $KunInstallerSnapshotMode $installMode
    ${endif}
    StrCpy $KunInstallerSourceDir $KunInstallerPrimarySourceDir
    Call KunResolveInstallTarget
    Call KunSetMigrationEnvironment
  FunctionEnd

  Function KunInstallDirectoryPagePre
    ${if} ${isUpdated}
      Abort
    ${endif}
    Call KunRefreshInstallPaths
    StrCpy $KunInstallerPresentedTargetDir $INSTDIR
  FunctionEnd

  Function KunInstallDirectoryPageLeave
    ${if} $INSTDIR != $KunInstallerPresentedTargetDir
      StrCpy $KunInstallerCandidateExplicit 1
    ${endif}
    Call KunRefreshInstallPaths
  FunctionEnd

  Function KunInstallFilesPagePre
    Call KunPrepareInstallMigration
  FunctionEnd

  Function KunPrepareInstallMigration
    ${if} $KunInstallerMigrationPrepared == 1
      Return
    ${endif}
    Call KunRefreshInstallPaths
    ${if} ${isUpdated}
      StrCpy $KunInstallerFinalTargetDir $KunInstallerTargetDir
      StrCpy $KunInstallerStageDir "$KunInstallerFinalTargetDir.kun-stage-$KunInstallerCurrentPid"
      StrCpy $KunInstallerTransactionPath "$APPDATA\KunInstallerRecovery\${APP_GUID}-update.json"
      StrCpy $R0 "$APPDATA\KunInstallerRecovery\update-backup-$KunInstallerCurrentPid"
      System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_PAYLOAD_BACKUP", "$R0").r0'
      ReadEnvStr $R1 "KUN_PENDING_UPDATE_RESULT"
      ${if} $R1 == ""
        StrCpy $KunInstallerHealthResultPath "$TEMP\Kun-update-health-$KunInstallerCurrentPid.json"
      ${else}
        StrCpy $KunInstallerHealthResultPath "$R1.health.json"
      ${endif}
      System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_HEALTH_RESULT", "$KunInstallerHealthResultPath").r0'
      Call KunSetMigrationEnvironment
    ${endif}
    Delete "$KunInstallerResultPath"
    !insertmacro kunRunMigrationHelper Prepare
    ${if} $KunInstallerHelperExitCode != 0
      MessageBox MB_OK|MB_ICONSTOP "Kun kept the existing installation unchanged because it could not migrate the program directory safely.$\r$\n$KunInstallerHelperOutput" /SD IDOK
      !insertmacro KunAbortAutomaticUpdate prepare_failed prepare "The program directory migration could not be prepared safely."
    ${endif}
    Call KunReadMigrationResult
    ${if} $KunInstallerHelperExitCode != 0
      MessageBox MB_OK|MB_ICONSTOP "Kun kept the existing installation unchanged because it could not classify the registered program directory safely.$\r$\n$KunInstallerHelperOutput" /SD IDOK
      !insertmacro KunAbortAutomaticUpdate prepare_classification_failed prepare "The program directory migration result could not be classified."
    ${endif}

    ${if} $KunInstallerHelperOutput == "1"
    ${orIf} $KunInstallerHelperOutput == "3"
      StrCpy $KunInstallerPrimarySourceStale 1
      DetailPrint "Retiring stale selected-scope Kun registration without modifying $KunInstallerPrimarySourceDir."
      Call KunRetireSelectedShellState
    ${else}
      StrCpy $KunInstallerSourceDir $KunInstallerPrimarySourceDir
      Call KunMarkInPlaceAutomaticUpdate
      Call KunSecureSelectedUninstallRegistration
    ${endif}
    ${if} $KunInstallerHelperOutput == "2"
    ${orIf} $KunInstallerHelperOutput == "3"
      StrCpy $KunInstallerSecondarySourceStale 1
      DetailPrint "Retiring stale current-user Kun registration without modifying $KunInstallerSecondarySourceDir."
      Call KunRetireCurrentUserShellState
    ${elseIf} $KunInstallerSecondarySourceDir != ""
      StrCpy $KunInstallerSourceDir $KunInstallerSecondarySourceDir
      Call KunSecureCurrentUserUninstallRegistration
    ${endif}
    StrCpy $KunInstallerSourceDir $KunInstallerPrimarySourceDir
    StrCpy $KunInstallerMigrationPrepared 1
    ${if} ${isUpdated}
      StrCpy $INSTDIR $KunInstallerStageDir
      DetailPrint "Automatic update will extract the candidate payload into $KunInstallerStageDir."
    ${endif}
  FunctionEnd

  Function KunMarkInPlaceAutomaticUpdate
    StrCpy $KunInstallerInPlaceUpdate 0
    ${ifNot} ${isUpdated}
      Return
    ${endif}
    ${if} $KunInstallerPrimarySourceDir == ""
      Return
    ${endif}
    ${if} $KunInstallerPrimarySourceDir == $KunInstallerTargetDir
      StrCpy $KunInstallerInPlaceUpdate 1
    ${endif}
    Call KunSetMigrationEnvironment
  FunctionEnd

  Function KunSuspendCurrentUserUninstallRegistration
    ReadRegStr $KunInstallerOtherUninstallString HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ReadRegStr $KunInstallerOtherQuietUninstallString HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
    DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString
    DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
    DetailPrint "Preserving the unrelated current-user ${PRODUCT_NAME} registration during an all-users automatic update."
  FunctionEnd

  Function KunRestoreCurrentUserUninstallRegistration
    ${if} $KunInstallerOtherUninstallString != ""
      WriteRegStr HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString "$KunInstallerOtherUninstallString"
    ${endif}
    ${if} $KunInstallerOtherQuietUninstallString != ""
      WriteRegStr HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString "$KunInstallerOtherQuietUninstallString"
    ${endif}
  FunctionEnd

  Function KunResolveTrustedUninstaller
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_SOURCE", "$KunInstallerSourceDir").r0'
    Delete "$KunInstallerResultPath"
    !insertmacro kunRunMigrationHelper ResolveUninstaller
    ${if} $KunInstallerHelperExitCode == 0
      Call KunReadMigrationResult
    ${endif}
    ${if} $KunInstallerHelperExitCode != 0
      MessageBox MB_OK|MB_ICONSTOP "${PRODUCT_NAME} could not validate the old application uninstaller.$\r$\n$KunInstallerHelperOutput" /SD IDOK
      !insertmacro KunAbortAutomaticUpdate uninstaller_invalid uninstaller "The old application uninstaller could not be validated."
    ${endif}
  FunctionEnd

  Function KunSecureSelectedUninstallRegistration
    ${if} ${isUpdated}
      # Never expose the old uninstaller during an automatic update. The old
      # payload is the recovery source for both in-place and brand migrations.
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
      DetailPrint "Automatic update; suppressed the selected-scope uninstaller until commit."
      Return
    ${endif}
    Call KunResolveTrustedUninstaller
    ${if} $KunInstallerHelperOutput == ""
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
      DetailPrint "The old ${PRODUCT_NAME} uninstaller is unavailable; conservative cleanup will be used."
      Return
    ${endif}
    ${if} $installMode == "all"
      StrCpy $R8 "/allusers"
    ${else}
      StrCpy $R8 "/currentuser"
    ${endif}
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$KunInstallerHelperOutput" $R8'
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"$KunInstallerHelperOutput" $R8 /S'
  FunctionEnd

  Function KunSecureCurrentUserUninstallRegistration
    Call KunResolveTrustedUninstaller
    ${if} $KunInstallerHelperOutput == ""
      DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString
      DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
      DetailPrint "The old current-user ${PRODUCT_NAME} uninstaller is unavailable; conservative cleanup will be used."
      Return
    ${endif}
    WriteRegStr HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$KunInstallerHelperOutput" /currentuser'
    WriteRegStr HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"$KunInstallerHelperOutput" /currentuser /S'
  FunctionEnd

  Function KunHandleOldUninstallerResult
    IfErrors KunOldUninstallerFailed KunOldUninstallerFinished

    KunOldUninstallerFailed:
      DetailPrint "Old ${PRODUCT_NAME} uninstaller was unavailable or failed for $KunInstallerSourceDir."

    KunOldUninstallerFinished:
      DetailPrint "Cleaning only recognized application payload left in $KunInstallerSourceDir."
      Call KunSetMigrationEnvironment
      !insertmacro kunRunMigrationHelper FallbackCleanup
      ${if} $KunInstallerHelperExitCode != 0
        MessageBox MB_OK|MB_ICONSTOP "Kun could not clean the old program files safely.$\r$\n$KunInstallerHelperOutput" /SD IDOK
        !insertmacro KunAbortAutomaticUpdate cleanup_failed cleanup "The old program files could not be cleaned safely."
      ${endif}
      ClearErrors
      StrCpy $R0 0
  FunctionEnd

  Function KunRestoreInteractiveInstaller
    ${if} $KunInstallerRestoreInteractive == 1
      SetSilent normal
      StrCpy $KunInstallerRestoreInteractive 0
    ${endif}
  FunctionEnd
!endif
!macroend
