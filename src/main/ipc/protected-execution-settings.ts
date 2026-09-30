import { nativeTheme, type IpcMainInvokeEvent } from 'electron'
import type { AppSettingsPatch, AppSettingsV1 } from '../../shared/app-settings'
import { approvalReviewSelectionEquals } from '../../../kun/src/contracts/approval-review-config'
import { showProtectedRoomDialog } from '../protected-room-dialog'
import { KunExecutionSettingsConsentService, executionSettingsEqual, kunExecutionSettingsChange,
  type KunExecutionSecuritySettings } from '../execution-settings-consent'
import type { NativeDialogCoordinator } from '../native-dialog-coordinator'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender, dialogParentIsAvailable, revealDialogParent, trustedWorkbenchSenderIsCurrent } from './app-ipc-handler-utils'

function describeSettings(value: KunExecutionSecuritySettings, zh: boolean) {
  const policies = zh ? {
    always: '每次都请求审批', 'on-request': '需要时请求审批', untrusted: '不受信任的操作需要审批',
    never: '不请求审批，拒绝需要审批的操作', auto: '自动允许操作', suggest: '建议操作并等待审阅'
  } : {
    always: 'Ask before every action', 'on-request': 'Ask when approval is needed', untrusted: 'Ask for untrusted actions',
    never: 'Do not ask; deny actions that need approval', auto: 'Allow actions automatically', suggest: 'Suggest actions for review'
  }
  const scopes = zh ? {
    'read-only': '只读访问', 'workspace-write': '允许修改工作区', 'danger-full-access': '完全访问本机', 'external-sandbox': '使用外部环境的访问限制'
  } : {
    'read-only': 'Read only', 'workspace-write': 'Allow workspace changes', 'danger-full-access': 'Full access to this computer', 'external-sandbox': 'Use the external environment limits'
  }
  const review = value.approvalReview.mode === 'fixed'
    ? `${value.approvalReview.providerId}${value.approvalReview.accountId ? ` (${zh ? '账号' : 'Account'}: ${value.approvalReview.accountId})` : ''} / ${value.approvalReview.model}`
    : zh ? '跟随当前对话模型' : 'Use the acting conversation model'
  return {
    approvalPolicy: policies[value.approvalPolicy], sandboxMode: scopes[value.sandboxMode],
    approvalReviewer: value.approvalReviewer === 'user' ? zh ? '你' : 'You' : zh ? '审批模型' : 'Approval model',
    approvalReview: review
  }
}

function describeChanges(before: KunExecutionSecuritySettings, after: KunExecutionSecuritySettings, zh: boolean): string {
  const previous = describeSettings(before, zh), next = describeSettings(after, zh)
  const fields = [
    ['approvalPolicy', zh ? '审批方式' : 'Approval'], ['sandboxMode', zh ? '访问范围' : 'Access'],
    ['approvalReviewer', zh ? '由谁确认' : 'Reviewed by'], ['approvalReview', zh ? '审批模型' : 'Review model']
  ] as const
  return fields.filter(([key]) => key === 'approvalReview'
    ? !approvalReviewSelectionEquals(before.approvalReview, after.approvalReview) : before[key] !== after[key])
    .map(([key, label]) => `${label}${zh ? '：' : ': '}${previous[key]} → ${next[key]}`).join('\n')
}

export function protectedExecutionSettings(options: RegisterAppIpcHandlersOptions, dialogs: NativeDialogCoordinator) {
  const consents = new KunExecutionSettingsConsentService()
  return async (
    event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
    partial: AppSettingsPatch,
    persist: (patch: AppSettingsPatch) => Promise<AppSettingsV1>
  ): Promise<AppSettingsV1> => {
    const current = await options.store.load()
    const detected = kunExecutionSettingsChange(current, partial)
    if (!detected) return persist(partial)
    const change = structuredClone(detected)
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const parent = options.getMainWindow(), senderFrame = event.senderFrame
    if (!parent || parent.isDestroyed() || !senderFrame) throw new Error('Protected execution-settings window is unavailable.')
    const senderCurrent = () => options.getMainWindow() === parent && dialogParentIsAvailable(parent) && trustedWorkbenchSenderIsCurrent(event, parent)
    const stillCurrent = async () => senderCurrent() && executionSettingsEqual((await options.store.load()).agents.kun, change.current) && senderCurrent()
    const zh = current.locale.startsWith('zh')
    const full = change.next.approvalPolicy === 'auto' && change.next.sandboxMode === 'danger-full-access' && change.next.approvalReviewer === 'user'
    const allowed = await dialogs.run(parent.webContents, async () => {
      if (!await stillCurrent()) return false
      revealDialogParent(parent)
      return showProtectedRoomDialog(parent, {
        kind: 'permissions', language: zh ? 'zh' : 'en',
        title: zh ? '更改工具权限' : 'Change tool permissions',
        subtitle: zh ? 'Kun · 应用设置' : 'Kun · App settings',
        description: full
          ? zh ? '完全访问允许 Kun 无需逐次审批地访问本地文件、执行命令和使用联网工具。' : 'Full access lets Kun access local files, run commands and use network tools without individual approvals.'
          : zh ? '请确认之后使用的审批方式和访问范围。' : 'Review the approval rules and access scope for future work.',
        bodyLabel: zh ? '本次变更' : 'Changes',
        body: describeChanges(change.current, change.next, zh),
        workspaceLabel: zh ? '作用目录' : 'Working directory',
        footnote: zh ? '应用后使用这些权限设置；当前运行保持已接受的权限。' : 'Apply these settings for future work. Current runs keep their accepted permissions.',
        cancelLabel: zh ? '取消' : 'Cancel', confirmLabel: zh ? '应用设置' : 'Apply settings',
        dark: current.theme === 'dark' || current.theme === 'system' && nativeTheme.shouldUseDarkColors, accent: full
      }, stillCurrent)
    })
    if (!allowed) return current
    if (!senderCurrent()) throw new Error('Execution-settings confirmation is no longer current; retry the change.')
    const latest = await options.store.load()
    if (!executionSettingsEqual(latest.agents.kun, change.current)) {
      throw new Error('Kun execution settings changed while confirmation was open; retry the change.')
    }
    if (!senderCurrent()) throw new Error('Execution-settings confirmation is no longer current; retry the change.')
    const action = { ...change, senderId: event.sender.id, senderProcessId: senderFrame.processId, senderRoutingId: senderFrame.routingId }
    const consent = consents.issue(action)
    if (!consents.consume(consent, action)) throw new Error('Protected execution-settings consent is invalid or expired.')
    return persist(partial)
  }
}
