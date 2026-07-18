import { describe, expect, it } from 'vitest'
import type { ExtensionConsentBinding } from './extension-consent-service'
import {
  buildProtectedExtensionConsentDataUrl,
  localizeProtectedExtensionPrompt
} from './protected-extension-prompt'

function binding(overrides: Partial<ExtensionConsentBinding> = {}): ExtensionConsentBinding {
  return {
    extensionId: 'kun-examples.video-editor',
    extensionVersion: '0.3.0',
    operationKind: 'extension.permissions',
    parameters: {},
    workspaceRoot: '/Users/example/project',
    senderId: 7,
    protectedWindowSessionId: 'protected-window',
    ...overrides
  }
}

describe('protected extension prompt localization', () => {
  it('keeps English operation copy and localizes the Main-owned chrome', () => {
    expect(localizeProtectedExtensionPrompt(binding(), {
      title: 'Change extension permissions',
      message: 'Change permissions?',
      detail: 'Permission warning.'
    }, 'en')).toEqual({
      title: 'Change extension permissions',
      message: 'Change permissions?',
      detail: 'Permission warning.',
      approveLabel: 'Apply changes',
      cancelLabel: 'Cancel',
      extensionLabel: 'Extension',
      operationLabel: 'Operation',
      workspaceLabel: 'Workspace'
    })
  })

  it('localizes permission review content and confirmation controls in Chinese', () => {
    const prompt = localizeProtectedExtensionPrompt(binding(), {
      title: 'Review extension permissions',
      message: 'Review permissions.',
      detail: 'Requested broker permissions:\n• media.read\n\nNode extensions execute with your operating-system user privileges; this permission list is not an OS sandbox.'
    }, 'zh')

    expect(prompt).toMatchObject({
      title: '审核扩展权限',
      message: '请审核 kun-examples.video-editor 0.3.0 申请的权限。',
      approveLabel: '继续',
      cancelLabel: '取消',
      extensionLabel: '扩展',
      operationLabel: '操作',
      workspaceLabel: '工作区'
    })
    expect(prompt.detail).toContain('申请的 Broker 权限：')
    expect(prompt.detail).toContain('并不是操作系统沙箱')
  })

  it('builds a fixed-shell consent document with a scrolling review and pinned actions', () => {
    const dataUrl = buildProtectedExtensionConsentDataUrl({
      title: '更改扩展权限',
      message: '要更改 example.video 1.0.0 的权限吗？',
      detail: '新增权限：\n• workspace.write\n\n<script>alert(1)</script>',
      approveLabel: '同意更改',
      cancelLabel: '取消',
      extensionLabel: '扩展',
      operationLabel: '操作',
      workspaceLabel: '工作区',
      extensionValue: 'example.video 1.0.0',
      operationValue: 'extension.permissions',
      workspaceValue: '/Users/example/project'
    })
    const html = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1))

    expect(html).toContain('grid-template-rows:auto minmax(0,1fr) auto')
    expect(html).toContain('.scroll-region{min-height:0;overflow-y:auto')
    expect(html).toContain('<footer class="footer">')
    expect(html).toContain('id="consent-cancel"')
    expect(html).toContain('id="consent-approve"')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('localizes the permission-change warning used by the right-rail trust review', () => {
    const prompt = localizeProtectedExtensionPrompt(binding(), {
      title: 'Change extension permissions',
      message: 'Change permissions?',
      detail: [
        'This permission change applies only to the selected workspace.',
        'Added broker permissions:\n• workspace.write',
        'Removed broker permissions:\n• none',
        'Resulting broker permissions:\n• workspace.write',
        'Host-authored risk summary:\n• Runs Node code with your operating-system user privileges.\n• Workspace write permission can create or modify files in the approved workspace.',
        'Broker permissions are capability gates; the extension Node host itself is not an operating-system sandbox.'
      ].join('\n\n')
    }, 'zh')

    expect(prompt).toMatchObject({
      title: '更改扩展权限',
      message: '要更改 kun-examples.video-editor 0.3.0 的权限吗？',
      approveLabel: '同意更改',
      cancelLabel: '取消'
    })
    expect(prompt.detail).toContain('新增的 Broker 权限：\n• workspace.write')
    expect(prompt.detail).toContain('移除的 Broker 权限：\n• 无')
    expect(prompt.detail).toContain('工作区写入权限可在已批准的工作区中创建或修改文件。')
    expect(prompt.detail).toContain('扩展 Node Host 本身并不是操作系统沙箱。')
  })

  it('labels the combined permission review as the single enable decision', () => {
    const prompt = localizeProtectedExtensionPrompt(binding(), {
      title: 'Review permissions and enable extension',
      message: 'Review permissions and enable?',
      detail: [
        'After approval, Kun will apply these permissions to the selected workspace and enable the extension globally.',
        'Resulting broker permissions:\n• ui.views'
      ].join('\n\n')
    }, 'zh')

    expect(prompt).toMatchObject({
      title: '审核权限并启用扩展',
      message: '请审核 kun-examples.video-editor 0.3.0 的权限，确认后将立即启用。',
      approveLabel: '应用并启用'
    })
    expect(prompt.detail).toContain('应用到当前工作区，并在全局启用此扩展')
    expect(prompt.detail).toContain('变更后的 Broker 权限：')
  })

  it('localizes the complete install review without discarding security evidence', () => {
    const prompt = localizeProtectedExtensionPrompt(binding({
      operationKind: 'extension.install',
      workspaceRoot: undefined
    }), {
      title: 'Install extension',
      message: 'Install extension?',
      detail: [
        'Extensions with Node entrypoints execute with your operating-system user privileges. Broker permissions are not an OS sandbox.',
        'Source: Local .kunx archive\n/tmp/video.kunx',
        'Package SHA-256: abc123',
        'Signature: unsigned.',
        'Host-authored risk summary:\n• Runs Node code with your operating-system user privileges.',
        'Requested broker permissions:\n• media.read',
        'Kun will revalidate package integrity, compatibility, and declared resources before activation.'
      ].join('\n\n')
    }, 'zh')

    expect(prompt.title).toBe('安装扩展')
    expect(prompt.message).toBe('要安装 kun-examples.video-editor 0.3.0 吗？')
    expect(prompt.detail).toContain('本地 .kunx 归档包')
    expect(prompt.detail).toContain('扩展包 SHA-256： abc123')
    expect(prompt.detail).toContain('签名：未签名。')
    expect(prompt.detail).toContain('Node 代码使用当前操作系统用户的权限运行。')
    expect(prompt.detail).toContain('申请的 Broker 权限：')
  })

  it('preserves custom operation copy while still localizing trusted dialog chrome', () => {
    expect(localizeProtectedExtensionPrompt(binding({
      operationKind: 'acme.custom-operation'
    }), {
      title: 'Custom review title',
      message: 'Custom operation semantics',
      detail: 'Custom detail'
    }, 'zh')).toMatchObject({
      title: 'Custom review title',
      message: 'Custom operation semantics',
      detail: 'Custom detail',
      approveLabel: '继续',
      cancelLabel: '取消'
    })
  })

  it('retains provider binding security evidence while localizing it', () => {
    const prompt = localizeProtectedExtensionPrompt(binding({
      operationKind: 'provider.bind'
    }), {
      title: 'Use extension model provider',
      message: 'Allow Example Provider to handle Kun model requests?',
      detail: [
        'Provider: Example (provider.example)',
        'Model: example-model',
        'Account reference: account-1',
        'The extension Node adapter can receive:',
        '• complete conversation history',
        '• system and mode instructions',
        '• attachments when present (text, image)',
        '• advertised tool names, descriptions, and input schemas',
        'Kun stores only the provider, opaque account reference, model, extension version, and acknowledgement. Credential material is not copied into this binding. Requests will fail explicitly if this exact provider/account/model becomes unavailable.'
      ].join('\n')
    }, 'zh')

    expect(prompt.message).toBe('要允许 Example Provider 处理 Kun 的模型请求吗？')
    expect(prompt.detail).toContain('提供商： Example (provider.example)')
    expect(prompt.detail).toContain('模型： example-model')
    expect(prompt.detail).toContain('账户引用： account-1')
    expect(prompt.detail).toContain('完整的对话历史')
    expect(prompt.detail).toContain('凭据内容不会复制到此绑定中')
  })
})
