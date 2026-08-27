!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    ${if} $INSTDIR == ""
      Return
    ${endif}

    InitPluginsDir
    StrCpy $KunInstallerPowerShellPath "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
    File /oname=$PLUGINSDIR\kun-windows-installer-migration.ps1 "${PROJECT_DIR}\build\windows-installer-migration.ps1"
    File /oname=$PLUGINSDIR\windows-installer-migration-paths.ps1 "${PROJECT_DIR}\build\windows-installer-migration-paths.ps1"
    File /oname=$PLUGINSDIR\windows-installer-migration-journal.ps1 "${PROJECT_DIR}\build\windows-installer-migration-journal.ps1"
    File /oname=$PLUGINSDIR\windows-installer-migration-filesystem.ps1 "${PROJECT_DIR}\build\windows-installer-migration-filesystem.ps1"
    File /oname=$PLUGINSDIR\windows-installer-migration-actions.ps1 "${PROJECT_DIR}\build\windows-installer-migration-actions.ps1"
    File /oname=$PLUGINSDIR\windows-installer-migration-transaction.ps1 "${PROJECT_DIR}\build\windows-installer-migration-transaction.ps1"
    StrCpy $KunInstallerHelperPath "$PLUGINSDIR\kun-windows-installer-migration.ps1"
    System::Call 'kernel32::GetCurrentProcessId() i .r0'
    StrCpy $KunInstallerCurrentPid $0
    StrCpy $KunInstallerStopDiagnosticPath "$TEMP\Kun-installer-process-check-$KunInstallerCurrentPid.log"
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_APP_ROOT", "$INSTDIR").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_SELF_PID", "$KunInstallerCurrentPid").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_CANONICAL_LEAF", "${APP_FILENAME}").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_APP_EXECUTABLE", "${APP_EXECUTABLE_FILENAME}").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_PRODUCT_NAME", "${PRODUCT_NAME}").r0'
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_DIAGNOSTIC_PATH", "$KunInstallerStopDiagnosticPath").r0'
    StrCpy $KunInstallerStopAttempt 0

    KunStopProcessesFromInstallDir:
      IntOp $KunInstallerStopAttempt $KunInstallerStopAttempt + 1
      DetailPrint "Checking for running ${PRODUCT_NAME} processes under $INSTDIR."
      !insertmacro kunRunMigrationHelper StopProcesses
      StrCpy $KunInstallerStopResult $KunInstallerHelperExitCode

      ${if} $KunInstallerStopResult == 0
        Goto KunInstallDirProcessesStopped
      ${elseIf} $KunInstallerStopResult == 2
        Sleep 1200
        ${if} $KunInstallerStopAttempt <= 5
          Goto KunStopProcessesFromInstallDir
        ${endif}

        ${ifNot} ${isUpdated}
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY KunStopProcessesFromInstallDir
          Quit
        ${endif}

        DetailPrint "Verified ${PRODUCT_NAME} processes are still running; stopping uninstall to preserve the installation."
        !insertmacro KunAbortAutomaticUpdate process_stop_failed process_stop "Running application processes could not be stopped."
      ${else}
        DetailPrint "${PRODUCT_NAME} could not safely inspect processes; stopping without changing the installation."
        ${ifNot} ${isUpdated}
          MessageBox MB_RETRYCANCEL|MB_ICONSTOP "${PRODUCT_NAME} could not safely check whether an older installation is still using files.$\r$\nNo installation files were changed. Restart Windows, then run the installer again.$\r$\nIf this continues, send this diagnostic log to support:$\r$\n$KunInstallerStopDiagnosticPath" /SD IDCANCEL IDRETRY KunStopProcessesFromInstallDir
          Quit
        ${endif}

        DetailPrint "${PRODUCT_NAME} process inspection failed; stopping automatic update to preserve the installation."
        !insertmacro KunAbortAutomaticUpdate process_check_failed process_check "Application processes could not be inspected safely."
      ${endif}

    KunInstallDirProcessesStopped:
  !else
    Call KunPrepareInstallMigration
    StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${ifNot} ${Silent}
      SetSilent silent
      StrCpy $KunInstallerRestoreInteractive 1
    ${endif}
  !endif
!macroend
