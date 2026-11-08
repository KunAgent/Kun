const messages: Record<string, string> = {
  vip_computer_remote_required: '电脑与电脑远程桌面仅限有效 Max 会员，请升级或续费 Max 后重新连接。',
  ENTITLEMENTS_UNAVAILABLE: '暂时无法确认 Max 会员权益，请刷新会员状态后重试。',
  DESKTOP_BUSY: '这台电脑正在进行另一条桌面连接，请先在被控端结束旧会话。',
  DESKTOP_VIEW_REQUIRED: '对端尚未允许查看，请在对端的「允许访问本机」中授权。',
  DESKTOP_CONTROL_REQUIRED: '暂时不能接管，请确认控制许可和画面状态。',
  DESKTOP_DISABLED: '对端未开启内置桌面访问。',
  DESKTOP_SOURCE_CHANGED: '对端显示器发生变化，请结束并重新连接。',
  SCREEN_PERMISSION_REQUIRED: '请在对端 Mac 的系统设置中允许 Kun 录制屏幕。',
  INPUT_PERMISSION_REQUIRED: '请在对端 Mac 的系统设置中允许 Kun 使用辅助功能。',
  DESKTOP_ICE_UNAVAILABLE: '暂时无法准备远程连接，请稍后重试。',
  DESKTOP_CLEANUP_UNCONFIRMED: '本机已断开，对端停止状态尚未确认，请先核对停止。',
  COMPUTER_SERVER_UPDATE_REQUIRED: '当前服务端尚未开启电脑互控，请更新并配置服务端。',
  COMPUTER_HOST_UPDATE_REQUIRED: '请更新对端 Kun 与控制包，再开启电脑桌面访问。',
  CONTROL_UPDATING: '控制包正在切换版本，请稍后重新连接。',
  CONTROL_PROCESS_UNAVAILABLE: '控制包暂不可用，请到远程访问面板检查或更新控制包。',
  CONTROL_VIEWER_UPGRADE_REQUIRED: '当前控制包缺少兼容的电脑查看器，请检查控制包更新。',
  CONTROL_VIEWER_START_TIMEOUT: '控制窗口未能启动，请检查控制包更新后重试。',
  CONTROL_VIEWER_START_FAILED: '控制窗口启动失败，请检查控制包更新后重试。',
  AUTHORIZATION_REQUIRED: '请先申请连接，并在对端电脑确认授权。',
  DEVICE_OFFLINE: '连接尚未就绪，请确认对端在线后刷新。',
  DESKTOP_WINDOW_INACTIVE: '请回到远程桌面窗口后重新接管。',
  DESKTOP_UNSUPPORTED: '首版电脑互控支持 Apple Silicon Mac。',
  LOGIN_REQUIRED: '请先登录 Kun 账号。',
  vip_mobile_remote_required: '远程访问需要 Plus、Pro 或 Max 会员。'
}
export function computerError(error: unknown, zh = true) {
  const text = error instanceof Error ? error.message : String(error)
  const key = Object.keys(messages).find(key => text.includes(key))
  return zh ? key ? messages[key] : '连接未完成，请检查账号、授权和网络后重试。' : key ?? 'Connection failed. Check account, permissions and network, then retry.'
}
