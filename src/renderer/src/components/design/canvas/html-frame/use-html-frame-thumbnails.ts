import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { embeddedArtifactOf, isHtmlFrame, type CanvasShape } from '../../../../design/canvas/canvas-types'
import { startDesignHtmlPreviewWatch } from '../../../../design/design-preview-file'
import { useDesignWorkspaceStore } from '../../../../design/design-workspace-store'
import { chatBusyForArtifact } from '../../../../design/canvas/screen-generation-recovery'
import { inferDesignArtifactFoundationRole } from '../../../../design/design-types'
import { useChatStore } from '../../../../store/chat-store'
import { htmlFrameDrawingActive } from './html-frame-helpers'
import { HtmlFrameThumbnailCache } from './html-frame-preview-budget'

type SourceState = { revision: number; renderable: boolean }
export type HtmlFrameThumbnail = { key: string; image?: string; pending: boolean; failed: boolean }

export function useHtmlFrameThumbnails(frames: CanvasShape[], workspaceRoot: string): {
  thumbnails: Map<string, HtmlFrameThumbnail>
  onCapture: (shapeId: string, key: string, image: string | null) => void
} {
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const parallelStates = useDesignWorkspaceStore((s) => s.parallelPageStates)
  const pagesRun = useDesignWorkspaceStore((s) => s.pagesRun)
  const sources = useMemo(() => {
    const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
    return frames.filter(isHtmlFrame).flatMap((shape) => {
      const artifact = byId.get(shape.htmlArtifactId ?? '')
      if (artifact?.kind !== 'html') return []
      const versionId = embeddedArtifactOf(shape)?.versionId
      const path = artifact.versions.find((version) => version.id === versionId)?.relativePath ?? artifact.relativePath
      return [{ id: shape.id, path, artifact, historical: Boolean(versionId && path !== artifact.relativePath), baseKey: JSON.stringify([
        workspaceRoot, path, versionId, artifact.updatedAt, shape.width, shape.height
      ]) }]
    })
  }, [artifacts, frames, workspaceRoot])
  const busyPathsKey = useChatStore((state) => JSON.stringify(
    sources.filter((source) => chatBusyForArtifact(state, source.path)).map((source) => source.path)
  ))
  const busyPaths = new Set<string>(JSON.parse(busyPathsKey))
  const pathsKey = JSON.stringify([...new Set(sources.map((source) => source.path))].sort())
  const [sourceStates, setSourceStates] = useState<Map<string, SourceState>>(new Map())
  const watches = useRef(new Map<string, () => void>())
  // Keys include the workspace; obsolete keys are pruned when visible sources change.
  const cache = useMemo(() => new HtmlFrameThumbnailCache(), [])
  const attempted = useMemo(() => new Set<string>(), [])
  const [, refresh] = useState(0)

  useEffect(() => {
    const activeWatches = watches.current
    setSourceStates(new Map())
    return () => {
      for (const stop of activeWatches.values()) stop()
      activeWatches.clear()
    }
  }, [workspaceRoot])

  useEffect(() => {
    const paths = new Set<string>(JSON.parse(pathsKey))
    for (const [path, stop] of watches.current) {
      if (paths.has(path)) continue
      stop()
      watches.current.delete(path)
    }
    for (const path of paths) {
      if (watches.current.has(path)) continue
      let active = true
      const update = (renderable?: boolean): void => {
        if (!active) return
        setSourceStates((current) => {
          const next = new Map(current)
          const previous = current.get(path)
          next.set(path, {
            revision: (previous?.revision ?? 0) + (renderable === undefined ? 1 : 0),
            renderable: renderable ?? previous?.renderable ?? false
          })
          return next
        })
      }
      const stop = startDesignHtmlPreviewWatch({
        workspaceRoot,
        path,
        onRevision: () => update(),
        onPreviewStateChange: (state) => update(state === 'renderable'),
        onError: () => update(false)
      })
      watches.current.set(path, () => { active = false; stop() })
    }
  }, [pathsKey, workspaceRoot])

  const thumbnails = new Map(sources.map((source) => {
    const state = sourceStates.get(source.path)
    const drawing = !source.historical && htmlFrameDrawingActive({
      foundationRole: inferDesignArtifactFoundationRole(source.artifact),
      previewStatus: source.artifact.previewStatus,
      parallelStatus: parallelStates[source.artifact.id]?.status,
      pagesRunPhase: pagesRun?.phase,
      pagesRunStep: pagesRun?.step,
      chatBusy: busyPaths.has(source.path)
    })
    const key = `${source.baseKey}:${state?.revision ?? 0}`
    const image = cache.get(key)
    return [source.id, {
      key, image,
      pending: Boolean(state?.renderable && !drawing && !attempted.has(key)),
      failed: attempted.has(key) && !image
    }] as const
  }))
  const keysSignature = JSON.stringify([...thumbnails.values()].map((entry) => entry.key))
  useEffect(() => {
    const keys = new Set<string>(JSON.parse(keysSignature))
    cache.retain(keys)
    for (const key of attempted) if (!keys.has(key)) attempted.delete(key)
  }, [attempted, cache, keysSignature])
  const currentKeys = useRef(new Map<string, string>())
  currentKeys.current = new Map([...thumbnails].map(([id, thumbnail]) => [id, thumbnail.key]))
  const onCapture = useCallback((shapeId: string, key: string, image: string | null): void => {
    if (currentKeys.current.get(shapeId) !== key) return
    attempted.add(key)
    // An evicted visible image is not immediately retried (avoids capture thrashing).
    // Leaving/re-entering the viewport restarts its watch and creates a fresh revision.
    if (image) cache.set(key, image)
    refresh((revision) => revision + 1)
  }, [attempted, cache])
  return { thumbnails, onCapture }
}
