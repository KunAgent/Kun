import {
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Save,
  Trash2
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useState,
  type ReactElement
} from 'react'
import { DetailSection, fieldLabelClass, textInputClass } from './settings-section-providers-controls'

const MAX_COUNT = 64
const NAME_MAX_LENGTH = 128
const VALUE_MAX_BYTES = 8 * 1024
const TOTAL_MAX_BYTES = 32 * 1024
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u
const FORBIDDEN = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
  'keep-alive',
  'te',
  'trailer'
])

type HeaderRow = {
  id: string
  name: string
  value: string
}

function validationError(rows: HeaderRow[]): string | undefined {
  const seen = new Set<string>()
  let total = 0
  for (const row of rows) {
    const name = row.name.trim()
    if (!name) return 'Header name cannot be empty.'
    if (!HTTP_TOKEN.test(name)) return `Invalid header name: ${name}`
    if (name.length > NAME_MAX_LENGTH) return `Header name exceeds ${NAME_MAX_LENGTH} characters: ${name}`
    if (FORBIDDEN.has(name.toLowerCase())) return `Header name is not allowed: ${name}`
    if (seen.has(name.toLowerCase())) return `Duplicate header name (case-insensitive): ${name}`
    seen.add(name.toLowerCase())
    if (/[\r\n\0]/u.test(row.value)) return `Header value contains invalid control characters: ${name}`
    const bytes = new TextEncoder().encode(row.value).length
    if (bytes > VALUE_MAX_BYTES) return `Header value exceeds ${VALUE_MAX_BYTES} bytes: ${name}`
    total += bytes
    if (total > TOTAL_MAX_BYTES) return `Custom headers exceed ${TOTAL_MAX_BYTES} bytes total.`
  }
  return undefined
}

function rowsToMap(rows: HeaderRow[]): Record<string, string> {
  return Object.fromEntries(rows
    .filter((row) => row.name.trim())
    .map((row) => [row.name.trim(), row.value]))
}

