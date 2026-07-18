import type { Locale } from '@kun/extension-api'
import { useMemo, useState, type FormEvent } from 'react'
import type {
  GenerationCatalog,
  GenerationConsent,
  GenerationModelDescriptor,
  GenerationOutputKind,
  GenerationProviderDescriptor,
  GenerationTask
} from '../engine/generation.js'
import './generation-panel.css'

export type GenerationPanelAsset = {
  id: string
  name: string
  kind: GenerationOutputKind
  available: boolean
}

export type GenerationPanelRecord = {
  schemaVersion: 1
  id: string
  generation: number
  projectId: string
  projectRevision: number
  providerId: string
  modelId: string
  task: GenerationTask
  promptDigest: string
  referenceAssetIds: string[]
  variantsRequested: number
  quote: {
    quoteId: string
    currency: string
    minimumMinor: number
    maximumMinor: number
    estimateOnly: boolean
  }
  state: 'placeholder' | 'queued' | 'running' | 'cancelling' | 'ready' | 'failed' | 'cancelled' | 'interrupted'
  placeholder: { assetId: string; displayName: string; kind: GenerationOutputKind; state: string }
  progress?: { completed: number; total: number; unit: string; message?: string }
  outputs: Array<{
    id: string
    assetId: string
    displayName: string
    kind: GenerationOutputKind
    mimeType: string
    byteSize?: number
    width?: number
    height?: number
    durationUs?: number
    sampleRate?: number
    channels?: number
    primary: boolean
    createdAt: string
  }>
  attempt: number
  error?: { code: string; message: string; retryable: boolean }
  createdAt: string
  updatedAt: string
}

export type GenerationPanelRequest = {
  task: GenerationTask
  projectId: string
  projectRevision: number
  providerId: string
  modelId: string
  prompt: string
  referenceAssetIds: string[]
  variants: number
  output: { kind: GenerationOutputKind }
  outputPolicy: 'resolve-placeholder' | 'add-variants'
  idempotencyKey: string
  consent: {
    providerPermissionApproved: boolean
    mediaUploadApproved: boolean
    costApproved: boolean
    approvedMaximumMinor: number
    currency: string
    confirmedAt: string
  }
}

export type GenerationPanelProps = {
  locale?: Locale
  projectId: string
  projectRevision: number
  catalog: GenerationCatalog
  catalogOutcome: 'available' | 'unavailable'
  unavailableMessage?: string
  assets: GenerationPanelAsset[]
  records: GenerationPanelRecord[]
  busy?: boolean
  createIdempotencyKey?: () => string
  onRequest(request: GenerationPanelRequest): Promise<void>
  onRefresh(): Promise<void>
  onCancel(recordId: string): Promise<void>
  onRetry(recordId: string, consent: GenerationConsent): Promise<void>
  onInsert(recordId: string, outputId: string): Promise<void>
}

