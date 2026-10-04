import type { CSSProperties, ReactElement } from 'react'
import { Bot } from 'lucide-react'
import antigravityUrl from '../assets/provider-icons/antigravity.svg?url'
import claudeUrl from '../assets/provider-icons/claude.svg?url'
import codexUrl from '../assets/provider-icons/codex.svg?url'
import cursorUrl from '../assets/provider-icons/cursor.svg?url'
import geminiUrl from '../assets/provider-icons/gemini.svg?url'
import kunUrl from '../../../asset/img/kun_tray_mac.svg?url'
import openCodeLightUrl from '../assets/agent-icons/opencode-logo-light-square.svg?url'
import openCodeDarkUrl from '../assets/agent-icons/opencode-logo-dark-square.svg?url'
import deepseekUrl from '../assets/provider-icons/deepseek.svg?url'
import devinUrl from '../assets/agent-icons/devin.svg?url'
import piUrl from '../assets/agent-icons/pi.svg?url'

/** Agent identity is keyed by the trusted harness ID, never by model/provider. */
const AGENT_ASSETS: Readonly<Record<string, string>> = {
  kun: kunUrl,
  'claude-code': claudeUrl,
  cursor: cursorUrl,
  antigravity: antigravityUrl,
  'gemini-cli': geminiUrl,
  codex: codexUrl,
  devin: devinUrl,
  pi: piUrl,
  'deepseek-harness': deepseekUrl
}

export type AgentIconProps = {
  harnessId: string
  size?: number
  className?: string
  label?: string
}

export function agentIconAssetUrl(harnessId: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(AGENT_ASSETS, harnessId)
    ? AGENT_ASSETS[harnessId]
    : undefined
}

export function AgentIcon({
  harnessId,
  size = 16,
  className = '',
  label
}: AgentIconProps): ReactElement {
  const style: CSSProperties = { width: size, height: size, flex: 'none' }
  const accessibility = label
    ? { role: 'img' as const, 'aria-label': label }
    : { 'aria-hidden': true as const }

  if (harnessId === 'opencode') {
    // OpenCode and OpenCode Go are different brands. These square marks come
    // from OpenCode's own brand assets and retain their two-tone appearance.
    return (
      <span {...accessibility} className={`relative inline-flex shrink-0 ${className}`} style={style} data-agent-icon="opencode">
        <img src={openCodeLightUrl} alt="" aria-hidden="true" className="h-full w-full dark:hidden" />
        <img src={openCodeDarkUrl} alt="" aria-hidden="true" className="hidden h-full w-full dark:block" />
      </span>
    )
  }

  const asset = agentIconAssetUrl(harnessId)
  if (!asset) {
    return <Bot {...accessibility} className={className} style={style} strokeWidth={1.75} data-agent-icon="unknown" />
  }
  return (
    <span
      {...accessibility}
      className={`inline-block shrink-0 ${className}`}
      style={{
        ...style,
        backgroundColor: 'currentColor',
        WebkitMaskImage: `url("${asset}")`,
        maskImage: `url("${asset}")`,
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        maskSize: 'contain'
      }}
      data-agent-icon={harnessId}
    />
  )
}
