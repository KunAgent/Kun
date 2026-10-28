import type { StartupFailureKind } from './startup-failure-content'

export type StartupFailureLanguage = 'en' | 'zh'

type KindCopy = { title: string; summary: string; steps: string[] }

export type StartupFailureCopy = {
  kinds: Record<StartupFailureKind, KindCopy>
  handoffSafe: string
  handoffUnverified: string
  handoffUnverifiedStep: string
  safeData: string
  stepsHeading: string
  detailsHeading: string
  errorLabel: string
  logLabel: string
  logEmpty: string
  logMissing: string
  launchLabel: string
  versionLabel: string
  pathLabel: string
  logDirLabel: string
  retry: string
  recheck: string
  recover: string
  handoffRetry: string
  busyRetry: string
  busyRecheck: string
  busyRecover: string
  busyHandoff: string
  copyDiagnostics: string
  openLogFolder: string
  openLogFile: string
  quit: string
  retryFailed: string
  copied: string
  busyHint: string
}

const en: StartupFailureCopy = {
  kinds: {
    'manager-exited': {
      title: 'Kun\'s background service stopped while starting',
      summary: 'The local data service Kun starts first exited before it was ready. Nothing was deleted, and this is often a one-off.',
      steps: [
        'Select Retry Kun. Most of the time the next start succeeds.',
        'If it fails again, read the service log below for the reason the service exited.',
        'Make sure the disk has free space and the Kun data folder is writable.',
        'Still stuck? Copy the diagnostics and share them with the Kun team.'
      ]
    },
    'start-lock': {
      title: 'Another Kun is still starting or closing',
      summary: 'Kun found a startup lock held by another window or terminal and stopped so the two would not collide.',
      steps: [
        'Wait a few seconds for the other Kun window or terminal to finish, or quit it.',
        'Select Recheck Kun. It only re-reads the lock and never stops a live client.'
      ]
    },
    orphaned: {
      title: 'A previous Kun session did not shut down cleanly',
      summary: 'Leftover processes from the last run are still registered. Kun can verify they belong to it and clean them up.',
      steps: [
        'Select Recover Kun. Only processes recorded by the previous Kun session are stopped.',
        'Processes whose ownership cannot be verified are left untouched.'
      ]
    },
    'manager-leftover': {
      title: 'An older Kun background service is still running',
      summary: 'A data service from a different Kun build is still active, and this version cannot reuse it.',
      steps: [
        'Quit any other Kun window or terminal that is still open.',
        'Select Recheck Kun to confirm the old owner is gone and shut the leftover service down.'
      ]
    },
    'manager-unavailable': {
      title: 'Kun could not reach its background service',
      summary: 'The local data service did not answer. Kun verifies ownership before it changes anything.',
      steps: [
        'Select Recheck Kun.',
        'If it keeps failing, read the service log below and check that security software is not blocking local (127.0.0.1) connections.'
      ]
    },
    'runtime-auth': {
      title: 'The local Runtime rejected Kun\'s credential',
      summary: 'The Runtime this desktop started did not accept its saved access credential.',
      steps: ['Select Retry Kun. Only this desktop\'s own Runtime is restarted.']
    },
    'client-busy': {
      title: 'Another Kun client is using the Runtime',
      summary: 'A Kun window or terminal (TUI) owns the Runtime right now. Kun will not stop it because it may have active work.',
      steps: [
        'Close the other Kun window or terminal session.',
        'Select Retry Kun.'
      ]
    },
    handoff: {
      title: 'Kun could not complete the update handoff',
      summary: '',
      steps: [
        'Select the retry button to let Kun stop the previous version safely.',
        'If it fails again, quit the other Kun and reopen this one.'
      ]
    },
    integrity: {
      title: 'Kun\'s installation looks damaged',
      summary: 'A required startup component failed its integrity check, so Kun did not start it.',
      steps: [
        'Download and reinstall Kun from the official release page.',
        'Saved conversations and settings live outside the app and are kept.'
      ]
    },
    generic: {
      title: 'Kun could not finish starting',
      summary: 'The application is still running so you can inspect the failure or retry.',
      steps: [
        'Select Retry Kun.',
        'If it fails again, open the logs to see what went wrong.',
        'Copy the diagnostics and share them with the Kun team if you need help.'
      ]
    }
  },
  handoffSafe: 'Kun identified the previous local owner. It will pause and checkpoint active work before retrying the safe handoff, without deleting your saved conversations.',
  handoffUnverified: 'Kun could not safely verify the previous local owner, so it left the process, active work, and saved data untouched.',
  handoffUnverifiedStep: 'Quit the other Kun process yourself, then reopen Kun.',
  safeData: 'Your conversations and settings are safe',
  stepsHeading: 'What you can do',
  detailsHeading: 'Technical details',
  errorLabel: 'Error',
  logLabel: 'Latest log lines',
  logEmpty: 'The log file is empty. The process exited before it wrote anything.',
  logMissing: 'No log file was found.',
  launchLabel: 'This launch',
  versionLabel: 'This app version:',
  pathLabel: 'This app path:',
  logDirLabel: 'Log directory',
  retry: 'Retry Kun',
  recheck: 'Recheck Kun',
  recover: 'Recover Kun',
  handoffRetry: 'Safely stop old Kun and retry',
  busyRetry: 'Stopping this desktop Runtime safely…',
  busyRecheck: 'Checking Service Manager ownership…',
  busyRecover: 'Recovering leftover Kun processes…',
  busyHandoff: 'Safely stopping old Kun…',
  copyDiagnostics: 'Copy diagnostics',
  openLogFolder: 'Open log folder',
  openLogFile: 'Open log file',
  quit: 'Quit',
  retryFailed: 'Retry failed:',
  copied: 'Diagnostics copied to the clipboard.',
  busyHint: 'Kun restarts automatically when this finishes. Quit cancels it.'
}

