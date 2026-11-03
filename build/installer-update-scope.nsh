!macro KunAutomaticUpdateScopeFunctions
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
    Call KunSetAutomaticUpdateShellEnvironment
    SetShellVarContext current
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_CURRENT_RECOVERY_ROOT", "$APPDATA\KunInstallerRecovery").r0'
    SetShellVarContext all
    System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_ALL_RECOVERY_ROOT", "$APPDATA\KunInstallerRecovery").r0'
    ${if} $installMode != "all"
      SetShellVarContext current
    ${endif}
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
!macroend
