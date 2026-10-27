import { AppPresetSchema, type AppPreset } from './app-connections.js'

const platforms = ['darwin', 'win32', 'linux'] as const

// Planned presets are descriptive only: callers must reject them until their
// backend and end-to-end authorization have been verified.
const definitions: AppPreset[] = [
  { id: 'google_gmail', appId: 'google_gmail', runtimeProviderId: 'google_gmail',
    name: 'Gmail', kind: 'native_gmail', availability: 'ready', platforms: [...platforms],
    docsUrl: 'https://support.google.com/mail/' },
  { id: 'github', appId: 'github', runtimeProviderId: 'github',
    name: 'GitHub', kind: 'native_github', availability: 'ready', platforms: [...platforms],
    docsUrl: 'https://docs.github.com/en/apps' },
  { id: 'notion', appId: 'notion', runtimeProviderId: 'mcp:notion',
    name: 'Notion', kind: 'mcp_oauth', availability: 'planned', platforms: [...platforms],
    endpoint: 'https://mcp.notion.com/mcp', registration: 'discover',
    docsUrl: 'https://developers.notion.com/guides/mcp/build-mcp-client' },
  { id: 'figma-desktop', appId: 'figma', runtimeProviderId: 'mcp:figma-desktop',
    name: 'Figma Desktop', kind: 'mcp_local', availability: 'planned', platforms: ['darwin', 'win32'],
    endpoint: 'http://127.0.0.1:3845/mcp',
    docsUrl: 'https://developers.figma.com/docs/figma-mcp-server/local-server-installation/' },
  { id: 'figma-api', appId: 'figma', runtimeProviderId: 'native:figma',
    name: 'Figma API', kind: 'native_figma', availability: 'planned', platforms: [...platforms],
    docsUrl: 'https://developers.figma.com/docs/rest-api/' },
  { id: 'figma-remote', appId: 'figma', runtimeProviderId: 'mcp:figma-remote',
    name: 'Figma Remote', kind: 'mcp_oauth', availability: 'vendor_approval', platforms: [...platforms],
    endpoint: 'https://mcp.figma.com/mcp', registration: 'discover',
    docsUrl: 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/' }
]

export const APP_PRESETS: readonly AppPreset[] = definitions.map((definition) => AppPresetSchema.parse(definition))
export function appPreset(id: string): AppPreset | undefined {
  return APP_PRESETS.find((preset) => preset.id === id)
}
