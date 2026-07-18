'use strict'

const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')
const {
  CONTRIBUTION_ID,
  EXTENSION_ID,
  EXTENSION_VERSION,
  MODEL_NAME,
  SUCCESS_MARKER,
  VIDEO_EDITOR_PERMISSIONS,
  assertLocalizedFirstLaunchPermissionPrompt,
  desktopVideoEditorSettings,
  openAiTextFrames,
  openAiToolCallFrames,
  resolveVideoEditorArchive
} = require('./smoke-packaged-video-editor-desktop.cjs')

test('resolves only the catalogued bundled video editor archive or an explicit .kunx', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kun-video-editor-desktop-archive-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bundled = join(root, 'bundled-extensions')
  await mkdir(bundled, { recursive: true })
  const archive = join(bundled, 'kun-video-editor-0.4.4.kunx')
  await writeFile(archive, 'archive bytes')
  await writeFile(join(bundled, 'catalog.json'), `${JSON.stringify({
    schemaVersion: 1,
    extensions: [{ id: EXTENSION_ID, archive: 'kun-video-editor-0.4.4.kunx' }]
  })}\n`)

  assert.equal(await resolveVideoEditorArchive(root), archive)
  assert.equal(await resolveVideoEditorArchive(root, archive), archive)
  const notKunx = join(root, 'archive.zip')
  await writeFile(notKunx, 'wrong extension')
  await assert.rejects(resolveVideoEditorArchive(root, notKunx), /must end with \.kunx/)

  await writeFile(join(bundled, 'catalog.json'), `${JSON.stringify({
    schemaVersion: 1,
    extensions: []
  })}\n`)
  await assert.rejects(resolveVideoEditorArchive(root), /exactly one/)
})

test('seeds a Chinese light desktop profile against an offline OpenAI-compatible model', () => {
  const settings = desktopVideoEditorSettings({
    runtimePort: 43123,
    workspaceRoot: '/isolated/workspace',
    dataDir: '/isolated/home/.kun/data',
    modelBaseUrl: 'http://127.0.0.1:43124/v1'
  })
  assert.equal(settings.locale, 'zh')
  assert.equal(settings.theme, 'light')
  assert.equal(settings.workspaceRoot, '/isolated/workspace')
  assert.equal(settings.agents.kun.dataDir, '/isolated/home/.kun/data')
  assert.equal(settings.agents.kun.port, 43123)
  assert.equal(settings.agents.kun.baseUrl, 'http://127.0.0.1:43124/v1')
  assert.equal(settings.agents.kun.model, MODEL_NAME)
  assert.equal(settings.agents.kun.endpointFormat, 'openai-chat-completions')
  assert.equal(settings.agents.kun.approvalPolicy, 'auto')
  assert.equal(settings.agents.kun.sandboxMode, 'danger-full-access')
})

test('emits bounded OpenAI SSE frames for the Agent extension-tool round trip', () => {
  const toolFrames = openAiToolCallFrames({
    toolName: 'ext_123_video-project',
    argumentsJson: '{"action":"select","projectId":"alpha"}'
  })
  assert.equal(toolFrames.at(-1), 'data: [DONE]\n\n')
  const toolPayload = JSON.parse(toolFrames[0].slice('data: '.length))
  assert.deepEqual(toolPayload.choices[0].delta.tool_calls[0].function, {
    name: 'ext_123_video-project',
    arguments: '{"action":"select","projectId":"alpha"}'
  })
  const finishPayload = JSON.parse(toolFrames[1].slice('data: '.length))
  assert.equal(finishPayload.choices[0].finish_reason, 'tool_calls')

  const textFrames = openAiTextFrames('selected')
  assert.equal(JSON.parse(textFrames[0].slice('data: '.length)).choices[0].delta.content, 'selected')
  assert.equal(JSON.parse(textFrames[1].slice('data: '.length)).choices[0].finish_reason, 'stop')
  assert.equal(textFrames.at(-1), 'data: [DONE]\n\n')
})

