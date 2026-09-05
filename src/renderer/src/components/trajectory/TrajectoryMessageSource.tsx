import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { TrajectoryJsonTree } from './TrajectoryJsonTree'
import { trajectorySourceTypeLabel } from './trajectory-source-label'
import styles from './TrajectoryMessageSource.module.css'

export function TrajectoryMessageSource({ content }: { content: unknown }): ReactElement {
  const { t } = useTranslation('common')
  const source = normalizeSource(content)
  if (!source) return <div className={styles.empty}>{t('trajectorySourceNotRecorded')}</div>
  const sourceType = isRecord(source.value) && typeof source.value.kind === 'string'
    ? source.value.kind
    : undefined
  return (
    <div className={styles.root} data-testid="trajectory-message-source">
      <div className={styles.heading}>{trajectorySourceTypeLabel(sourceType, t, source.label)}</div>
      <TrajectoryJsonTree
        value={source.value}
        ariaLabel={t('trajectorySourceAria')}
      />
    </div>
  )
}

function normalizeSource(value: unknown): { label: string; value: unknown } | null {
  if (isRecord(value) && value.kind === 'message-source' && typeof value.label === 'string') {
    return { label: value.label, value: sanitizeSourceValue(value.value) }
  }
  const legacy = Array.isArray(value) ? value[0] : value
  if (!isRecord(legacy) || typeof legacy.kind !== 'string') return null
  if (legacy.kind === 'user_message') {
    const kind = typeof legacy.messageSource === 'string' ? legacy.messageSource : 'user'
    return { label: humanize(kind), value: { kind } }
  }
  if (legacy.kind === 'model_context') {
    return {
      label: 'Model context',
      value: {
        kind: 'model_context',
        formatVersion: legacy.formatVersion,
        baseline: legacy.baseline === true,
        stepIndex: legacy.stepIndex,
        contentDigest: legacy.contentDigest,
        blocks: Array.isArray(legacy.blocks) ? legacy.blocks.map(sourceBlockMetadata) : []
      }
    }
  }
  if (legacy.kind === 'runtime_context_source') {
    return {
      label: 'Runtime context',
      value: { kind: 'runtime_context', contextKind: legacy.contextKind }
    }
  }
  return null
}

function sourceBlockMetadata(value: unknown): unknown {
  if (!isRecord(value)) return null
  return Object.fromEntries(['key', 'kind', 'authority', 'state', 'digest']
    .flatMap((key) => value[key] === undefined ? [] : [[key, sanitizeSourceValue(value[key])]]))
}

function sanitizeSourceValue(value: unknown, key = '', depth = 0): unknown {
  if (depth > 24) return '[REDACTED: DEPTH LIMIT]'
  if (sensitiveKey(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    if (/^data:[^;,]+;base64,/i.test(value) || looksLikeBase64(value)) return '[BINARY OMITTED]'
    return value.replace(/data:[^;,\s]+;base64,[a-z0-9+/=_-]+/gi, '[BINARY OMITTED]')
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeSourceValue(entry, key, depth + 1))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => [
    name,
    sanitizeSourceValue(entry, name, depth + 1)
  ]))
}

function humanize(value: string): string {
  return value.split('_').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ')
}

function sensitiveKey(value: string): boolean {
  return /authorization|(?:^|[-_])auth(?:entication)?(?:$|[-_])|api[-_]?key|access[-_]?key(?:[-_]?id)?|cookie|credential|password|secret|token|signature|providerMetadata|aws[-_]?(?:session[-_]?token|access[-_]?key)/i.test(value)
}

function looksLikeBase64(value: string): boolean {
  return value.length > 4_096 && value.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