export function GenerationPanel(props: GenerationPanelProps): React.JSX.Element {
  const copy = generationMessagesFor(props.locale)
  const [task, setTask] = useState<GenerationTask>('video')
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [variants, setVariants] = useState(1)
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>([])
  const [outputPolicy, setOutputPolicy] = useState<'resolve-placeholder' | 'add-variants'>('resolve-placeholder')
  const [providerApproved, setProviderApproved] = useState(false)
  const [uploadApproved, setUploadApproved] = useState(false)
  const [costApproved, setCostApproved] = useState(false)

  const providers = useMemo(() => providersForTask(props.catalog.providers, task), [props.catalog.providers, task])
  const provider = providers.find(({ id }) => id === providerId) ?? providers[0]
  const models = provider?.models.filter(({ tasks }) => tasks.includes(task)) ?? []
  const model = models.find(({ id }) => id === modelId) ?? models[0]
  const outputKind = preferredOutputKind(model, task)
  const referenceLimits = referenceLimitsFor(model, task)
  const selectedReferences = referenceAssetIds
    .map((id) => props.assets.find((asset) => asset.id === id))
    .filter((asset): asset is GenerationPanelAsset => Boolean(asset))
  const requirements = provider && model
    ? confirmationRequirements(provider, model, selectedReferences.length, variants)
    : undefined
  const hasAvailableModel = props.catalog.providers.some(({ status, models: candidates }) =>
    status === 'available' && candidates.length > 0
  )
  const canSubmit = Boolean(
    props.catalogOutcome === 'available' &&
    provider && model && prompt.trim() && !props.busy &&
    prompt.trim().length <= model.limits.maxPromptCharacters &&
    variants <= model.limits.maxVariants &&
    selectedReferences.length === referenceAssetIds.length &&
    selectedReferences.every((asset) => asset.available && model.referenceKinds.includes(asset.kind)) &&
    selectedReferences.length >= referenceLimits.minimum &&
    selectedReferences.length <= referenceLimits.maximum &&
    requirements?.costBounded !== false &&
    (!requirements?.provider || providerApproved) &&
    (!requirements?.upload || uploadApproved) &&
    (!requirements?.cost || costApproved)
  )

  const changeTask = (value: GenerationTask): void => {
    setTask(value)
    setProviderId('')
    setModelId('')
    setReferenceAssetIds([])
    resetIntent(setProviderApproved, setUploadApproved, setCostApproved)
  }
  const changeProvider = (value: string): void => {
    setProviderId(value)
    setModelId('')
    resetIntent(setProviderApproved, setUploadApproved, setCostApproved)
  }
  const changeModel = (value: string): void => {
    setModelId(value)
    setReferenceAssetIds([])
    resetIntent(setProviderApproved, setUploadApproved, setCostApproved)
  }
  const toggleReference = (assetId: string, checked: boolean): void => {
    if (!model) return
    setReferenceAssetIds((current) => {
      if (!checked) return current.filter((id) => id !== assetId)
      if (current.includes(assetId) || current.length >= referenceLimits.maximum) return current
      return [...current, assetId]
    })
    setUploadApproved(false)
  }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canSubmit || !provider || !model || !outputKind || !requirements) return
    await props.onRequest({
      task,
      projectId: props.projectId,
      projectRevision: props.projectRevision,
      providerId: provider.id,
      modelId: model.id,
      prompt: prompt.normalize('NFKC').trim(),
      referenceAssetIds: selectedReferences.map(({ id }) => id),
      variants,
      output: { kind: outputKind },
      outputPolicy,
      idempotencyKey: props.createIdempotencyKey?.() ?? `generation-${Date.now().toString(36)}`,
      consent: {
        providerPermissionApproved: providerApproved || !requirements.provider,
        mediaUploadApproved: uploadApproved || !requirements.upload,
        costApproved: costApproved || !requirements.cost,
        approvedMaximumMinor: requirements.maximumMinor,
        currency: model.cost.currency,
        confirmedAt: new Date().toISOString()
      }
    })
  }

  return (
    <section className="panel generation-panel" aria-labelledby="generation-panel-title">
      <header className="generation-panel-heading">
        <div>
          <h2 id="generation-panel-title">{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <button type="button" className="quiet-button" disabled={props.busy} onClick={() => void props.onRefresh()}>
          {copy.refresh}
        </button>
      </header>

      {props.catalogOutcome === 'unavailable' || !hasAvailableModel ? (
        <div className="generation-unavailable" role="status">
          <strong>{copy.unavailable}</strong>
          <p>{props.unavailableMessage ?? copy.noBroker}</p>
          <small>{copy.manualEditingAvailable}</small>
        </div>
      ) : (
        <form className="generation-form" onSubmit={(event) => void submit(event)}>
          <fieldset className="generation-task-picker">
            <legend>{copy.task}</legend>
            {(['image', 'video', 'audio', 'upscale'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={task === value}
                onClick={() => changeTask(value)}
              >{copy.tasks[value]}</button>
            ))}
          </fieldset>

          {providers.length === 0 && <p className="generation-task-unavailable" role="status">{copy.noTaskModel}</p>}

          <div className="generation-field-grid">
            <label>
              <span>{copy.provider}</span>
              <select value={provider?.id ?? ''} onChange={(event) => changeProvider(event.target.value)}>
                {providers.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}
              </select>
            </label>
            <label>
              <span>{copy.model}</span>
              <select value={model?.id ?? ''} onChange={(event) => changeModel(event.target.value)}>
                {models.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}
              </select>
            </label>
          </div>

          <label>
            <span>{copy.prompt}</span>
            <textarea
              value={prompt}
              maxLength={Math.min(8_000, model?.limits.maxPromptCharacters ?? 8_000)}
              placeholder={copy.promptPlaceholder}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          {model && referenceLimits.maximum > 0 && (
            <fieldset className="generation-references">
              <legend>{copy.references} ({referenceAssetIds.length}/{referenceLimits.maximum})</legend>
              {props.assets.filter((asset) => model.referenceKinds.includes(asset.kind)).map((asset) => (
                <label key={asset.id}>
                  <input
                    type="checkbox"
                    checked={referenceAssetIds.includes(asset.id)}
                    disabled={!asset.available || (!referenceAssetIds.includes(asset.id) && referenceAssetIds.length >= referenceLimits.maximum)}
                    onChange={(event) => toggleReference(asset.id, event.target.checked)}
                  />
                  <span>{asset.name}</span>
                  {!asset.available && <small>{copy.offline}</small>}
                </label>
              ))}
              {props.assets.filter((asset) => model.referenceKinds.includes(asset.kind)).length === 0 && <p>{copy.noReferences}</p>}
            </fieldset>
          )}

          <div className="generation-field-grid">
            <label>
              <span>{copy.variants}</span>
              <input
                type="number"
                min={1}
                max={model?.limits.maxVariants ?? 1}
                value={variants}
                onChange={(event) => {
                  setVariants(Math.max(1, Math.min(model?.limits.maxVariants ?? 1, Number(event.target.value) || 1)))
                  setCostApproved(false)
                }}
              />
            </label>
            <label>
              <span>{copy.outputPolicy}</span>
              <select value={outputPolicy} onChange={(event) => setOutputPolicy(event.target.value as typeof outputPolicy)}>
                <option value="resolve-placeholder">{copy.resolvePlaceholder}</option>
                <option value="add-variants">{copy.addVariants}</option>
              </select>
            </label>
          </div>

          {model && requirements && (
            <div className="generation-confirmations" aria-label={copy.confirmations}>
              <p className="generation-privacy">
                {model.privacy.processing === 'device' ? copy.localPrivacy : copy.remotePrivacy}
              </p>
              {requirements.provider && (
                <ConsentCheck checked={providerApproved} onChange={setProviderApproved} label={copy.confirmProvider} />
              )}
              {requirements.upload && (
                <ConsentCheck
                  checked={uploadApproved}
                  onChange={setUploadApproved}
                  label={format(copy.confirmUpload, { count: selectedReferences.length })}
                />
              )}
              {requirements.cost && (
                <ConsentCheck
                  checked={costApproved}
                  onChange={setCostApproved}
                  label={format(copy.confirmCost, {
                    amount: money(requirements.maximumMinor, model.cost.currency, props.locale?.language)
                  })}
                />
              )}
              <small>{copy.hostAuthorization}</small>
            </div>
          )}

          <button type="submit" disabled={!canSubmit}>{copy.createPlaceholder}</button>
        </form>
      )}

      <GenerationRecords
        catalog={props.catalog}
        locale={props.locale}
        records={props.records}
        busy={props.busy}
        copy={copy}
        onCancel={props.onCancel}
        onRetry={props.onRetry}
        onInsert={props.onInsert}
      />
    </section>
  )
}

