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
import clineUrl from '../assets/agent-icons/cline.svg?url'
import commandCodeUrl from '../assets/agent-icons/commandcode.svg?url'
import copilotUrl from '../assets/agent-icons/githubcopilot.svg?url'
import gooseUrl from '../assets/agent-icons/goose.svg?url'
import hermesUrl from '../assets/agent-icons/hermesagent.svg?url'
import jetbrainsUrl from '../assets/agent-icons/jetbrains.svg?url'
import mimoUrl from '../assets/agent-icons/xiaomimimo.svg?url'
import qoderUrl from '../assets/agent-icons/qoder.svg?url'
import zedUrl from '../assets/agent-icons/zed.svg?url'
import grokUrl from '../assets/provider-icons/grok.svg?url'
import kimiUrl from '../assets/provider-icons/kimi.svg?url'
import minimaxUrl from '../assets/provider-icons/minimax.svg?url'
import zaiUrl from '../assets/provider-icons/zai.svg?url'

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
  'deepseek-harness': deepseekUrl,
  'claude-desktop': claudeUrl,
  'cursor-cli': cursorUrl,
  'cursor-local': cursorUrl,
  mimocode: mimoUrl,
  kimi: kimiUrl,
  'minimax-code': minimaxUrl,
  grok: grokUrl,
  goose: gooseUrl,
  copilot: copilotUrl,
  hermes: hermesUrl,
  cline: clineUrl,
  qoder: qoderUrl,
  'qoder-cn': qoderUrl,
  commandcode: commandCodeUrl,
  zed: zedUrl,
  air: jetbrainsUrl,
  zcode: zaiUrl
}

/**
 * Built-in harnesses without a published vector mark get a stable monogram
 * instead of the generic robot, so the catalog stays scannable. Custom IDs
 * remain neutral because their names are user-controlled.
 */
const AGENT_MONOGRAMS: Readonly<Record<string, string>> = {
  fx: 'fx',
  omp: 'OMP',
  droid: 'D',
  aside: 'A',
  omo: 'OmO',
  crush: 'C',
  morph: 'MM',
  muse: 'M',
  empryo: 'E',
  atomcode: 'AC',
  openchamber: 'OC',
  vscode: 'VS',
  workbuddy: 'WB',
  pencil: 'P',
  t3code: 'T3',
  hanako: 'H',
  alma: 'A',
  cindy: 'C'
}

export function agentIconMonogram(harnessId: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(AGENT_MONOGRAMS, harnessId)
    ? AGENT_MONOGRAMS[harnessId]
    : undefined
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

  if (harnessId === 'opencode' || harnessId === 'opencode2') {
    // OpenCode and OpenCode Go are different brands. These square marks come
    // from OpenCode's own brand assets and retain their two-tone appearance.
    return (
      <span {...accessibility} className={`relative inline-flex shrink-0 ${className}`} style={style} data-agent-icon={harnessId}>
        <img src={openCodeLightUrl} alt="" aria-hidden="true" className="h-full w-full dark:hidden" />
        <img src={openCodeDarkUrl} alt="" aria-hidden="true" className="hidden h-full w-full dark:block" />
      </span>
    )
  }

  const asset = agentIconAssetUrl(harnessId)
  const monogram = asset ? undefined : agentIconMonogram(harnessId)
  if (monogram) {
    const fontSize = monogram.length >= 3 ? 7.5 : monogram.length === 2 ? 9.5 : 12
    return (
      <svg
        {...accessibility}
        viewBox="0 0 24 24"
        className={`shrink-0 ${className}`}
        style={style}
        data-agent-icon={harnessId}
      >
        <rect x="2" y="2" width="20" height="20" rx="5.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
        <text
          x="12"
          y="12.5"
          fill="currentColor"
          fontSize={fontSize}
          fontWeight={700}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif', letterSpacing: '-0.02em' }}
        >
          {monogram}
        </text>
      </svg>
    )
  }
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
