import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { moaApi } from '@shared/seam/api'
import { MoaPresetEditor } from './MoaPresetEditor'

type MoaPreset = {
  id: string
  name: string
  description: string
  costMultiplier: number
  dynamicRouting: boolean
  layers: Array<{ type: string; models: string[] }>
  isCustom?: boolean
}

export function MoaPresets(): React.ReactElement {
  const [presets, setPresets] = useState<MoaPreset[]>([])
  const [defaultPresetId, setDefaultPresetId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    await moaApi.listPresets()
      .then((response) => {
        setPresets((response.presets as MoaPreset[] | undefined) ?? [])
        setDefaultPresetId(typeof response.defaultPresetId === 'string' ? response.defaultPresetId : '')
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    void load()
  }, [])

  const remove = async (id: string): Promise<void> => {
    try {
      await moaApi.deletePreset(id)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ds-main p-6 text-ds-text">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">MoA 多模型融合</h1><p className="text-[13px] text-ds-muted">{presets.length} 个可用虚拟模型</p></div>
        <button type="button" onClick={() => setEditorOpen(true)} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] text-white"><Plus className="h-3.5 w-3.5" />配置模型</button>
      </div>
      {error ? <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">{error}</div> : null}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-ds-muted">Loading...</div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {presets.map((preset) => (
            <div key={preset.id} className="rounded-lg border border-ds-border-muted bg-ds-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[14px] font-medium">{preset.name}</h2>
                  <p className="mt-1 text-[12px] text-ds-muted">{preset.description}</p>
                </div>
                <div className="flex items-center gap-1">{preset.id === defaultPresetId ? <span className="shrink-0 rounded bg-accent/15 px-2 py-1 text-[11px] text-accent">默认</span> : null}{preset.isCustom ? <button type="button" onClick={() => void remove(preset.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted hover:bg-red-500/10 hover:text-red-400" aria-label={`删除 ${preset.name}`} title="删除"><Trash2 className="h-3.5 w-3.5" /></button> : null}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-ds-muted">
                <span>{preset.layers.length} 层</span>
                <span>{preset.layers.reduce((count, layer) => count + layer.models.length, 0)} 次模型调用</span>
                <span>约 {preset.costMultiplier} 倍成本</span>
                {preset.dynamicRouting ? <span>动态路由</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {editorOpen ? <MoaPresetEditor onClose={() => setEditorOpen(false)} onSaved={load} /> : null}
    </div>
  )
}
