; Wizard pages and copy for the Kun Windows installer (see docs/installer-ui-design.zh-CN.md).
; Texts are LangStrings so they follow the installer language; languages without
; a translation fall back to English because the English table is always present.

!macro kunInstallerPageStrings
  LangString kunWelcomeTitle ${LANG_ENGLISH} "Welcome to Kun"
  LangString kunWelcomeTitle ${LANG_SIMPCHINESE} "欢迎安装 Kun"
  LangString kunWelcomeText ${LANG_ENGLISH} "Kun is a local-first AI agent workspace.$\r$\n$\r$\nThis wizard installs ${PRODUCT_NAME} ${VERSION} on this computer. If Kun is running, Setup will ask you to close it first.$\r$\n$\r$\nYour existing conversations, settings and local data are kept.$\r$\n$\r$\nClick Next to continue."
  LangString kunWelcomeText ${LANG_SIMPCHINESE} "Kun 是本地优先的 AI 智能体工作台。$\r$\n$\r$\n安装向导会把 ${PRODUCT_NAME} ${VERSION} 安装到这台电脑。如果 Kun 正在运行，安装程序会提示你先关闭它。$\r$\n$\r$\n已有的会话、设置和本地数据都会保留。$\r$\n$\r$\n点击“下一步”继续。"
  LangString kunFinishTitle ${LANG_ENGLISH} "Kun is ready"
  LangString kunFinishTitle ${LANG_SIMPCHINESE} "Kun 已安装完成"
  LangString kunFinishText ${LANG_ENGLISH} "Kun is installed on this computer. Open it from the Start menu or the desktop shortcut.$\r$\n$\r$\nClick Finish to close Setup."
  LangString kunFinishText ${LANG_SIMPCHINESE} "Kun 已安装到这台电脑，可以从开始菜单或桌面快捷方式打开。$\r$\n$\r$\n点击“完成”关闭安装向导。"
  LangString kunFinishRun ${LANG_ENGLISH} "Run Kun"
  LangString kunFinishRun ${LANG_SIMPCHINESE} "运行 Kun(&R)"
  LangString kunUnWelcomeTitle ${LANG_ENGLISH} "Uninstall Kun"
  LangString kunUnWelcomeTitle ${LANG_SIMPCHINESE} "卸载 Kun"
  LangString kunUnWelcomeText ${LANG_ENGLISH} "This wizard removes the Kun program files and shortcuts from this computer.$\r$\n$\r$\nYour conversations, settings and local data are kept, so you can pick up where you left off after reinstalling.$\r$\n$\r$\nIf Kun is running, you will be asked to close it first.$\r$\n$\r$\nClick Next to continue."
  LangString kunUnWelcomeText ${LANG_SIMPCHINESE} "卸载向导会从这台电脑移除 Kun 的程序文件和快捷方式。$\r$\n$\r$\n你的会话、设置和本地数据会保留，重新安装后可以继续使用。$\r$\n$\r$\n如果 Kun 正在运行，卸载程序会提示你先关闭它。$\r$\n$\r$\n点击“下一步”继续。"

  ; The default Simplified Chinese dialog font is SimSun 9pt; use the UI font.
  SetFont /LANG=${LANG_SIMPCHINESE} "Microsoft YaHei UI" 9
!macroend

!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "$(kunWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(kunWelcomeText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "$(kunFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(kunFinishText)"
  !ifndef HIDE_RUN_AFTER_FINISH
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "$(kunFinishRun)"
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(kunUnWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(kunUnWelcomeText)"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
