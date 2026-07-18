import type { ExtensionConsentBinding } from './extension-consent-service'

export type ProtectedExtensionPromptCopy = {
  title: string
  message: string
  detail?: string
}

export type ProtectedExtensionPromptLocale = 'en' | 'zh'

export type ProtectedExtensionPromptPresentation = ProtectedExtensionPromptCopy & {
  approveLabel: string
  cancelLabel: string
  extensionLabel: string
  operationLabel: string
  workspaceLabel: string
}

export type ProtectedExtensionConsentDocument = ProtectedExtensionPromptPresentation & {
  extensionValue: string
  operationValue: string
  workspaceValue?: string
}

/**
 * Localizes Main-owned consent chrome and the known host-authored operations.
 * Unknown/custom consent copy is kept verbatim so localization never changes
 * the meaning of an extension-specific operation.
 */
export function localizeProtectedExtensionPrompt(
  binding: ExtensionConsentBinding,
  copy: ProtectedExtensionPromptCopy,
  locale: ProtectedExtensionPromptLocale
): ProtectedExtensionPromptPresentation {
  const permissionEnable = binding.operationKind === 'extension.permissions' &&
    copy.title === 'Review permissions and enable extension'
  if (locale !== 'zh') {
    const permissionChange = binding.operationKind === 'extension.permissions' && copy.title === 'Change extension permissions'
    return {
      ...copy,
      approveLabel: permissionEnable ? 'Apply and enable' : permissionChange ? 'Apply changes' : 'Continue',
      cancelLabel: 'Cancel',
      extensionLabel: 'Extension',
      operationLabel: 'Operation',
      workspaceLabel: 'Workspace'
    }
  }

  const localized = localizeKnownChineseCopy(binding, copy)
  const permissionChange = binding.operationKind === 'extension.permissions' && copy.title === 'Change extension permissions'
  return {
    ...localized,
    approveLabel: permissionEnable ? '应用并启用' : permissionChange ? '同意更改' : '继续',
    cancelLabel: '取消',
    extensionLabel: '扩展',
    operationLabel: '操作',
    workspaceLabel: '工作区'
  }
}

/**
 * Main-owned consent document. The middle review region is the only scrolling
 * area, so long permission/risk lists cannot push the decision controls below
 * the visible display. All values are escaped and the data URL forbids script.
 */