export function ProviderCustomHeadersEditor({
  providerId,
  zh,
  isOpenCodeGo
}: {
  providerId: string
  zh: boolean
  isOpenCodeGo: boolean
}): ReactElement {
  const [rows, setRows] = useState<HeaderRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showValues, setShowValues] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setLoading(true)
    setError('')
    setNotice('')
    setRows([])
    void (async () => {
      try {
        const result = await window.kunGui.runtimeRequest(
          `/v1/model-connections/${encodeURIComponent(providerId)}/custom-headers`,
          'GET'
        )
        if (cancelled) return
        if (!result.ok) {
          setError(parseErrorMessage(result.body, zh, 'Failed to load custom headers.'))
          return
        }
        const value = JSON.parse(result.body) as { customHeaders?: unknown }
        const map = value?.customHeaders
        const entries = map && typeof map === 'object' && !Array.isArray(map)
          ? Object.entries(map as Record<string, unknown>)
          : []
        setRows(entries.map(([name, raw]) => ({
          id: `${name}:${Math.random().toString(36).slice(2)}`,
          name,
          value: typeof raw === 'string' ? raw : ''
        })))
        setLoaded(true)
      } catch {
        if (!cancelled) setError(zh ? '无法读取自定义请求头。' : 'Failed to read custom headers.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [providerId, zh])

  const draftError = useMemo(() => validationError(rows), [rows])

  function updateRow(id: string, patch: Partial<HeaderRow>): void {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    setNotice('')
  }

  function addRow(): void {
    if (rows.length >= MAX_COUNT) return
    setRows((current) => [...current, { id: `row:${Math.random().toString(36).slice(2)}`, name: '', value: '' }])
    setNotice('')
  }

  function removeRow(id: string): void {
    setRows((current) => current.filter((row) => row.id !== id))
    setNotice('')
  }

  async function save(): Promise<void> {
    const invalid = validationError(rows)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const snapshotResult = await window.kunGui.runtimeRequest('/v1/model-connections', 'GET')
        if (!snapshotResult.ok) {
          setError(parseErrorMessage(snapshotResult.body, zh, 'Failed to load the current configuration.'))
          return
        }
        const snapshot = JSON.parse(snapshotResult.body) as { revision?: unknown }
        const revision = typeof snapshot.revision === 'number' ? snapshot.revision : 0
        const result = await window.kunGui.runtimeRequest(
          `/v1/model-connections/${encodeURIComponent(providerId)}`,
          'PATCH',
          JSON.stringify({ expectedRevision: revision, customHeaders: rowsToMap(rows) })
        )
        if (result.ok) {
          setNotice(zh ? '自定义请求头已保存。' : 'Custom headers saved.')
          return
        }
        if (result.status === 409 && attempt === 0) continue
        setError(parseErrorMessage(result.body, zh, 'Failed to save custom headers.'))
        return
      }
    } catch {
      setError(zh ? '保存自定义请求头失败。' : 'Failed to save custom headers.')
    } finally {
      setSaving(false)
    }
  }

  async function clearAll(): Promise<void> {
    setRows([])
    setNotice('')
    await save()
  }

  return (
    <DetailSection title={zh ? '自定义请求头' : 'Custom request headers'}>
      {loading ? (
        <p className="flex items-center gap-2 text-[12px] leading-5 text-ds-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
          {zh ? '正在读取…' : 'Loading…'}
        </p>
      ) : (
        <div className="grid gap-3">
          <p className="text-[12px] leading-5 text-ds-muted">
            {zh
              ? '这些请求头会附加到该供应商发出的每个 Kun 控制的 HTTP 请求（模型聊天、探测、写作补全等）。值按敏感信息处理，默认隐藏。'
              : 'These headers are added to every Kun-controlled HTTP request for this provider (model chat, probing, write inline completion, etc.). Values are treated as sensitive and hidden by default.'}
          </p>
          {isOpenCodeGo ? (
            <p className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-[12px] leading-5 text-ds-muted">
              {zh
                ? 'OpenCode Go：x-opencode-session 由 Kun 按当前会话自动填写，此处无需也不应手动配置。'
                : 'OpenCode Go: x-opencode-session is filled automatically by Kun per active session; do not configure it here.'}
            </p>
          ) : null}
          <div className="grid gap-2">
            {rows.map((row) => (
              <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <label className={fieldLabelClass}>
                  <span className="sr-only">{zh ? '请求头名称' : 'Header name'}</span>
                  <input
                    className={textInputClass}
                    placeholder={zh ? '名称，如 X-API-Key' : 'Name, e.g. X-API-Key'}
                    value={row.name}
                    spellCheck={false}
                    onChange={(e) => updateRow(row.id, { name: e.target.value })}
                  />
                </label>
                <label className={fieldLabelClass}>
                  <span className="sr-only">{zh ? '请求头值' : 'Header value'}</span>
                  <input
                    className={textInputClass}
                    type={showValues ? 'text' : 'password'}
                    placeholder={zh ? '值' : 'Value'}
                    value={row.value}
                    spellCheck={false}
                    onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  aria-label={zh ? '删除该请求头' : 'Remove this header'}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-ds-border text-ds-muted transition-colors hover:text-ds-ink"
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg border border-ds-border px-3 py-1.5 text-[12px] text-ds-ink transition-colors hover:bg-ds-card"
              onClick={addRow}
              disabled={rows.length >= MAX_COUNT}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
              {zh ? '添加' : 'Add'}
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg border border-ds-border px-3 py-1.5 text-[12px] text-ds-ink transition-colors hover:bg-ds-card"
              onClick={() => setShowValues((current) => !current)}
            >
              {showValues
                ? <EyeOff className="h-3.5 w-3.5" strokeWidth={1.9} />
                : <Eye className="h-3.5 w-3.5" strokeWidth={1.9} />}
              {showValues ? (zh ? '隐藏值' : 'Hide values') : (zh ? '显示值' : 'Show values')}
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-50"
              onClick={() => void save()}
              disabled={saving || Boolean(draftError) || !loaded}
            >
              {saving
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                : <Save className="h-3.5 w-3.5" strokeWidth={1.9} />}
              {saving ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}
            </button>
            {rows.length > 0 ? (
              <button
                type="button"
                className="rounded-lg border border-ds-border px-3 py-1.5 text-[12px] text-ds-muted transition-colors hover:text-ds-ink"
                onClick={() => void clearAll()}
                disabled={saving}
              >
                {zh ? '清空' : 'Clear'}
              </button>
            ) : null}
          </div>
          {draftError ? (
            <p className="text-[12px] leading-5 text-ds-danger">{draftError}</p>
          ) : null}
          {error ? (
            <p className="text-[12px] leading-5 text-ds-danger">{error}</p>
          ) : null}
          {notice ? (
            <p className="text-[12px] leading-5 text-ds-success">{notice}</p>
          ) : null}
        </div>
      )}
    </DetailSection>
  )
}

function parseErrorMessage(body: string, zh: boolean, fallback: string): string {
  try {
    const value = JSON.parse(body) as { message?: unknown }
    if (typeof value.message === 'string' && value.message.trim()) return value.message.trim()
  } catch {
    // Keep the fallback.
  }
  return fallback
}
