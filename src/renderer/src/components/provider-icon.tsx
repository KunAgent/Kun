import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  ReactElement
} from 'react'
import alibabaIconUrl from '../assets/provider-icons/alibaba.svg?url'
import antigravityIconUrl from '../assets/provider-icons/antigravity.svg?url'
import claudeIconUrl from '../assets/provider-icons/claude.svg?url'
import codexIconUrl from '../assets/provider-icons/codex.svg?url'
import cursorIconUrl from '../assets/provider-icons/cursor.svg?url'
import deepseekIconUrl from '../assets/provider-icons/deepseek.svg?url'
import doubaoIconUrl from '../assets/provider-icons/doubao.svg?url'
import geminiIconUrl from '../assets/provider-icons/gemini.svg?url'
import grokIconUrl from '../assets/provider-icons/grok.svg?url'
import kimiIconUrl from '../assets/provider-icons/kimi.svg?url'
import litellmIconUrl from '../assets/provider-icons/litellm.svg?url'
import longcatIconUrl from '../assets/provider-icons/longcat.svg?url'
import mimoIconUrl from '../assets/provider-icons/mimo.svg?url'
import minimaxIconUrl from '../assets/provider-icons/minimax.svg?url'
import ollamaIconUrl from '../assets/provider-icons/ollama.svg?url'
import opencodeGoIconUrl from '../assets/provider-icons/opencodego.svg?url'
import zaiIconUrl from '../assets/provider-icons/zai.svg?url'
import zenmuxIconUrl from '../assets/provider-icons/zenmux.svg?url'
import kunIconUrl from '../../../asset/img/kun_tray_mac.svg?url'

export type ProviderBrandIconKey =
  | 'alibaba'
  | 'antigravity'
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'deepseek'
  | 'doubao'
  | 'gemini'
  | 'grok'
  | 'kimi'
  | 'kun'
  | 'litellm'
  | 'longcat'
  | 'mimo'
  | 'minimax'
  | 'ollama'
  | 'opencodego'
  | 'zai'
  | 'zenmux'

const PROVIDER_ICON_ASSETS: Readonly<Record<ProviderBrandIconKey, string>> = {
  alibaba: alibabaIconUrl,
  antigravity: antigravityIconUrl,
  claude: claudeIconUrl,
  codex: codexIconUrl,
  cursor: cursorIconUrl,
  deepseek: deepseekIconUrl,
  doubao: doubaoIconUrl,
  gemini: geminiIconUrl,
  grok: grokIconUrl,
  kimi: kimiIconUrl,
  kun: kunIconUrl,
  litellm: litellmIconUrl,
  longcat: longcatIconUrl,
  mimo: mimoIconUrl,
  minimax: minimaxIconUrl,
  ollama: ollamaIconUrl,
  opencodego: opencodeGoIconUrl,
  zai: zaiIconUrl,
  zenmux: zenmuxIconUrl
}

const ICON_BY_PRESET_ID: Readonly<Record<string, ProviderBrandIconKey>> = {
  aliyun: 'alibaba',
  codex: 'codex',
  'claude-subscription': 'claude',
  'cursor-subscription': 'cursor',
  'gemini-cli-subscription': 'gemini',
  'gemini-subscription': 'antigravity',
  'grok-subscription': 'grok',
  'kimi-code': 'kimi',
  litellm: 'litellm',
  longcat: 'longcat',
  minimax: 'minimax',
  'moonshot-cn': 'kimi',
  'moonshot-global': 'kimi',
  ollama: 'ollama',
  'opencode-go': 'opencodego',
  volcengine: 'doubao',
  'volcengine-agent-plan': 'doubao',
  'volcengine-coding-plan': 'doubao',
  xiaomi: 'mimo',
  'zai-coding-plan': 'zai',
  zenmux: 'zenmux',
  'zhipu-coding-plan': 'zai'
}

const ICON_BY_EXACT_PROVIDER_ID: Readonly<Record<string, ProviderBrandIconKey>> = {
  deepseek: 'deepseek',
  ...ICON_BY_PRESET_ID
}

export type ProviderIconIdentity = {
  presetId?: string | null
  providerId?: string | null
}

/** Resolve only trusted preset identities or exact built-in provider IDs. */
export function resolveProviderIconKey({
  presetId,
  providerId
}: ProviderIconIdentity): ProviderBrandIconKey {
  const trustedPresetId = presetId?.trim()
  if (trustedPresetId && hasOwnIcon(ICON_BY_PRESET_ID, trustedPresetId)) {
    return ICON_BY_PRESET_ID[trustedPresetId]
  }
  const exactProviderId = providerId?.trim()
  if (exactProviderId && hasOwnIcon(ICON_BY_EXACT_PROVIDER_ID, exactProviderId)) {
    return ICON_BY_EXACT_PROVIDER_ID[exactProviderId]
  }
  return 'kun'
}

function hasOwnIcon(
  registry: Readonly<Record<string, ProviderBrandIconKey>>,
  key: string
): boolean {
  return Object.prototype.hasOwnProperty.call(registry, key)
}

export function providerIconAssetUrl(identity: ProviderIconIdentity): string {
  return PROVIDER_ICON_ASSETS[resolveProviderIconKey(identity)]
}

export type ProviderIconProps = ProviderIconIdentity &
  Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
    label?: string
    size?: number | string
  }

/** Monochrome provider mark that follows the surrounding foreground color. */
export function ProviderIcon({
  presetId,
  providerId,
  label,
  size,
  className = '',
  style,
  role,
  'aria-label': ariaLabel,
  'aria-hidden': ariaHidden,
  ...spanProps
}: ProviderIconProps): ReactElement {
  const iconKey = resolveProviderIconKey({ presetId, providerId })
  const iconUrl = PROVIDER_ICON_ASSETS[iconKey]
  const accessibleLabel = label ?? ariaLabel
  const classControlsSize = /(?:^|\s)(?:(?:[^\s:]+):)*(?:h|w|size)-/.test(className)
  const dimensions: CSSProperties = size !== undefined
    ? { width: size, height: size }
    : classControlsSize || style?.width !== undefined || style?.height !== undefined
      ? {}
      : { width: '1em', height: '1em' }
  const maskStyle: CSSProperties = {
    display: 'inline-block',
    flex: 'none',
    ...dimensions,
    backgroundColor: 'currentColor',
    WebkitMaskImage: `url("${iconUrl}")`,
    maskImage: `url("${iconUrl}")`,
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    ...style
  }

  return (
    <span
      {...spanProps}
      role={accessibleLabel ? 'img' : role}
      aria-label={accessibleLabel}
      aria-hidden={accessibleLabel ? undefined : (ariaHidden ?? true)}
      data-provider-icon={iconKey}
      className={className}
      style={maskStyle}
    />
  )
}
