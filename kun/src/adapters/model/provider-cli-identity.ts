import { arch, release, type as osType } from 'node:os'

/** Verified against the Codex model catalog; older versions can hide new models. */
export const CODEX_CLI_VERSION = '0.153.3'
/** Pinned to current npm @google/gemini-cli. */
export const GEMINI_CLI_VERSION = '0.52.0'
/** Pinned to current grok / Grok Build CLI. */
export const GROK_CLI_VERSION = '0.2.112'

export const CODEX_CLI_ORIGINATOR = 'codex_cli_rs'
export const GROK_CLI_TOKEN_AUTH = 'xai-grok-cli'
export const GROK_CLI_CLIENT_IDENTIFIER = 'grok-shell'

export function codexCliUserAgent(version = CODEX_CLI_VERSION): string {
  return `${CODEX_CLI_ORIGINATOR}/${version} (${osType()} ${release()}; ${arch()})`
}

export function codexCliRequestHeaders(input: {
  accountId: string
  sessionId: string
}): Record<string, string> {
  return {
    'ChatGPT-Account-Id': input.accountId,
    originator: CODEX_CLI_ORIGINATOR,
    'OpenAI-Beta': 'responses=experimental',
    'User-Agent': codexCliUserAgent(),
    session_id: input.sessionId
  }
}

/**
 * Known-working Code Assist client identity (pre GeminiCLI/{ver}/{model} UA).
 * Kept here for shared STT/API callers; currently inlined at call sites for parity.
 */
export function geminiCliRequestHeaders(input: {
  model?: string
  purpose?: 'api' | 'audio'
} = {}): Record<string, string> {
  void input.model
  const purpose = input.purpose === 'audio' ? 'audio' : 'api'
  return {
    'user-agent': 'google-gemini-cli',
    'x-goog-api-client': `gl-node/kun gemini-cli-${purpose}`
  }
}

export function grokCliProxyHeaders(version = GROK_CLI_VERSION): Record<string, string> {
  return {
    'X-XAI-Token-Auth': GROK_CLI_TOKEN_AUTH,
    'x-authenticateresponse': 'authenticate-response',
    'x-grok-client-version': version,
    'x-grok-client-mode': 'interactive'
  }
}

export function grokCliMediaHeaders(version = GROK_CLI_VERSION): Record<string, string> {
  return {
    'User-Agent': `xai-grok-build/${version}`,
    'x-grok-client-version': version,
    'x-grok-client-identifier': GROK_CLI_CLIENT_IDENTIFIER
  }
}
