; Expanded after the pinned builder defines its extraction macros, but before
; installApplicationFiles expands them. Never change installed payload behavior.
!macro KunInstallExtractionTracing
  !macroundef extractEmbeddedAppPackage
  !macroundef identify_package
  !macroundef compute_files_for_current_arch
  !macroundef custom_files_post_decompression
  !macroundef arm64_app_files
  !macroundef x64_app_files
  !macroundef ia32_app_files
  !macroundef decompress
  !macroundef extractUsing7za
  !include "${PROJECT_DIR}\build\installer-extraction-template.nsh"
!macroend

; Preserve the prepared/cutover state, all registers, the stack and error flag.
; Labels contain no paths, user data or command lines. A returned marker means
; only that the native call returned; it is not a successful integrity check.
!macro KunTraceExtraction STEP
  ${if} $KunInstallerTransactionPath != ""
    Push $KunInstallerUpdateBoundary
    StrCpy $KunInstallerUpdateBoundary "${STEP}"
    Call KunRecordAutomaticUpdateBoundary
    Pop $KunInstallerUpdateBoundary
  ${endif}
!macroend
