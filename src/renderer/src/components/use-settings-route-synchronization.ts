import { useEffect } from 'react'
import type { SettingsRouteSection } from '../store/chat-store'

export function useSettingsRouteSynchronization(scope: Record<string, any>): void {
  const { settingsSection, category, setCategory, form, agentsSectionReady, agentsSectionRef, skillSectionRef, mcpSectionRef, permissionsSectionRef } = scope as Record<string, any> & { settingsSection: SettingsRouteSection | null }
  useEffect(() => {
    if (settingsSection === 'general') {
      setCategory('general')
      return
    }
    if (settingsSection === 'providers') {
      setCategory('providers')
      return
    }
    if (settingsSection === 'extensions') {
      setCategory('extensions')
      return
    }
    if (settingsSection === 'write') {
      setCategory('write')
      return
    }
    if (settingsSection === 'design') {
      setCategory('design')
      return
    }
    if (settingsSection === 'imageGeneration') {
      setCategory('mediaGeneration')
      return
    }
    if (settingsSection === 'mediaGeneration') {
      setCategory('mediaGeneration')
      return
    }
    if (settingsSection === 'speechToText') {
      setCategory('speechToText')
      return
    }
    // The Speak tab was retired; its settings are a card under media generation.
    if (settingsSection === 'speak') {
      setCategory('mediaGeneration')
      return
    }
    if (settingsSection === 'permissions') {
      setCategory('agents')
      return
    }
    if (settingsSection === 'laboratory') {
      setCategory('laboratory')
      return
    }
    if (settingsSection === 'subagents') {
      setCategory('subagents')
      return
    }
    if (settingsSection === 'archives') {
      setCategory('archives')
      return
    }
    if (settingsSection === 'worktree') {
      setCategory('worktree')
      return
    }
    if (settingsSection === 'memory') {
      setCategory('memory')
      return
    }
    if (settingsSection === 'claw') {
      setCategory('claw')
      return
    }
    if (settingsSection === 'shortcuts') {
      setCategory('shortcuts')
      return
    }
    if (settingsSection === 'easterEgg') {
      setCategory('easterEgg')
      return
    }
    if (settingsSection === 'updates') {
      setCategory('updates')
      return
    }
    if (settingsSection === 'terminal') {
      setCategory('terminal')
      return
    }
    if (settingsSection === 'debug') {
      setCategory('debug')
      return
    }
    if (settingsSection === 'dataMigration') {
      setCategory('dataMigration')
      return
    }
    if (settingsSection === 'storage') {
      setCategory('storage')
      return
    }
    setCategory('agents')
  }, [settingsSection])

  useEffect(() => {
    if (!form || settingsSection === null) return
    if (
      settingsSection === 'general' ||
      settingsSection === 'providers' ||
      settingsSection === 'extensions' ||
      settingsSection === 'write' ||
      settingsSection === 'design' ||
      settingsSection === 'imageGeneration' ||
      settingsSection === 'mediaGeneration' ||
      settingsSection === 'speechToText' ||
      settingsSection === 'speak' ||
      settingsSection === 'laboratory' ||
      settingsSection === 'subagents' ||
      settingsSection === 'archives' ||
      settingsSection === 'worktree' ||
      settingsSection === 'memory' ||
      settingsSection === 'claw' ||
      settingsSection === 'shortcuts' ||
      settingsSection === 'easterEgg' ||
      settingsSection === 'updates' ||
      settingsSection === 'terminal' ||
      settingsSection === 'debug' ||
      settingsSection === 'storage' ||
      settingsSection === 'dataMigration' ||
      category !== 'agents'
    ) {
      return
    }
    if (!agentsSectionReady) return
    const refs: Record<
      Exclude<SettingsRouteSection, 'general' | 'providers' | 'extensions' | 'write' | 'design' | 'imageGeneration' | 'mediaGeneration' | 'speechToText' | 'speak' | 'laboratory' | 'subagents' | 'archives' | 'worktree' | 'memory' | 'claw' | 'shortcuts' | 'easterEgg' | 'updates' | 'terminal' | 'debug' | 'storage' | 'dataMigration'>,
      HTMLDivElement | null
    > = {
      agents: agentsSectionRef.current,
      skill: skillSectionRef.current,
      mcp: mcpSectionRef.current,
      permissions: permissionsSectionRef.current
    }
    const target = refs[settingsSection]
    if (!target) return
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [agentsSectionReady, category, form, settingsSection])
}
