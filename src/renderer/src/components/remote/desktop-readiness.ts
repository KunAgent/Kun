import type { DesktopAccessStatus } from '@shared/remote-desktop'

export function desktopReadiness(value: DesktopAccessStatus, zh: boolean) {
  if (!value.supported) return { warning: true, label: zh ? '当前电脑暂不支持' : 'Unsupported computer',
    detail: zh ? '首版支持 M 芯片 Mac、macOS 13 及以上，并需要完整的 Kun 安装包。' : 'Requires an Apple Silicon Mac, macOS 13 or later, and a complete Kun installation.' }
  if (!value.displays.some(display => display.allowed)) return { warning: true, label: zh ? '待选择显示器' : 'Select a display',
    detail: zh ? '先勾选下方显示器，再开启内置远控。' : 'Select a display below, then enable built-in remote desktop.' }
  if (!value.enabled) return { warning: true, label: zh ? '内置远控未开启' : 'Built-in desktop is off',
    detail: zh ? '显示器已选择，点击「开启内置远控」。重启 Kun 后需重新开启。' : 'A display is selected. Enable built-in desktop again after restarting Kun.' }
  if (!value.ready) return { warning: true, label: zh ? '开关已开，仍需系统授权' : 'Enabled; system permission needed',
    detail: zh ? '当前 Kun 进程尚未获得屏幕录制权限，手机暂时收不到画面。' : 'This Kun process does not yet have Screen Recording permission; the phone cannot receive video.' }
  if (value.inputReady === false) return { warning: true, label: zh ? '电脑可共享，键鼠权限待开启' : 'Sharing ready; input permission needed',
    detail: zh ? '可以先只看画面。需要接管时，再完成系统的键鼠控制授权。' : 'Viewing is available. Grant system Accessibility permission before taking control.' }
  if (value.inputReady === undefined) return { warning: true, label: zh ? '电脑可共享，键鼠状态待确认' : 'Sharing ready; input status unknown',
    detail: zh ? '可以先只看画面。请重新检查键鼠权限后再接管。' : 'Viewing is available. Recheck input permission before taking control.' }
  return { warning: false, label: zh ? '电脑端已就绪' : 'Computer ready',
    detail: zh ? '请再确认下方这台手机已获桌面查看或控制权限，并点击保存。' : 'Also grant the phone below desktop viewing or control permission and save.' }
}

export function desktopFailureMessage(code: string, zh: boolean) {
  switch (code) {
    case 'SCREEN_PERMISSION_REQUIRED': return zh ? '上次连接未成功：当前 Kun 尚未获得屏幕录制权限。' : 'Last connection failed: Kun needs Screen Recording permission.'
    case 'INPUT_PERMISSION_REQUIRED': return zh ? '上次接管未成功：当前 Kun 尚未获得键鼠控制权限。' : 'Last takeover failed: Kun needs Accessibility permission.'
    case 'DESKTOP_VIEW_REQUIRED': return zh ? '上次连接未成功：请为该手机保存桌面查看权限。' : 'Last connection failed: save desktop viewing permission for the phone.'
    case 'DESKTOP_ICE_UNAVAILABLE': return zh ? '上次连接未成功：暂时无法取得中继连接信息，请检查网络后重试。' : 'Last connection failed: relay information is unavailable. Check the network and retry.'
    case 'DESKTOP_CLEANUP_UNCONFIRMED': return zh ? '尚未确认远控资源已释放，请再次点击结束远控。' : 'Cleanup is not confirmed. End the desktop session again.'
    default: return zh ? '上次远控操作未完成，请在手机重试并查看具体提示。' : 'The last desktop action did not complete. Retry on the phone for details.'
  }
}
