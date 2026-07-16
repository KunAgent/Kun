import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { moaApi } from '@shared/seam/api'
import { useChatStore } from '../../../store/chat-store'

export type MoaPresetDraft = {
  id: string
  name: string
  description: string
  references: string[]
  aggregator: string
  maxConcurrency: number
  contextBudgetTokens: number
  inputModalities: Array<'text' | 'image' | 'video'>
}

export function buildMoaPresetPayload(draft: MoaPresetDraft): Record<string, unknown> {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    layers: [
      { type: 'proposer', models: draft.references },
      { type: 'aggregator', models: [draft.aggregator] }
    ],
    dynamicRouting: false,
    costMultiplier: draft.references.length + 1,
    enabled: true,
    maxConcurrency: draft.maxConcurrency,
    contextBudgetTokens: draft.contextBudgetTokens,
    inputModalities: draft.inputModalities
  }
}

export function MoaPresetEditor(props: { onClose: () => void; onSaved: () => void | Promise<void> }): React.ReactElement {
  const groups = useChatStore((state) => state.composerModelGroups)
  const modelOptions = useMemo(() => groups
    .filter((group) => group.providerId !== 'moa')
    .flatMap((group) => group.modelIds.map((modelId) => ({
      value: `${group.providerId}/${modelId}`,
      label: `${modelId} · ${group.label}`
    }))), [groups])
  const first = modelOptions[0]?.value ?? ''
  const [draft, setDraft] = useState<MoaPresetDraft>({
    id: '', name: '', description: '', references: first ? [first] : [], aggregator: first,
    maxConcurrency: 2, contextBudgetTokens: 32_000, inputModalities: ['text']
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await moaApi.savePreset(buildMoaPresetPayload(draft))
      await props.onSaved()
      await useChatStore.getState().loadComposerModels()
      props.onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="配置 MoA 模型">
      <div className="flex max-h-[min(760px,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-xl">
        <div className="flex h-12 items-center justify-between border-b border-ds-border-muted px-4"><h2 className="text-[15px] font-medium">配置 MoA 虚拟模型</h2><button type="button" onClick={props.onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover" aria-label="关闭"><X className="h-4 w-4" /></button></div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="模型 ID" value={draft.id} onChange={(id) => setDraft({ ...draft, id: normalizeId(id) })} placeholder="review-board" /><Field label="名称" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="评审专家组" /></div>
          <Field label="说明" value={draft.description} onChange={(description) => setDraft({ ...draft, description })} placeholder="适合复杂决策与交叉验证" />
          <label className="block text-[12px] text-ds-muted">参考模型（可多选）<select multiple value={draft.references} onChange={(event) => setDraft({ ...draft, references: [...event.currentTarget.selectedOptions].map((option) => option.value) })} className="mt-1 h-36 w-full rounded-md border border-ds-border-muted bg-ds-main px-2 py-2 text-[13px] text-ds-ink">{modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="block text-[12px] text-ds-muted">聚合模型<select value={draft.aggregator} onChange={(event) => setDraft({ ...draft, aggregator: event.target.value })} className="mt-1 w-full rounded-md border border-ds-border-muted bg-ds-main px-3 py-2 text-[13px] text-ds-ink">{modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><NumberField label="最大并发" value={draft.maxConcurrency} min={1} max={10} onChange={(maxConcurrency) => setDraft({ ...draft, maxConcurrency })} /><NumberField label="上下文预算" value={draft.contextBudgetTokens} min={4096} max={1_000_000} onChange={(contextBudgetTokens) => setDraft({ ...draft, contextBudgetTokens })} /></div>
          <fieldset><legend className="mb-1 text-[12px] text-ds-muted">输入类型</legend><div className="flex gap-4">{(['text', 'image', 'video'] as const).map((modality) => <label key={modality} className="inline-flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={draft.inputModalities.includes(modality)} disabled={modality === 'text'} onChange={(event) => setDraft({ ...draft, inputModalities: event.target.checked ? [...draft.inputModalities, modality] : draft.inputModalities.filter((item) => item !== modality) })} />{modality === 'text' ? '文本' : modality === 'image' ? '图片' : '视频'}</label>)}</div></fieldset>
          {modelOptions.length === 0 ? <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">请先在模型设置中配置至少一个普通模型。</div> : null}
          {error ? <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-ds-border-muted p-3"><button type="button" onClick={props.onClose} className="rounded-md border border-ds-border-muted px-3 py-1.5 text-[13px]">取消</button><button type="button" disabled={saving || !draft.id || !draft.name.trim() || draft.references.length === 0 || !draft.aggregator} onClick={() => void save()} className="rounded-md bg-accent px-3 py-1.5 text-[13px] text-white disabled:opacity-50">{saving ? '保存中…' : '保存'}</button></div>
      </div>
    </div>
  )
}

function normalizeId(value: string): string { return value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 50) }
function Field(props: { label: string; value: string; placeholder: string; onChange: (value: string) => void }): React.ReactElement { return <label className="block text-[12px] text-ds-muted">{props.label}<input value={props.value} placeholder={props.placeholder} onChange={(event) => props.onChange(event.target.value)} className="mt-1 w-full rounded-md border border-ds-border-muted bg-ds-main px-3 py-2 text-[13px] text-ds-ink" /></label> }
function NumberField(props: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }): React.ReactElement { return <label className="block text-[12px] text-ds-muted">{props.label}<input type="number" value={props.value} min={props.min} max={props.max} onChange={(event) => props.onChange(Number(event.target.value))} className="mt-1 w-full rounded-md border border-ds-border-muted bg-ds-main px-3 py-2 text-[13px] text-ds-ink" /></label> }
