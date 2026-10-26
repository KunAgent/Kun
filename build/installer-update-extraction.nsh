; electron-builder calls these after embedded payload decompression but before
; it writes the uninstaller, registry and shortcuts. Copy the short private
; extraction tree into the authenticated stage, then direct the uninstaller
; File instruction there before restoring original-source registration.
!macro KunPrepareAutomaticUpdateRegistration
  ${if} ${isUpdated}
    Call KunRestorePreCutoverRegistrationTarget
  ${endif}
!macroend

!macro customFiles_x64
  !insertmacro KunPrepareAutomaticUpdateRegistration
!macroend

!macro customFiles_ia32
  !insertmacro KunPrepareAutomaticUpdateRegistration
!macroend

!macro customFiles_arm64
  !insertmacro KunPrepareAutomaticUpdateRegistration
!macroend

!macro KunAutomaticUpdateExtractionFunctions
  Function KunAssertPreCutoverRegistration
    Push $R7
    Push $R8
    Push $R9
    StrCpy $R9 0
    ${if} ${Errors}
      StrCpy $R9 1
    ${endif}
    ClearErrors
    ReadRegStr $R8 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ; PrimarySourceDir was normalized by the source-resolution helper. NSIS's
    ; string comparison is case-insensitive; a different path must fail closed.
    ${if} ${Errors}
    ${orIf} $R8 != $KunInstallerPrimarySourceDir
      !insertmacro KunAbortAutomaticUpdate registration_changed_before_cutover prepare "The installation registration changed before payload activation."
    ${endif}
    StrCpy $R7 $KunInstallerUpdateBoundary
    StrCpy $KunInstallerUpdateBoundary "registration-original"
    Call KunRecordAutomaticUpdateBoundary
    StrCpy $KunInstallerUpdateBoundary $R7
    ClearErrors
    ${if} $R9 == 1
      SetErrors
    ${endif}
    Pop $R9
    Pop $R8
    Pop $R7
  FunctionEnd

  Function KunRestorePreCutoverRegistrationTarget
    ${if} $KunInstallerMigrationPrepared != 1
    ${orIf} $KunInstallerPrimarySourceDir == ""
    ${orIf} $KunInstallerStageDir == ""
      !insertmacro KunAbortAutomaticUpdate registration_not_prepared prepare "The update cannot publish shell registration before preparation."
    ${endif}
    ; Never authorize an arbitrary extraction path from the environment. The
    ; helper derives the fixed candidate child from its own plugin directory,
    ; validates the prepared transaction, and uses extended-path native copy.
    !insertmacro kunRunMigrationHelper StageExtractedUpdatePayload
    ${if} $KunInstallerHelperExitCode != 0
      !insertmacro KunAbortAutomaticUpdate candidate_staging_failed prepare "The extracted update could not be safely staged."
    ${endif}
    ; The builder writes its uninstaller after this hook. Do not leave it in
    ; the disposable extraction tree, nor write it into the active source.
    ClearErrors
    SetOutPath $KunInstallerStageDir
    ${if} ${Errors}
      !insertmacro KunAbortAutomaticUpdate candidate_output_failed prepare "The authenticated update stage could not be selected."
    ${endif}
    ; Resolve the preserved executable, including the legacy product filename.
    ; This also revalidates the transaction before publishing any shell state.
    Delete "$KunInstallerResultPath"
    !insertmacro kunRunMigrationHelper ResolveRecoveryExecutable
    ${if} $KunInstallerHelperExitCode == 0
      Call KunReadMigrationResult
    ${endif}
    ${if} $KunInstallerHelperExitCode != 0
    ${orIf} $KunInstallerHelperOutput == ""
      !insertmacro KunAbortAutomaticUpdate registration_source_unavailable prepare "The preserved application could not be resolved before shell registration."
    ${endif}
    ; Do not publish the temporary stage (or a not-yet-created legacy target).
    ; customInstall switches the payload and rebuilds the final shell state.
    StrCpy $INSTDIR $KunInstallerPrimarySourceDir
    StrCpy $appExe $KunInstallerHelperOutput
  FunctionEnd
!macroend
