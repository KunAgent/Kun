let assistantMarkdownModule: Promise<typeof import('../components/chat/StreamdownAssistant')> | null = null

/**
 * Shared dynamic loader for the Streamdown assistant renderer. This module
 * deliberately has no React or store dependency so both UI components and
 * non-UI callers can warm the same underlying chunk without layering cycles.
 */
export function loadAssistantMarkdownRenderer(): Promise<typeof import('../components/chat/StreamdownAssistant')> {
  if (!assistantMarkdownModule) {
    assistantMarkdownModule = import('../components/chat/StreamdownAssistant').catch((error) => {
      assistantMarkdownModule = null
      throw error
    })
  }
  return assistantMarkdownModule
}

/** Warm the assistant Markdown renderer before it is revealed. */
export async function prepareAssistantMarkdownRenderer(): Promise<void> {
  await loadAssistantMarkdownRenderer()
}