export function buildProtectedExtensionConsentDataUrl(
  prompt: ProtectedExtensionConsentDocument
): string {
  const title = escapeHtml(prompt.title)
  const message = escapeHtml(prompt.message)
  const approveLabel = escapeHtml(prompt.approveLabel)
  const cancelLabel = escapeHtml(prompt.cancelLabel)
  const meta = [
    [prompt.extensionLabel, prompt.extensionValue],
    [prompt.operationLabel, prompt.operationValue],
    ...(prompt.workspaceValue ? [[prompt.workspaceLabel, prompt.workspaceValue]] : [])
  ].map(([label, value]) => `<div class="meta-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')
  const detail = prompt.detail
    ? `<section class="review" aria-label="${title}"><div class="review-text">${escapeHtml(prompt.detail)}</div></section>`
    : ''
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><meta name="color-scheme" content="light dark"><title>${title}</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark;background:Canvas;color:CanvasText}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:Canvas;color:CanvasText}.header{display:grid;grid-template-columns:44px minmax(0,1fr);gap:15px;padding:22px 26px 18px;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent);background:color-mix(in srgb,Canvas 96%,#f59e0b 4%)}.warning{display:flex;width:44px;height:44px;align-items:center;justify-content:center;border-radius:13px;background:#fff4d6;color:#9a5b00;font-size:25px;font-weight:800;border:1px solid #f4cc6a}.header h1{margin:1px 0 6px;font-size:19px;line-height:1.25}.header p{margin:0;color:color-mix(in srgb,CanvasText 68%,transparent);font-size:14px;line-height:1.5}.scroll-region{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:20px 26px 24px}.meta{display:grid;gap:8px;margin:0 0 18px;padding:14px 16px;border:1px solid color-mix(in srgb,CanvasText 12%,transparent);border-radius:12px;background:color-mix(in srgb,CanvasText 3%,Canvas)}.meta-row{display:grid;grid-template-columns:92px minmax(0,1fr);gap:12px;font-size:13px;line-height:1.5}.meta dt{color:color-mix(in srgb,CanvasText 58%,transparent)}.meta dd{min-width:0;margin:0;overflow-wrap:anywhere;font-weight:550}.review{border:1px solid color-mix(in srgb,CanvasText 12%,transparent);border-radius:12px;background:color-mix(in srgb,CanvasText 2%,Canvas)}.review-text{padding:17px 18px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px;line-height:1.58;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.footer{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:15px 26px 17px;border-top:1px solid color-mix(in srgb,CanvasText 13%,transparent);background:Canvas;box-shadow:0 -10px 28px color-mix(in srgb,CanvasText 6%,transparent)}button{min-width:104px;min-height:42px;border:1px solid color-mix(in srgb,CanvasText 22%,transparent);border-radius:9px;padding:9px 18px;font:600 14px/1.2 inherit;background:ButtonFace;color:ButtonText;cursor:pointer}button:hover{background:color-mix(in srgb,ButtonFace 88%,CanvasText 12%)}button:focus-visible{outline:3px solid color-mix(in srgb,#1685ff 55%,transparent);outline-offset:2px}.primary{border-color:#147ce5;background:#147ce5;color:white}.primary:hover{background:#086dcc}@media(max-width:520px){.header{grid-template-columns:38px minmax(0,1fr);padding:18px}.warning{width:38px;height:38px}.scroll-region{padding:16px 18px}.footer{padding:13px 18px}.meta-row{grid-template-columns:1fr;gap:2px}}
</style></head><body><header class="header"><div class="warning" aria-hidden="true">!</div><div><h1>${title}</h1><p>${message}</p></div></header><main class="scroll-region" tabindex="0"><dl class="meta">${meta}</dl>${detail}</main><footer class="footer"><button id="consent-cancel" type="button">${cancelLabel}</button><button id="consent-approve" class="primary" type="button">${approveLabel}</button></footer></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function localizeKnownChineseCopy(
  binding: ExtensionConsentBinding,
  copy: ProtectedExtensionPromptCopy
): ProtectedExtensionPromptCopy {
  const identity = `${binding.extensionId} ${binding.extensionVersion}`
  const key = `${binding.operationKind}\u0000${copy.title}`

  switch (key) {
    case 'extension.install\u0000Install extension':
      return {
        title: '安装扩展',
        message: `要安装 ${identity} 吗？`,
        detail: copy.detail ? localizeInstallReviewDetail(copy.detail) : undefined
      }
    case 'extension.enable\u0000Enable extension':
      return {
        title: '启用扩展',
        message: `要启用 ${identity} 吗？`,
        detail: '启用后，扩展的 Node 代码可以使用当前操作系统用户的权限运行。'
      }
    case 'extension.permissions\u0000Change extension permissions':
      return {
        title: '更改扩展权限',
        message: `要更改 ${identity} 的权限吗？`,
        detail: copy.detail ? localizePermissionChangeReviewDetail(copy.detail) : undefined
      }
    case 'extension.permissions\u0000Review permissions and enable extension':
      return {
        title: '审核权限并启用扩展',
        message: `请审核 ${identity} 的权限，确认后将立即启用。`,
        detail: copy.detail ? localizePermissionChangeReviewDetail(copy.detail) : undefined
      }
    case 'extension.permissions\u0000Review extension permissions':
      return {
        title: '审核扩展权限',
        message: `请审核 ${identity} 申请的权限。`,
        detail: copy.detail ? localizePermissionReviewDetail(copy.detail) : undefined
      }
    case 'extension.rollback\u0000Roll back extension':
      return {
        title: '回滚扩展',
        message: `要回滚 ${binding.extensionId} 吗？`,
        detail: 'Kun 将切换到保留的上一版本扩展包，并恢复兼容的状态快照。'
      }
    case 'extension.uninstall\u0000Uninstall extension':
      return {
        title: '卸载扩展',
        message: `要卸载 ${identity} 吗？`,
        detail: '扩展包文件将被移除。除非另行删除，否则扩展数据和凭据会继续保留。'
      }
    case 'extension.reload\u0000Reload development extension':
      return {
        title: '重新加载开发扩展',
        message: `要从开发目录重新加载 ${binding.extensionId} 吗？`,
        detail: '激活前，Kun 会再次验证可变的开发源代码。'
      }
    case 'account.create-session\u0000Connect provider account':
      return {
        title: '连接提供商账户',
        message: copy.message.replace(
          /^Start account authorization for (.+)\?$/,
          '要为 $1 启动账户授权吗？'
        ),
        detail: copy.detail
          ?.replace(
            /^Kun will activate (.+) for the declared authentication flow\. Extension Webviews cannot approve this action\.$/m,
            'Kun 将为声明的身份验证流程激活 $1。扩展 Webview 无法代替你批准此操作。'
          )
          .replace(/^OAuth scopes:/m, 'OAuth 范围：')
      }
    case 'account.delete\u0000Delete provider account':
      return {
        title: '删除提供商账户',
        message: copy.message.replace(
          /^Delete the selected (.+) account\?$/,
          '要删除所选的 $1 账户吗？'
        ),
        detail: '保存的凭据将被删除；依赖此账户的提供商绑定需要重新选择账户。'
      }
    case 'provider.bind\u0000Use extension model provider':
      return {
        title: '使用扩展模型提供商',
        message: copy.message.replace(
          /^Allow (.+) to handle Kun model requests\?$/,
          '要允许 $1 处理 Kun 的模型请求吗？'
        ),
        detail: copy.detail ? localizeProviderBindingDetail(copy.detail) : undefined
      }
    default:
      return copy
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]!)
}

function localizeProviderBindingDetail(detail: string): string {
  return detail
    .replace(/^Provider:/m, '提供商：')
    .replace(/^Model:/m, '模型：')
    .replace(/^Account reference:/m, '账户引用：')
    .replace('The extension Node adapter can receive:', '扩展的 Node 适配器可以接收：')
    .replace('complete conversation history', '完整的对话历史')
    .replace('system and mode instructions', '系统指令和模式指令')
    .replace('attachments when present', '存在附件时的附件')
    .replace('declared input types', '声明的输入类型')
    .replace('advertised tool names, descriptions, and input schemas', '公开的工具名称、描述和输入 Schema')
    .replace(
      'Kun stores only the provider, opaque account reference, model, extension version, and acknowledgement. Credential material is not copied into this binding. Requests will fail explicitly if this exact provider/account/model becomes unavailable.',
      'Kun 只保存提供商、不透明的账户引用、模型、扩展版本和确认记录。凭据内容不会复制到此绑定中。如果这个确切的提供商、账户或模型不可用，请求会明确失败。'
    )
}

function localizePermissionReviewDetail(detail: string): string {
  return detail
    .replace('Requested broker permissions:', '申请的 Broker 权限：')
    .replace(
      'Node extensions execute with your operating-system user privileges; this permission list is not an OS sandbox.',
      'Node 扩展使用当前操作系统用户的权限运行；此权限列表并不是操作系统沙箱。'
    )
    .replace(
      'This version requests no broker permissions. Node code still executes with your operating-system user privileges.',
      '此版本未申请 Broker 权限。Node 代码仍会使用当前操作系统用户的权限运行。'
    )
}

function localizePermissionChangeReviewDetail(detail: string): string {
  return detail
    .replace('After approval, Kun will apply these permissions to the selected workspace and enable the extension globally.', '确认后，Kun 会把这些权限应用到当前工作区，并在全局启用此扩展。')
    .replace('After approval, Kun will apply these permissions and enable the extension in the selected workspace.', '确认后，Kun 会应用这些权限，并在当前工作区启用此扩展。')
    .replace('This permission change applies only to the selected workspace.', '此次权限变更仅适用于所选工作区。')
    .replace('Added broker permissions:', '新增的 Broker 权限：')
    .replace('Removed broker permissions:', '移除的 Broker 权限：')
    .replace('Resulting broker permissions:', '变更后的 Broker 权限：')
    .replace('Host-authored risk summary:', 'Kun 生成的风险摘要：')
    .replace(/• none/gu, '• 无')
    .replace('Runs Node code with your operating-system user privileges.', 'Node 代码使用当前操作系统用户的权限运行。')
    .replace('Workspace read permission can expose files and extension state from the approved workspace.', '工作区读取权限可访问已批准工作区中的文件和扩展状态。')
    .replace('Workspace write permission can create or modify files in the approved workspace.', '工作区写入权限可在已批准的工作区中创建或修改文件。')
    .replace('Media read permission can inspect user-selected local media through opaque grants.', '媒体读取权限可通过不透明授权检查用户选择的本地媒体。')
    .replace('Media processing and job permissions can run and manage durable local work.', '媒体处理和任务权限可运行并管理持久化的本地任务。')
    .replace('Media export permission can write to user-approved output targets.', '媒体导出权限可写入用户批准的输出位置。')
    .replace('Agent and tool permissions can start private Agent runs and expose declared tools to Kun.', 'Agent 和工具权限可启动私有 Agent 运行，并向 Kun 提供声明的工具。')
    .replace('Direct DOM permission can read and alter visible workbench content and may imitate ordinary UI.', 'Direct DOM 权限可读取和修改可见工作台内容，并可能仿冒普通界面。')
    .replace('External Webview permission can display approved remote websites inside an isolated browser session.', '外部 Webview 权限可在隔离的浏览器会话中显示已批准的远程网站。')
    .replace('Provider permission can receive full model inputs when the user explicitly selects that provider.', '用户明确选择该提供商后，提供商权限可接收完整的模型输入。')
    .replace('Secret-read permission can reveal a selected raw account secret to this extension\'s Node host after a separate allow-once decision.', '单独批准一次后，密钥读取权限可向此扩展的 Node Host 显示所选账户的原始密钥。')
    .replace('Network permission can send brokered data to the declared destination hosts.', '网络权限可将 Broker 数据发送到声明的目标主机。')
    .replace('Shell permission can start external processes after applicable host policy and consent checks.', '通过适用的 Host 策略和确认检查后，Shell 权限可启动外部进程。')
    .replace('Broker permissions are capability gates; the extension Node host itself is not an operating-system sandbox.', 'Broker 权限用于限制能力；扩展 Node Host 本身并不是操作系统沙箱。')
}

function localizeInstallReviewDetail(detail: string): string {
  return detail
    .replace(
      'Extensions with Node entrypoints execute with your operating-system user privileges. Broker permissions are not an OS sandbox.',
      '包含 Node 入口的扩展会使用当前操作系统用户的权限运行。Broker 权限并不是操作系统沙箱。'
    )
    .replace(/^Source:/m, '来源：')
    .replace('Local .kunx archive', '本地 .kunx 归档包')
    .replace('Development directory', '开发目录')
    .replace('Custom HTTPS Index', '自定义 HTTPS 索引')
    .replace(
      'Package identity: mutable development directory (files can change without reinstalling).',
      '扩展包身份：可变的开发目录（文件无需重新安装即可发生变化）。'
    )
    .replace(/^Package SHA-256:/m, '扩展包 SHA-256：')
    .replace('Signature: verified.', '签名：已验证。')
    .replace('Signature: signature present, but not verified by Kun.', '签名：存在签名，但 Kun 尚未验证。')
    .replace('Signature: unsigned.', '签名：未签名。')
    .replace('Host-authored risk summary:', 'Kun 生成的风险摘要：')
    .replace('no additional high-risk contribution detected.', '未检测到其他高风险贡献。')
    .replace('Requested broker permissions:', '申请的 Broker 权限：')
    .replace('This package requests no broker permissions.', '此扩展包未申请 Broker 权限。')
    .replace(
      'Runs Node code with your operating-system user privileges.',
      'Node 代码使用当前操作系统用户的权限运行。'
    )
    .replace(
      'Direct DOM permission can read and alter visible workbench content and may imitate ordinary UI.',
      'Direct DOM 权限可以读取和更改可见的工作台内容，也可能模仿普通界面。'
    )
    .replace(
      'Provider permission can receive full model inputs when the user explicitly selects that provider.',
      '当用户明确选择该提供商时，Provider 权限可以接收完整的模型输入。'
    )
    .replace(
      "Secret-read permission can reveal a selected raw account secret to this extension's Node host after a separate allow-once decision.",
      'Secret-read 权限可在另一次“仅允许一次”的确认后，向此扩展的 Node Host 提供所选账户的原始密钥。'
    )
    .replace(
      'Network permission can send brokered data to the declared destination hosts.',
      'Network 权限可以把 Broker 提供的数据发送到扩展声明的目标主机。'
    )
    .replace(
      'Shell permission can start external processes after applicable host policy and consent checks.',
      'Shell 权限可以在通过主机策略与确认检查后启动外部进程。'
    )
    .replace(
      'Includes sandboxed extension UI; its brokered capabilities still depend on the grants below.',
      '包含沙箱化的扩展界面；它通过 Broker 使用的能力仍取决于下列授权。'
    )
    .replace(
      'Kun will download this exact version, verify the displayed SHA-256, then revalidate the package manifest, integrity, compatibility, and permission metadata before activation.',
      'Kun 将下载此确切版本、验证上方显示的 SHA-256，并在激活前重新验证清单、完整性、兼容性和权限元数据。'
    )
    .replace(
      'Kun will revalidate package integrity, compatibility, and declared resources before activation.',
      '激活前，Kun 会重新验证扩展包完整性、兼容性和声明的资源。'
    )
    .replace(/• …and (\d+) more/g, '• ……另有 $1 项')
}
