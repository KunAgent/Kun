/**
 * Frontmatter properties panel (implementation §4). Sits at the top of the
 * document editor, collapsed to "properties · N" by default. Form mode
 * covers text/list/checkbox/date; complex YAML falls back to source mode.
 * Source mode edits the interior (no `---` fences) and validates on blur —
 * invalid YAML shows an error but is never discarded.
 */
import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, List, Plus, Text, Calendar, ToggleLeft, Trash2 } from 'lucide-react'
import { parse as parseYaml } from 'yaml'
import {
  convertPropertyKind,
  countFrontmatterProperties,
  createEmptyProperty,
  frontmatterInterior,
  parseFrontmatterProperties,
  patchFrontmatterInterior,
  wrapFrontmatter,
  type FrontmatterProperty,
  type FrontmatterPropertyKind
} from '@shared/markdown/frontmatter'

type Props = {
  /** Verbatim frontmatter block (with fences), '' when absent. */
  frontmatter: string
  /** Called with the new verbatim block ('' removes frontmatter). */
  onFrontmatterChange: (block: string) => void
  readOnly?: boolean
}

const KIND_ORDER: FrontmatterPropertyKind[] = ['scalar', 'list', 'checkbox', 'date']

function KindIcon({ kind }: { kind: FrontmatterPropertyKind }): ReactElement {
  if (kind === 'list') return <List size={13} />
  if (kind === 'checkbox') return <ToggleLeft size={13} />
  if (kind === 'date') return <Calendar size={13} />
  return <Text size={13} />
}

export function WritePropertiesPanel({ frontmatter, onFrontmatterChange, readOnly = false }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<'form' | 'source'>('form')
  const [draft, setDraft] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)

  const interior = useMemo(() => frontmatterInterior(frontmatter), [frontmatter])
  const parsed = useMemo(() => parseFrontmatterProperties(interior), [interior])
  const count = useMemo(() => countFrontmatterProperties(interior, parsed), [interior, parsed])
  const formAvailable = parsed.ok

  const commitProperties = (properties: FrontmatterProperty[]): void => {
    // Patch the YAML document in place — a full re-serialize would drop
    // comments, quote styles, and key spelling of every untouched entry.
    const nextInterior = patchFrontmatterInterior(
      interior,
      parsed.ok ? parsed.properties : [],
      properties
    )
    onFrontmatterChange(wrapFrontmatter(nextInterior))
  }

  const patchProperty = (index: number, patch: Partial<FrontmatterProperty>): void => {
    if (!parsed.ok) return
    const next = parsed.properties.map((p, i) => (i === index ? { ...p, ...patch } : p))
    commitProperties(next)
  }

  const removeProperty = (index: number): void => {
    if (!parsed.ok) return
    commitProperties(parsed.properties.filter((_, i) => i !== index))
  }

  const validateSource = (value: string): string | null => {
    if (!value.trim()) {
      setSourceError(null)
      return null
    }
    try {
      parseYaml(value)
      setSourceError(null)
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
      setSourceError(message)
      return message
    }
  }

  if (!frontmatter && !expanded) {
    if (readOnly) return null
    return (
      <button
        type="button"
        className="write-properties-add"
        onClick={() => {
          setExpanded(true)
          onFrontmatterChange(wrapFrontmatter(''))
        }}
      >
        <Plus size={12} /> {t('writePropertiesAdd')}
      </button>
    )
  }

  const effectiveMode: 'form' | 'source' = formAvailable ? mode : 'source'

  return (
    <div className="write-properties-panel" data-expanded={expanded || undefined}>
      <button
        type="button"
        className="write-properties-head"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{t('writePropertiesTitle', { count })}</span>
      </button>
      {expanded && (
        <div className="write-properties-body">
          {formAvailable && (
            <div className="write-properties-tabs">
              <button
                type="button"
                className={effectiveMode === 'form' ? 'is-active' : ''}
                onClick={() => setMode('form')}
              >
                {t('writePropertiesForm')}
              </button>
              <button
                type="button"
                className={effectiveMode === 'source' ? 'is-active' : ''}
                onClick={() => setMode('source')}
              >
                {t('writePropertiesSource')}
              </button>
            </div>
          )}

          {effectiveMode === 'form' && parsed.ok && (
            <div className="write-properties-rows">
              {parsed.properties.map((property, index) => (
                <div className="write-properties-row" key={`${index}-${property.key}`}>
                  <button
                    type="button"
                    className="write-properties-kind"
                    title={property.kind}
                    disabled={readOnly}
                    onClick={() => {
                      const next = KIND_ORDER[(KIND_ORDER.indexOf(property.kind) + 1) % KIND_ORDER.length]
                      const converted = convertPropertyKind(property, next)
                      patchProperty(index, converted)
                    }}
                  >
                    <KindIcon kind={property.kind} />
                  </button>
                  <input
                    className="write-properties-key"
                    value={property.key}
                    disabled={readOnly}
                    onChange={(e) => patchProperty(index, { key: e.target.value })}
                  />
                  {property.kind === 'list' && (
                    <input
                      className="write-properties-value"
                      value={property.items.join(', ')}
                      placeholder="a, b, c"
                      disabled={readOnly}
                      onChange={(e) =>
                        patchProperty(index, { items: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                      }
                    />
                  )}
                  {property.kind === 'checkbox' && (
                    <input
                      type="checkbox"
                      className="write-properties-check"
                      checked={property.value === 'true'}
                      disabled={readOnly}
                      onChange={(e) => patchProperty(index, { value: e.target.checked ? 'true' : 'false' })}
                    />
                  )}
                  {property.kind === 'date' && (
                    <input
                      type="date"
                      className="write-properties-value"
                      value={property.value}
                      disabled={readOnly}
                      onChange={(e) => patchProperty(index, { value: e.target.value })}
                    />
                  )}
                  {property.kind === 'scalar' && (
                    <input
                      className="write-properties-value"
                      value={property.value}
                      disabled={readOnly}
                      onChange={(e) => patchProperty(index, { value: e.target.value })}
                    />
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      className="write-properties-remove"
                      onClick={() => removeProperty(index)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <button
                  type="button"
                  className="write-properties-addrow"
                  onClick={() => {
                    if (!parsed.ok) return
                    commitProperties([...parsed.properties, createEmptyProperty()])
                  }}
                >
                  <Plus size={12} /> {t('writePropertiesAddRow')}
                </button>
              )}
            </div>
          )}

          {effectiveMode === 'source' && (
            <div className="write-properties-source">
              {!formAvailable && (
                <div className="write-properties-note">{t('writePropertiesComplex')}</div>
              )}
              <textarea
                className="write-properties-yaml"
                value={draft ?? interior}
                disabled={readOnly}
                spellCheck={false}
                rows={Math.max(3, (draft ?? interior).split('\n').length)}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (draft === null) return
                  if (validateSource(draft) === null) {
                    onFrontmatterChange(wrapFrontmatter(draft))
                    setDraft(null)
                  }
                }}
              />
              {sourceError && <div className="write-properties-error">{sourceError}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