test('requires the first-launch protected prompt to expose localized permissions and host risks', () => {
  const workspaceRoot = '/isolated/workspace'
  const detail = [
    '此次权限变更仅适用于所选工作区。',
    '变更后的 Broker 权限：',
    ...VIDEO_EDITOR_PERMISSIONS.map((permission) => `• ${permission}`),
    'Kun 生成的风险摘要：',
    'Node 代码使用当前操作系统用户的权限运行。',
    '工作区读取权限可访问已批准工作区中的文件和扩展状态。',
    '工作区写入权限可在已批准的工作区中创建或修改文件。',
    '媒体读取权限可通过不透明授权检查用户选择的本地媒体。',
    '媒体处理和任务权限可运行并管理持久化的本地任务。',
    '媒体导出权限可写入用户批准的输出位置。',
    'Agent 和工具权限可启动私有 Agent 运行，并向 Kun 提供声明的工具。',
    '扩展 Node Host 本身并不是操作系统沙箱。'
  ].join('\n')
  const prompt = {
    title: '更改扩展权限',
    heading: '更改扩展权限',
    message: `要更改 ${EXTENSION_ID} ${EXTENSION_VERSION} 的权限吗？`,
    detail,
    meta: {
      扩展: `${EXTENSION_ID} ${EXTENSION_VERSION}`,
      操作: 'extension.permissions',
      工作区: workspaceRoot
    },
    approveLabel: '同意更改',
    cancelLabel: '取消',
    approveVisible: true,
    cancelVisible: true,
    scrollOverflowY: 'auto',
    scrollClientHeight: 480,
    scrollHeight: 760,
    scrollTop: 100,
    scrollBottom: 580,
    footerTop: 580,
    footerBottom: 640,
    viewportHeight: 640
  }

  assert.equal(
    assertLocalizedFirstLaunchPermissionPrompt(prompt, { workspaceRoot }),
    prompt
  )
  assert.throws(
    () => assertLocalizedFirstLaunchPermissionPrompt({
      ...prompt,
      detail: detail.replace('扩展 Node Host 本身并不是操作系统沙箱。', '')
    }, { workspaceRoot }),
    /并不是操作系统沙箱/
  )
  assert.throws(
    () => assertLocalizedFirstLaunchPermissionPrompt({
      ...prompt,
      meta: { ...prompt.meta, 操作: 'extension.install' }
    }, { workspaceRoot }),
    /metadata mismatch/
  )
  assert.throws(
    () => assertLocalizedFirstLaunchPermissionPrompt({ ...prompt, approveVisible: false }, { workspaceRoot }),
    /approveVisible mismatch/
  )
  assert.throws(
    () => assertLocalizedFirstLaunchPermissionPrompt({ ...prompt, footerBottom: 642 }, { workspaceRoot }),
    /outside the visible protected window/
  )
})

test('source smoke keeps the editor hidden from the rail and opens it from Extension management', async () => {
  assert.equal(CONTRIBUTION_ID, 'extension:kun-examples.kun-video-editor/editor')
  assert.match(SUCCESS_MARKER, /desktop E2E OK/)
  const source = await readFile(join(__dirname, 'smoke-packaged-video-editor-desktop.cjs'), 'utf8')
  for (const marker of [
    "require('playwright-core')",
    '_electron.launch',
    'chromiumSandbox: true',
    'electronApplication.evaluate',
    'dialog.showOpenDialog',
    'dialog.showSaveDialog',
    'webContents.getAllWebContents',
    'assertVideoEditorHiddenFromRightRail',
    'openVideoEditorManagementCard',
    'extensionGetWorkbench',
    'showInRightRail === false',
    'Authorize to open Kun Video Editor',
    'Review and apply in protected window',
    "'更改扩展权限'",
    "操作: 'extension.permissions'",
    "window.locator('#consent-approve')",
    "window.locator('#consent-cancel')",
    "permissionPromptWindow.locator('#consent-approve').click()",
    "document.querySelectorAll('.meta-row')",
    'scrollOverflowY',
    'footerBottom',
    "'变更后的 Broker 权限：'",
    "'扩展 Node Host 本身并不是操作系统沙箱。'",
    "'开始你的第一支作品'",
    "'.onboarding-project-card'",
    "'.create-project-toggle'",
    "'导入媒体'",
    "'导入逐字稿'",
    "'.transcript-cut'",
    "'生成字幕'",
    "'#video-editor-tab-output'",
    "'.output-kind-options'",
    "'.export-primary-row'",
    "'导出 SRT'",
    "'ready to deliver'",
    "'Output mode'",
    "'/v1/threads'",
    'video-project extension tool',
    "locale: 'en', theme: 'dark'",
    'setTimeout(() => app.quit(), 0)',
    'await delay(1_000)',
    'electronApplication.close()',
    'terminateProcessTree(firstRunProcess',
    'relaunch reused the original PID',
    'desktop PID ${firstDesktopPid} -> ${relaunchedDesktopPid}',
    'Install FFmpeg with libx264 and AAC',
    'KUN_FFMPEG_PATH/KUN_FFPROBE_PATH',
    'jobStates.includes(\'completed\')'
  ]) assert.ok(source.includes(marker), `desktop video E2E omits source marker: ${marker}`)
  assert.doesNotMatch(source, /grantVideoEditorWorkspaceTrust/u)
  assert.doesNotMatch(source, /queues\.permissionPrompt|matchesPermissionPrompt/u)
  assert.doesNotMatch(source, /['"]--no-sandbox['"]/u)
  assert.doesNotMatch(source, /https?:\/\/(?!127\.0\.0\.1|invalid\.example)/u)
})

test('package scripts expose the opt-in desktop E2E and release-gate its lightweight contract test', async () => {
  const packageJson = JSON.parse(await readFile(resolve(__dirname, '..', 'package.json'), 'utf8'))
  assert.equal(
    packageJson.scripts['smoke:packaged-video-editor-desktop'],
    'node ./scripts/smoke-packaged-video-editor-desktop.cjs'
  )
  assert.equal(packageJson.devDependencies['playwright-core'], '1.61.1')
  assert.ok(
    packageJson.scripts['check:extension-release-gate']
      .includes('./scripts/smoke-packaged-video-editor-desktop.test.cjs')
  )
  assert.ok(
    !packageJson.scripts['check:extension-release-gate']
      .includes('node ./scripts/smoke-packaged-video-editor-desktop.cjs')
  )
})
