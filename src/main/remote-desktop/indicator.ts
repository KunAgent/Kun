import { app, Menu, Tray } from 'electron'
import trayIcon from '../../asset/img/remote-desktop-tray.png?url'
import trayIconRetina from '../../asset/img/remote-desktop-tray@2x.png?url'
import { createMultiScaleIcon, prepareTrayIcon } from '../app-icon'
import type { DesktopEngineDependencies } from './session-service'

type DesktopIndicatorPort = NonNullable<DesktopEngineDependencies['indicator']>
type IndicatorStatus = Parameters<DesktopIndicatorPort['show']>[0]

export class DesktopShareIndicator implements DesktopIndicatorPort {
  private active?: { tray: Tray; end: () => void }

  show(value: IndicatorStatus, end: () => void): void {
    this.hide()
    const tray = new Tray(prepareTrayIcon(createMultiScaleIcon(trayIcon, trayIconRetina)))
    this.active = { tray, end }
    if (process.platform === 'win32') tray.on('click', () => tray.popUpContextMenu())
    try {
      this.update(value)
    } catch (error) {
      this.hide()
      throw error
    }
  }

  update(value: IndicatorStatus): void {
    const active = this.active
    if (!active) return
    const labels = app.getLocale().toLowerCase().startsWith('zh')
      ? { title: 'Kun · 远程桌面', view: '正在查看', control: '正在控制', end: '结束远控' }
      : { title: 'Kun · Remote desktop', view: 'Viewing', control: 'Controlling', end: 'End remote session' }
    const status = `${labels[value.mode]} · ${value.display.slice(0, 80)} · ${value.peer.slice(0, 8)}`
    active.tray.setToolTip(labels.title)
    active.tray.setContextMenu(Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: 'separator' },
      { label: labels.end, click: () => { if (this.active === active) active.end() } }
    ]))
  }

  hide(): void {
    const active = this.active
    this.active = undefined
    active?.tray.destroy()
  }
}
