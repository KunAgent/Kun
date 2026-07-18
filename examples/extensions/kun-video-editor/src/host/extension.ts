import type { ExtensionContext } from '@kun/extension-api'

export * from '../engine/index.js'
export * from './tool-contracts.js'
export * from './derived-media-service.js'
export * from './generation-control-plane.js'
export * from './generation-service.js'
export * from './media-intelligence-service.js'
export * from './multicam-control.js'
export * from './kun-audio-analysis-broker.js'
export * from './professional-export.js'
export * from './otio-interchange-service.js'
export * from './video-tools.js'

import { VideoEditorTools } from './video-tools.js'

export async function activate(context: ExtensionContext): Promise<void> {
  const tools = new VideoEditorTools(context)
  await tools.register()
  context.subscriptions.add(
    await context.commands.registerCommand('editor-request', async (args) =>
      tools.editorRequest(args ?? { action: 'project.list', payload: {} })
    )
  )
}

export async function deactivate(): Promise<void> {
  // Kun owns extension subscription disposal.
}
