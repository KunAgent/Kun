import { runAssistantMcpServerFromArgv } from './mcp-server'

void runAssistantMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[kun-assistants-mcp] missing --kun-assistant-mcp-server, --socket or --secret-file')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[kun-assistants-mcp] server failed:', error)
    process.exit(1)
  })