const zh: StartupFailureCopy = {
  kinds: {
    'manager-exited': {
      title: 'Kun 后台服务在启动时退出了',
      summary: 'Kun 最先启动的本地数据服务还没就绪就退出了。没有任何数据被删除，这通常是偶发问题。',
      steps: [
        '点击「重试」，大多数情况下再次启动就能成功。',
        '如果仍然失败，查看下方服务日志，了解服务退出的原因。',
        '确认磁盘还有剩余空间，并且 Kun 数据目录可写。',
        '还是不行？复制诊断信息发给 Kun 团队。'
      ]
    },
    'start-lock': {
      title: '另一个 Kun 正在启动或退出',
      summary: '另一个窗口或终端持有启动锁，为避免冲突，Kun 暂停了启动。',
      steps: [
        '等待几秒让另一个 Kun 窗口或终端完成，或者先退出它。',
        '点击「重新检查」。它只会重新读取启动锁，不会停止正在运行的客户端。'
      ]
    },
    orphaned: {
      title: '上一次 Kun 没有正常退出',
      summary: '上次运行留下的进程仍在登记中。Kun 可以确认它们属于自己后再清理。',
      steps: [
        '点击「恢复 Kun」，只会停止上一次 Kun 会话记录过的进程。',
        '无法确认归属的进程不会被触碰。'
      ]
    },
    'manager-leftover': {
      title: '旧版本的 Kun 后台服务仍在运行',
      summary: '另一个 Kun 版本的数据服务还在运行，当前版本无法复用它。',
      steps: [
        '先退出其他仍然打开的 Kun 窗口或终端。',
        '点击「重新检查」，确认旧的所有者已退出后关闭残留服务。'
      ]
    },
    'manager-unavailable': {
      title: 'Kun 无法连接后台服务',
      summary: '本地数据服务没有响应。Kun 会先确认归属，再做任何改动。',
      steps: [
        '点击「重新检查」。',
        '如果一直失败，查看下方服务日志，并确认安全软件没有拦截本机（127.0.0.1）连接。'
      ]
    },
    'runtime-auth': {
      title: '本地 Runtime 拒绝了 Kun 的访问凭据',
      summary: '这个桌面端启动的 Runtime 不接受已保存的访问凭据。',
      steps: ['点击「重试」，只会重启这个桌面端自己的 Runtime。']
    },
    'client-busy': {
      title: '另一个 Kun 客户端正在使用 Runtime',
      summary: '某个 Kun 窗口或终端（TUI）正占用 Runtime。它可能有进行中的任务，Kun 不会自动停止它。',
      steps: ['关闭另一个 Kun 窗口或终端会话。', '点击「重试」。']
    },
    handoff: {
      title: 'Kun 未能完成版本交接',
      summary: '',
      steps: [
        '点击重试按钮，让 Kun 安全地停止旧版本。',
        '如果仍然失败，退出另一个 Kun 后重新打开当前版本。'
      ]
    },
    integrity: {
      title: 'Kun 安装文件似乎已损坏',
      summary: '一个必需的启动组件没有通过完整性校验，Kun 没有启动它。',
      steps: [
        '从官方发布页重新下载并安装 Kun。',
        '已保存的对话和设置存放在应用之外，会被保留。'
      ]
    },
    generic: {
      title: 'Kun 未能完成启动',
      summary: '应用仍在运行，你可以查看失败原因或重试。',
      steps: [
        '点击「重试」。',
        '如果仍然失败，打开日志查看出错原因。',
        '需要帮助时，复制诊断信息发给 Kun 团队。'
      ]
    }
  },
  handoffSafe: 'Kun 已确认上一个本地所有者。重试安全交接前会先暂停并保存进行中的任务，不会删除已保存的对话。',
  handoffUnverified: 'Kun 无法安全确认上一个本地所有者，因此没有触碰该进程、进行中的任务和已保存的数据。',
  handoffUnverifiedStep: '请先手动退出另一个 Kun 进程，再重新打开 Kun。',
  safeData: '你的对话和设置都安全',
  stepsHeading: '可以这样处理',
  detailsHeading: '技术详情',
  errorLabel: '错误信息',
  logLabel: '最近的日志',
  logEmpty: '日志文件是空的，进程在写入任何内容之前就退出了。',
  logMissing: '没有找到日志文件。',
  launchLabel: '本次启动',
  versionLabel: '应用版本：',
  pathLabel: '应用路径：',
  logDirLabel: '日志目录',
  retry: '重试',
  recheck: '重新检查',
  recover: '恢复 Kun',
  handoffRetry: '安全停止旧版本并重试',
  busyRetry: '正在安全停止本机 Runtime…',
  busyRecheck: '正在检查后台服务归属…',
  busyRecover: '正在清理残留的 Kun 进程…',
  busyHandoff: '正在安全停止旧版本…',
  copyDiagnostics: '复制诊断信息',
  openLogFolder: '打开日志目录',
  openLogFile: '打开日志文件',
  quit: '退出',
  retryFailed: '重试失败：',
  copied: '诊断信息已复制到剪贴板。',
  busyHint: '完成后 Kun 会自动重新启动，点击「退出」可取消。'
}

export function startupFailureLanguage(locale: string | undefined): StartupFailureLanguage {
  return locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function startupFailureCopy(language: StartupFailureLanguage): StartupFailureCopy {
  return language === 'zh' ? zh : en
}
