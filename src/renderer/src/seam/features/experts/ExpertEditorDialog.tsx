import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { expertsApi } from '@shared/seam/api'

type ExpertTemplate = {
  id: string
  kind: 'expert' | 'team'
  label: string
  name: string
  description: string
  prompt: string
  secondary: string
}

export const EXPERT_TEMPLATES: readonly ExpertTemplate[] = [
  {
    id: 'expert-code-review',
    kind: 'expert',
    label: '代码审查专家',
    name: '代码审查专家',
    description: '识别正确性、安全性与回归风险，并给出可验证的修改建议。',
    prompt: '你是一名高级代码审查专家。先检查行为风险和边界条件，再给出带文件位置的结论。任何结论都需要测试或代码证据。',
    secondary: '按严重级别列出问题；没有发现问题时明确说明剩余测试风险。'
  },
  {
    id: 'team-release',
    kind: 'team',
    label: '发布验收专家团',
    name: '发布验收专家团',
    description: '并行执行功能、质量与安全检查，最后汇总发布结论。',
    prompt: '负责人拆分任务，允许功能验证、代码质量和安全检查并行执行；成员完成后由负责人合并证据并处理冲突。',
    secondary: '输出总体结论、每项检查状态、阻塞问题、恢复点和下一步。'
  }
]

export function buildExpertCreatePayload(template: ExpertTemplate): Record<string, unknown> {
  if (template.kind === 'team') {
    return {
      name: template.name,
      description: template.description,
      domainTags: ['协作', '验收'],
      workflow: template.prompt,
      deliverableSpec: template.secondary,
      skillRefs: [],
      members: [{
        agentName: 'lead',
        roleLabel: '负责人',
        roleDefinition: '负责拆分任务、协调成员、处理异常，并汇总所有成员的可验证结果。',
        skillRefs: []
      }]
    }
  }
  return {
    name: template.name,
    profession: template.name,
    description: template.description,
    domainTags: ['自定义'],
    roleDefinition: template.prompt,
    behaviorRules: template.secondary,
    outputPreferences: '结论清晰，引用证据，并标记不确定性。',
    skillRefs: [],
    quickPrompts: ['请按规则分析当前任务。'],
    defaultInitPrompt: '请说明目标和可用上下文。'
  }
}

interface ExpertEditorDialogProps {
  onClose: () => void
  onCreated: () => void | Promise<void>
}

export function ExpertEditorDialog(props: ExpertEditorDialogProps): React.ReactElement {
  const [kind, setKind] = useState<'expert' | 'team'>('expert')
  const templates = useMemo(() => EXPERT_TEMPLATES.filter((item) => item.kind === kind), [kind])
  const [templateId, setTemplateId] = useState(EXPERT_TEMPLATES[0].id)
  const selected = templates.find((item) => item.id === templateId) ?? templates[0]
  const [name, setName] = useState(selected.name)
  const [description, setDescription] = useState(selected.description)
  const [prompt, setPrompt] = useState(selected.prompt)
  const [secondary, setSecondary] = useState(selected.secondary)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectKind = (nextKind: 'expert' | 'team'): void => {
    const template = EXPERT_TEMPLATES.find((item) => item.kind === nextKind)!
    setKind(nextKind)
    applyTemplate(template)
  }

  const applyTemplate = (template: ExpertTemplate): void => {
    setTemplateId(template.id)
    setName(template.name)
    setDescription(template.description)
    setPrompt(template.prompt)
    setSecondary(template.secondary)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const payload = buildExpertCreatePayload({ ...selected, name, description, prompt, secondary })
      if (kind === 'team') await expertsApi.createTeam(payload)
      else await expertsApi.createExpert(payload)
      await props.onCreated()
      props.onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="新增专家或专家团">
      <div className="flex max-h-[min(720px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-ds-border-muted px-4">
          <h2 className="text-[15px] font-medium">新增专家能力</h2>
          <button type="button" onClick={props.onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="inline-flex rounded-md border border-ds-border-muted p-0.5" aria-label="类型">
            {(['expert', 'team'] as const).map((value) => (
              <button key={value} type="button" onClick={() => selectKind(value)} className={`rounded px-3 py-1.5 text-[13px] ${kind === value ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted'}`}>
                {value === 'expert' ? '专家' : '专家团'}
              </button>
            ))}
          </div>
          <label className="block text-[12px] text-ds-muted">
            样例提示
            <select value={selected.id} onChange={(event) => applyTemplate(EXPERT_TEMPLATES.find((item) => item.id === event.target.value)!)} className="mt-1 w-full rounded-md border border-ds-border-muted bg-ds-main px-3 py-2 text-[13px] text-ds-ink">
              {templates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
            </select>
          </label>
          <Field label="名称" value={name} onChange={setName} />
          <Field label="简介" value={description} onChange={setDescription} multiline />
          <Field label={kind === 'team' ? '协作流程' : '角色定义'} value={prompt} onChange={setPrompt} multiline />
          <Field label={kind === 'team' ? '交付物规则' : '行为规则'} value={secondary} onChange={setSecondary} multiline />
          {error ? <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{error}</div> : null}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-ds-border-muted p-3">
          <button type="button" onClick={props.onClose} className="rounded-md border border-ds-border-muted px-3 py-1.5 text-[13px]">取消</button>
          <button type="button" disabled={saving || !name.trim() || !description.trim() || prompt.trim().length < 10} onClick={() => void save()} className="rounded-md bg-accent px-3 py-1.5 text-[13px] text-white disabled:opacity-50">{saving ? '保存中…' : '创建'}</button>
        </div>
      </div>
    </div>
  )
}

function Field(props: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }): React.ReactElement {
  const className = 'mt-1 w-full rounded-md border border-ds-border-muted bg-ds-main px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-accent'
  return (
    <label className="block text-[12px] text-ds-muted">
      {props.label}
      {props.multiline
        ? <textarea rows={4} value={props.value} onChange={(event) => props.onChange(event.target.value)} className={className} />
        : <input value={props.value} onChange={(event) => props.onChange(event.target.value)} className={className} />}
    </label>
  )
}
