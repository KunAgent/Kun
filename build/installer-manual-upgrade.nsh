!macro KunManualUpgradeFunctions
  Function KunCleanupPreparedSource
    ${if} $KunInstallerSourceDir == ""
      Return
    ${endif}

    DetailPrint "Cleaning only recognized application payload from $KunInstallerSourceDir."
    Call KunSetMigrationEnvironment
    !insertmacro kunRunMigrationHelper FallbackCleanup
    ${if} $KunInstallerHelperExitCode != 0
      MessageBox MB_OK|MB_ICONSTOP "Kun could not clean the previous application payload safely.$\r$\n$KunInstallerHelperOutput$\r$\nDiagnostic log: $KunInstallerDiagnosticPath" /SD IDOK
      !insertmacro KunAbortAutomaticUpdate cleanup_failed cleanup "The previous application payload could not be cleaned safely."
    ${endif}
  FunctionEnd

  Function KunAssertSelectedUninstallCommandSuppressed
    ClearErrors
    ReadRegStr $R0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${if} $R0 != ""
      MessageBox MB_OK|MB_ICONSTOP "Kun could not retire the previous uninstall registration safely." /SD IDOK
      !insertmacro KunAbortAutomaticUpdate uninstall_registration_retained cleanup "The previous uninstall registration could not be retired safely."
    ${endif}
  FunctionEnd

  Function KunAssertCurrentUserUninstallCommandSuppressed
    ClearErrors
    ReadRegStr $R0 HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${if} $R0 != ""
      MessageBox MB_OK|MB_ICONSTOP "Kun could not retire the previous current-user uninstall registration safely." /SD IDOK
      !insertmacro KunAbortAutomaticUpdate current_user_uninstall_registration_retained cleanup "The previous current-user uninstall registration could not be retired safely."
    ${endif}
  FunctionEnd
!macroend
