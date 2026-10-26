; electron-builder calls these after embedded payload decompression but before
; it writes the uninstaller, registry and shortcuts. Keep OUTDIR at the stage:
; the uninstaller File instruction must still become part of the candidate.
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
  Function KunRestorePreCutoverRegistrationTarget
    ${if} $KunInstallerMigrationPrepared != 1
    ${orIf} $KunInstallerPrimarySourceDir == ""
    ${orIf} $KunInstallerStageDir == ""
      !insertmacro KunAbortAutomaticUpdate registration_not_prepared prepare "The update cannot publish shell registration before preparation."
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
