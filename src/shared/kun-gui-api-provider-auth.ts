import type {
  CodexAuthPollResult,
  CodexAuthStartResult,
  CodexBrowserAuthResult,
  GrokBrowserAuthResult,
  ProviderAuthProxySelection
} from './kun-gui-api-contracts'

export type ProviderAuthApi = {
  startCodexAuth(selection: ProviderAuthProxySelection): Promise<CodexAuthStartResult>
  pollCodexAuth(
    deviceCode: string,
    userCode: string,
    selection: ProviderAuthProxySelection
  ): Promise<CodexAuthPollResult>
  startCodexBrowserAuth(selection: ProviderAuthProxySelection): Promise<CodexBrowserAuthResult>
  startGrokBrowserAuth(selection: ProviderAuthProxySelection): Promise<GrokBrowserAuthResult>
}
