import { useEffect, useRef } from 'react'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useDesignWorkspaceStore } from '../design-workspace-store'
import { currentDesignArtifactVersion } from '../design-types'
import { isHtmlFrame } from './canvas-types'
import { useCanvasShapeStore } from './canvas-shape-store'
import { subscribeCanvasTurnTerminal } from './canvas-turn-terminal-registry'
import type { CanvasScreenCreatedHandler } from './canvas-design-replay-support'

const RESERVED_FILE_PATTERN = /Reserved artifact file:\s*(\S+)/

/** The artifact file a screen-generation turn prompt reserved for itself. */
export function reservedArtifactPathFromPrompt(text: string): string | null {
  return RESERVED_FILE_PATTERN.exec(text)?.[1] ?? null
}

function reservedPathForTurn(blocks: readonly ChatBlock[], turnId: string): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.kind === 'user' && (block.turnId === turnId || block.id === turnId)) {
      return reservedArtifactPathFromPrompt(block.text)
    }
  }
  return null
}

/**
 * Whether the running turn can be what is drawing the page at `artifactPath`.
 * A busy thread painting a different screen must not make every other pending
 * frame look like it is generating.
 */
export function chatBusyForArtifact(
  state: { busy: boolean; blocks: readonly ChatBlock[] },
  artifactPath: string | undefined
): boolean {
  if (!state.busy) return false
  if (!artifactPath) return true
  for (let index = state.blocks.length - 1; index >= 0; index -= 1) {
    const block = state.blocks[index]
    if (block.kind !== 'user') continue
    const reserved = reservedArtifactPathFromPrompt(block.text)
    return !reserved || reserved === artifactPath
  }
  return true
}

type RetryHandler = (artifactId: string) => boolean
let retryHandler: RetryHandler | null = null

/** Ask the mounted canvas to generate a failed screen again. */
export function requestScreenGenerationRetry(artifactId: string): boolean {
  return retryHandler?.(artifactId) ?? false
}

/**
 * A screen whose generation turn failed would otherwise stay on its placeholder
 * forever: mark it failed so the frame can say so and offer a retry, and wire
 * that retry back to the screen generator.
 */
export function useScreenGenerationRecovery(onScreenCreated?: CanvasScreenCreatedHandler): void {
  const handlerRef = useRef(onScreenCreated)
  handlerRef.current = onScreenCreated
  useEffect(() => {
    const unsubscribe = subscribeCanvasTurnTerminal((turnId, record) => {
      if (record.outcome !== 'failed') return
      const path = reservedPathForTurn(useChatStore.getState().blocks, turnId)
      if (!path) return
      const workspace = useDesignWorkspaceStore.getState()
      const artifact = workspace.artifacts.find((item) =>
        item.kind === 'html' && item.relativePath === path && item.previewStatus === 'pending'
      )
      if (artifact) workspace.setArtifactPreviewStatus(artifact.id, 'error')
    })
    const retry: RetryHandler = (artifactId) => {
      const handler = handlerRef.current
      const workspace = useDesignWorkspaceStore.getState()
      const artifact = workspace.artifacts.find((item) => item.id === artifactId && item.kind === 'html')
      const shape = Object.values(useCanvasShapeStore.getState().document.objects).find(
        (candidate) => candidate && isHtmlFrame(candidate) && candidate.htmlArtifactId === artifactId
      )
      if (!handler || !artifact || !shape) return false
      workspace.setArtifactPreviewStatus(artifactId, 'pending')
      const brief = currentDesignArtifactVersion(artifact)?.summary?.trim() ?? ''
      void Promise.resolve(handler(shape.id, '', brief)).then((sent) => {
        if (sent === false) useDesignWorkspaceStore.getState().setArtifactPreviewStatus(artifactId, 'error')
      })
      return true
    }
    retryHandler = retry
    return () => {
      unsubscribe()
      if (retryHandler === retry) retryHandler = null
    }
  }, [])
}