function GenerationRecords(props: {
  catalog: GenerationCatalog
  locale?: Locale
  records: GenerationPanelRecord[]
  busy?: boolean
  copy: GenerationMessages
  onCancel(recordId: string): Promise<void>
  onRetry(recordId: string, consent: GenerationConsent): Promise<void>
  onInsert(recordId: string, outputId: string): Promise<void>
}): React.JSX.Element {
  if (props.records.length === 0) return <p className="generation-empty">{props.copy.empty}</p>
  return (
    <ol className="generation-records">
      {props.records.slice(0, 100).map((record) => (
        <li key={record.id} className={`generation-record generation-record-${record.state}`}>
          <div className="generation-record-title">
            <strong>{record.placeholder.displayName}</strong>
            <span>{props.copy.states[record.state]}</span>
          </div>
          <p className="generation-prompt-digest">
            {props.copy.promptFingerprint}: <code>{record.promptDigest.slice(0, 12)}</code>
          </p>
          {record.progress && (
            <div className="generation-progress">
              <progress max={record.progress.total} value={record.progress.completed} />
              <small>{record.progress.message ?? `${record.progress.completed}/${record.progress.total} ${record.progress.unit}`}</small>
            </div>
          )}
          {record.error && <p className="generation-error">{record.error.message}</p>}
          {record.outputs.length > 0 && (
            <ul className="generation-variants">
              {record.outputs.map((output) => (
                <li key={output.id}>
                  <span>{output.displayName}{output.primary ? ` · ${props.copy.primary}` : ''}</span>
                  <button type="button" disabled={props.busy} onClick={() => void props.onInsert(record.id, output.id)}>
                    {props.copy.insert}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="button-row">
            {['placeholder', 'queued', 'running'].includes(record.state) && (
              <button type="button" className="quiet-button" disabled={props.busy} onClick={() => void props.onCancel(record.id)}>
                {props.copy.cancel}
              </button>
            )}
            {record.error?.retryable && (
              <GenerationRetry
                catalog={props.catalog}
                locale={props.locale}
                record={record}
                busy={props.busy}
                copy={props.copy}
                onRetry={props.onRetry}
              />
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function GenerationRetry(props: {
  catalog: GenerationCatalog
  locale?: Locale
  record: GenerationPanelRecord
  busy?: boolean
  copy: GenerationMessages
  onRetry(recordId: string, consent: GenerationConsent): Promise<void>
}): React.JSX.Element {
  const [providerApproved, setProviderApproved] = useState(false)
  const [uploadApproved, setUploadApproved] = useState(false)
  const [costApproved, setCostApproved] = useState(false)
  const provider = props.catalog.providers.find(({ id }) => id === props.record.providerId)
  const model = provider?.models.find(({ id }) => id === props.record.modelId)
  const quotedMaximumMinor = model
    ? model.cost.maximumMinor * props.record.variantsRequested
    : props.record.quote.maximumMinor
  const retryCostBounded = Number.isSafeInteger(quotedMaximumMinor) && quotedMaximumMinor >= 0
  const retryCurrency = model?.cost.currency ?? props.record.quote.currency
  const requiresProvider = !provider || !model || provider.kind !== 'local' || model.permissions.permissionIds.length > 0
  const requiresUpload = Boolean(model && props.record.referenceAssetIds.length > 0 && model.permissions.mediaUpload === 'explicit')
  const requiresCost = quotedMaximumMinor > 0
  const canRetry = Boolean(
    provider?.status === 'available' && model && retryCostBounded &&
    (!requiresProvider || providerApproved) &&
    (!requiresUpload || uploadApproved) &&
    (!requiresCost || costApproved)
  )
  const retry = async (): Promise<void> => {
    if (!canRetry) return
    await props.onRetry(props.record.id, {
      providerPermissionApproved: providerApproved || !requiresProvider,
      mediaUploadApproved: uploadApproved || !requiresUpload,
      costApproved: costApproved || !requiresCost,
      approvedMaximumMinor: quotedMaximumMinor,
      currency: retryCurrency,
      confirmedAt: new Date().toISOString()
    })
  }

  return (
    <div className="generation-retry" aria-label={props.copy.retry}>
      {requiresProvider && (
        <ConsentCheck checked={providerApproved} onChange={setProviderApproved} label={props.copy.retryProvider} />
      )}
      {requiresUpload && (
        <ConsentCheck
          checked={uploadApproved}
          onChange={setUploadApproved}
          label={format(props.copy.retryUpload, { count: props.record.referenceAssetIds.length })}
        />
      )}
      {requiresCost && (
        <ConsentCheck
          checked={costApproved}
          onChange={setCostApproved}
          label={format(props.copy.retryCost, {
            amount: money(quotedMaximumMinor, retryCurrency, props.locale?.language)
          })}
        />
      )}
      <button type="button" disabled={props.busy || !canRetry} onClick={() => void retry()}>
        {props.copy.confirmRetry}
      </button>
    </div>
  )
}

function ConsentCheck(props: {
  checked: boolean
  label: string
  onChange(value: boolean): void
}): React.JSX.Element {
  return (
    <label className="generation-consent">
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
      <span>{props.label}</span>
    </label>
  )
}

function providersForTask(providers: GenerationProviderDescriptor[], task: GenerationTask): GenerationProviderDescriptor[] {
  return providers.filter(({ status, models }) => status === 'available' && models.some(({ tasks }) => tasks.includes(task)))
}

function preferredOutputKind(model: GenerationModelDescriptor | undefined, task: GenerationTask): GenerationOutputKind | undefined {
  if (!model) return undefined
  const direct = task === 'upscale' ? undefined : task
  return model.outputKinds.find((kind) => kind === direct) ?? model.outputKinds[0]
}

function referenceLimitsFor(model: GenerationModelDescriptor | undefined, task: GenerationTask): {
  minimum: number
  maximum: number
} {
  if (!model) return { minimum: 0, maximum: 0 }
  return task === 'upscale'
    ? { minimum: 1, maximum: 1 }
    : { minimum: model.limits.minReferences, maximum: model.limits.maxReferences }
}

function confirmationRequirements(
  provider: GenerationProviderDescriptor,
  model: GenerationModelDescriptor,
  referenceCount: number,
  variants: number
) {
  const maximumMinorValue = model.cost.maximumMinor * variants
  const costBounded = Number.isSafeInteger(maximumMinorValue)
  const maximumMinor = costBounded ? maximumMinorValue : 0
  return {
    provider: provider.kind !== 'local' || model.permissions.permissionIds.length > 0,
    upload: referenceCount > 0 && model.permissions.mediaUpload === 'explicit',
    cost: maximumMinor > 0,
    maximumMinor,
    costBounded
  }
}

function resetIntent(...setters: Array<(value: boolean) => void>): void {
  setters.forEach((setter) => setter(false))
}

function money(minor: number, currency: string, language = 'en'): string {
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency }).format(minor / 100)
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`
  }
}

function format(message: string, values: Readonly<Record<string, string | number>>): string {
  return message.replace(/\{([^}]+)\}/gu, (match, key: string) => String(values[key] ?? match))
}

type GenerationMessages = ReturnType<typeof generationMessagesFor>

export function generationMessagesFor(locale?: Locale) {
  const zh = locale?.language.toLowerCase().startsWith('zh')
  return zh ? ZH : EN
}

const EN = {
  title: 'Generate and upscale',
  subtitle: 'Provider-neutral, recoverable generation with explicit privacy and cost boundaries.',
  refresh: 'Refresh',
  unavailable: 'Generation unavailable',
  noBroker: 'No approved generation broker or model is connected.',
  manualEditingAvailable: 'Manual editing, transcript workflows, proof, and export remain available.',
  task: 'Task',
  tasks: { image: 'Image', video: 'Video', audio: 'Audio', upscale: 'Upscale' },
  provider: 'Provider',
  model: 'Model',
  prompt: 'Prompt',
  promptPlaceholder: 'Describe the bounded media result…',
  references: 'Reference media',
  offline: 'Offline',
  noReferences: 'No compatible project assets are available.',
  noTaskModel: 'No permitted model supports this task. Choose another task or configure a provider.',
  variants: 'Variants',
  outputPolicy: 'Result handling',
  resolvePlaceholder: 'Resolve placeholder',
  addVariants: 'Keep all variants',
  confirmations: 'Required confirmations',
  localPrivacy: 'Processing stays on this device according to the selected local adapter.',
  remotePrivacy: 'Prompt and approved references are processed by the provider under its retention policy.',
  confirmProvider: 'Allow this provider operation for the exact request.',
  confirmUpload: 'Allow upload of {count} selected reference asset(s).',
  confirmCost: 'Approve a maximum estimated charge of {amount}.',
  hostAuthorization: 'These checks express intent. Kun Host must still issue a short-lived authorization bound to the exact request, uploads, and cost ceiling.',
  createPlaceholder: 'Authorize and create placeholder',
  empty: 'No generation placeholders or jobs for this project.',
  states: {
    placeholder: 'Placeholder', queued: 'Queued', running: 'Running', cancelling: 'Cancelling',
    ready: 'Ready', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted'
  },
  promptFingerprint: 'Prompt fingerprint',
  primary: 'Primary',
  insert: 'Insert into timeline',
  cancel: 'Cancel job',
  retry: 'Requote and retry',
  retryProvider: 'Re-authorize this provider operation.',
  retryUpload: 'Re-authorize upload of {count} reference asset(s).',
  retryCost: 'Re-approve the maximum estimated charge of {amount}.',
  confirmRetry: 'Authorize retry'
} as const

const ZH = {
  title: '生成与超分',
  subtitle: '与供应商无关、可恢复，并明确约束隐私与费用的生成工作流。',
  refresh: '刷新',
  unavailable: '生成能力不可用',
  noBroker: '当前未连接已批准的生成 Broker 或模型。',
  manualEditingAvailable: '手动剪辑、逐字稿、校验和导出仍可正常使用。',
  task: '任务',
  tasks: { image: '图像', video: '视频', audio: '音频', upscale: '超分辨率' },
  provider: '供应商',
  model: '模型',
  prompt: '提示词',
  promptPlaceholder: '描述需要生成的有限媒体结果…',
  references: '参考媒体',
  offline: '离线',
  noReferences: '没有兼容且可用的项目素材。',
  noTaskModel: '没有已获许可的模型支持此任务，请选择其他任务或配置供应商。',
  variants: '变体数量',
  outputPolicy: '结果处理',
  resolvePlaceholder: '解析占位素材',
  addVariants: '保留全部变体',
  confirmations: '必要确认',
  localPrivacy: '所选本地适配器声明处理仅在本机进行。',
  remotePrivacy: '提示词与明确批准的参考素材将按供应商的数据保留政策处理。',
  confirmProvider: '允许供应商处理这一个精确请求。',
  confirmUpload: '允许上传选中的 {count} 个参考素材。',
  confirmCost: '批准最高预估费用 {amount}。',
  hostAuthorization: '这些勾选只表达操作意图；Kun Host 仍必须签发与精确请求、上传素材及费用上限绑定的短期授权。',
  createPlaceholder: '授权并创建占位素材',
  empty: '当前项目还没有生成占位素材或任务。',
  states: {
    placeholder: '占位中', queued: '排队中', running: '生成中', cancelling: '取消中',
    ready: '已就绪', failed: '失败', cancelled: '已取消', interrupted: '已中断'
  },
  promptFingerprint: '提示词指纹',
  primary: '主变体',
  insert: '插入时间线',
  cancel: '取消任务',
  retry: '重新报价并重试',
  retryProvider: '重新授权这一次供应商操作。',
  retryUpload: '重新授权上传 {count} 个参考素材。',
  retryCost: '重新批准最高预估费用 {amount}。',
  confirmRetry: '授权重试'
} as const
