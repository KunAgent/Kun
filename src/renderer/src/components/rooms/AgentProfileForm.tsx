import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity } from '@shared/rooms-api'
import { RoomAvatarPicker } from './RoomAvatarPicker'
import { AgentPicker } from './AgentPicker'
import { agentMember, agentPath, useAgentResource } from './agent-client'
import { roomRequestId, roomsRequest, type RoomPresetCatalog } from './rooms-client'
import './agents.css'

const lines = (text: string) => [...new Set(text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))]
export function AgentProfileForm({ agent: initialAgent, active = true, onSaved }: { agent: AgentIdentity | null; active?: boolean; onSaved: (agent: AgentIdentity) => void }) {
  const { t } = useTranslation('common')
  const [agent, setAgent] = useState(initialAgent)
  const catalog = useAgentResource<RoomPresetCatalog>('/v1/rooms/presets', active)
  const templates = useAgentResource<{ templates: Array<Pick<AgentIdentity, 'name' | 'title' | 'instructions' | 'defaultRole' | 'presetId' | 'avatar' | 'templateId' | 'templateVersion'>> }>('/v1/agents/templates', active)
  const [templateRef, setTemplateRef] = useState({ templateId: agent?.templateId, templateVersion: agent?.templateVersion })
  const [name, setName] = useState(agent?.name ?? ''), [title, setTitle] = useState(agent?.title ?? '')
  const [instructions, setInstructions] = useState(agent?.instructions ?? '')
  const [role, setRole] = useState(agent?.defaultRole ?? 'developer'), [presetId, setPreset] = useState(agent?.presetId ?? 'general')
  const [avatar, setAvatar] = useState(agent?.avatar)
  const [roots, setRoots] = useState(agent?.allowedRepositoryRoots?.join('\n') ?? '')
  const [tools, setTools] = useState(agent?.capabilityOverrides?.blockedTools.join(', ') ?? '')
  const [allowedTools, setAllowedTools] = useState(agent?.capabilityOverrides?.allowedTools?.join(', ') ?? '')
  const [mcp, setMcp] = useState(agent?.capabilityOverrides?.blockedMcpServers.join(', ') ?? '')
  const [skills, setSkills] = useState(agent?.capabilityOverrides?.blockedSkills.join(', ') ?? '')
  const [skillsEnabled, setSkillsEnabled] = useState(agent?.capabilityOverrides?.skillsEnabled !== false)
  const [reviewerId, setReviewerId] = useState(agent?.reviewerAgentId), [reviewerName, setReviewerName] = useState('')
  const [memory, setMemory] = useState(agent?.memory ?? { readEnabled: true, captureEnabled: true })
  const [advancedDirty, setAdvancedDirty] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const pending = useRef<{ hash: string; id: string } | null>(null)
  const preview = agentMember({ ...(agent ?? {}), id: agent?.id ?? 'new-agent', name, avatar, defaultRole: role, presetId } as AgentIdentity)
  const save = async () => {
    if (busy) return
    const advanced = { ...templateRef, defaultRole: role, presetId,
      allowedRepositoryRoots: lines(roots).length ? lines(roots) : null, reviewerAgentId: reviewerId ?? null, memory,
      capabilityOverrides: { blockedTools: lines(tools), allowedTools: lines(allowedTools).length ? lines(allowedTools) : agent?.capabilityOverrides?.allowedTools?.length === 0 ? [] : undefined,
        blockedMcpServers: lines(mcp), blockedSkills: lines(skills), skillsEnabled } }
    const fields = { name, title, instructions, avatar: avatar ?? null, ...(!agent || advancedDirty ? advanced : {}) }
    const payload = agent ? { ...fields, expectedRevision: agent.revision } :
      Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null))
    const hash = JSON.stringify(payload)
    if (pending.current?.hash !== hash) pending.current = { hash, id: roomRequestId() }
    setBusy(true); setError('')
    try {
      const result = await roomsRequest<{ agent: AgentIdentity }>(agent ? agentPath(agent.id) : '/v1/agents',
        agent ? 'PATCH' : 'POST', { ...payload, clientRequestId: pending.current.id })
      pending.current = null; setAgent(result.agent); onSaved(result.agent)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <form className="agent-profile-form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void save() }}>
    {!agent ? <label>{t('agentsTemplate')}<select defaultValue="" aria-label={t('agentsTemplate')} onChange={(event) => {
      const template = templates.data?.templates.find((value) => value.templateId === event.target.value)
      if (!template) { setTemplateRef({ templateId: undefined, templateVersion: undefined }); return }
      setTemplateRef({ templateId: template.templateId, templateVersion: template.templateVersion })
      if (!name) setName(template.name)
      setTitle(template.title); setInstructions(template.instructions); setRole(template.defaultRole); setPreset(template.presetId); setAvatar(template.avatar)
    }}><option value="">{t('agentsCustomTemplate')}</option>{templates.data?.templates.map((template) =>
      <option key={template.templateId} value={template.templateId}>{template.name}</option>)}</select></label> : null}
    <RoomAvatarPicker id={preview.id} label={preview.displayName} avatar={avatar} onChange={setAvatar} />
    <label>{t('agentsName')}<input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label>{t('agentsTitle')}<input maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label>{t('agentsInstructions')}<textarea rows={7} maxLength={8000} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></label>
    <details className="direct-advanced" onChange={() => setAdvancedDirty(true)}><summary>{t('directAdvanced')}</summary>
    <label>{t('roomsRole')}<select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
      {(['coordinator', 'developer', 'reviewer', 'diagnostician'] as const).map((value) =>
        <option key={value} value={value}>{t('rooms' + value[0].toUpperCase() + value.slice(1))}</option>)}
    </select></label>
    <label>{t('roomsProfile')}<select value={presetId} onChange={(e) => setPreset(e.target.value)}>
      {!catalog.data?.presets.some((preset) => preset.id === presetId) ? <option value={presetId}>{presetId}</option> : null}
      {catalog.data?.presets.map((preset) => <option key={preset.id} value={preset.id} disabled={preset.available === false}>{preset.name}</option>)}
    </select></label>
    <label className="agent-checkbox"><input type="checkbox" checked={memory.readEnabled} onChange={(e) => setMemory({ ...memory, readEnabled: e.target.checked })} />{t('agentsReadMemory')}</label>
    <label className="agent-checkbox"><input type="checkbox" checked={memory.captureEnabled} onChange={(e) => setMemory({ ...memory, captureEnabled: e.target.checked })} />{t('agentsCaptureMemory')}</label>
    <AgentPicker label={t('agentsChooseReviewer')} excluded={agent ? [agent.id] : []} onSelect={(value) => { setAdvancedDirty(true); setReviewerId(value.id); setReviewerName(value.name) }} />
    {reviewerId ? <div>{reviewerName || t('agentsReviewerConfigured')} <button type="button" onClick={() => { setAdvancedDirty(true); setReviewerId(undefined); setReviewerName('') }}>{t('roomsCancel')}</button></div> : null}
    <details><summary>{t('agentsLimits')}</summary>
      <label>{t('agentsRepositoryCeiling')}<textarea value={roots} onChange={(e) => setRoots(e.target.value)} rows={3} /></label>
      <label>{t('agentsAllowedTools')}<input value={allowedTools} onChange={(e) => setAllowedTools(e.target.value)} /></label>
      <label>{t('agentsBlockedTools')}<input value={tools} onChange={(e) => setTools(e.target.value)} /></label>
      <label>{t('agentsBlockedMcp')}<input value={mcp} onChange={(e) => setMcp(e.target.value)} /></label>
      <label>{t('agentsBlockedSkills')}<input value={skills} onChange={(e) => setSkills(e.target.value)} /></label>
      <label className="agent-checkbox"><input type="checkbox" checked={skillsEnabled} onChange={(e) => setSkillsEnabled(e.target.checked)} />{t('agentsEnableSkills')}</label>
    </details>
    </details>
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
    <button type="submit" className="rooms-run-primary" disabled={busy}>{t(busy ? 'roomsLoading' : 'agentsSave')}</button>
  </form>
}
