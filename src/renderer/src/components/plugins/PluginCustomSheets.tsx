import { useState, type ReactElement } from 'react'
import { CustomPluginPanel } from '../PluginMarketplaceItemPanels'
import { GitHubSkillImportPanel } from '../PluginMarketplaceRuntimePanels'
import { PluginModal, PluginModalHeader } from './PluginDialogs'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type CustomPluginFields = {
  name: string
  description: string
  command: string
  args: string
  config: string
  skillBody: string
}

const EMPTY: CustomPluginFields = { name: '', description: '', command: '', args: '', config: '', skillBody: '' }

/** "Add custom MCP" / "New skill" form in a modal; resolves true to close. */
export function CustomPluginSheet({ t, kind, busy, onCancel, onSubmit }: {
  t: Translate
  kind: 'mcp' | 'skill'
  busy: boolean
  onCancel: () => void
  onSubmit: (fields: CustomPluginFields) => Promise<boolean>
}): ReactElement {
  const [fields, setFields] = useState<CustomPluginFields>(EMPTY)
  const set = (key: keyof CustomPluginFields) => (value: string): void => setFields((prev) => ({ ...prev, [key]: value }))
  const title = kind === 'mcp' ? t('pluginsAddCustomMcp') : t('pluginsNewSkill')
  return (
    <PluginModal label={title} width={680} onClose={onCancel}>
      <PluginModalHeader t={t} title={title} onClose={onCancel} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <CustomPluginPanel
          activeKind={kind}
          customName={fields.name}
          customDescription={fields.description}
          customCommand={fields.command}
          customArgs={fields.args}
          customConfig={fields.config}
          customSkillBody={fields.skillBody}
          busy={busy}
          onNameChange={set('name')}
          onDescriptionChange={set('description')}
          onCommandChange={set('command')}
          onArgsChange={set('args')}
          onConfigChange={set('config')}
          onSkillBodyChange={set('skillBody')}
          onAdd={() => {
            void onSubmit(fields).then((done) => {
              if (done) setFields(EMPTY)
            })
          }}
        />
      </div>
    </PluginModal>
  )
}

export function GitHubImportSheet({ t, url, busy, summary, onUrlChange, onImport, onCancel }: {
  t: Translate
  url: string
  busy: boolean
  summary: { count: number; names: string[] } | null
  onUrlChange: (value: string) => void
  onImport: () => void
  onCancel: () => void
}): ReactElement {
  return (
    <PluginModal label={t('pluginsImportGithub')} width={640} onClose={onCancel}>
      <PluginModalHeader t={t} title={t('pluginsImportGithub')} onClose={onCancel} />
      <div className="px-6 pb-6">
        <GitHubSkillImportPanel url={url} busy={busy} summary={summary} onUrlChange={onUrlChange} onImport={onImport} />
      </div>
    </PluginModal>
  )
}
