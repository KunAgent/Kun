import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import type { CanvasDocument } from '../../design/canvas/canvas-types'
import {
  buildDesignTargetContextChip,
  designComposerContextTargetsKey,
  designContextChipsForRoute,
  isHtmlElementContextChipId,
  nextSuppressedDesignContextIds,
  reconcileDesignHtmlElementContext,
  resolveDesignComposerContextViewTargets,
  type DesignHtmlElementContext
} from '../../design/design-composer-context'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { useChatStore } from '../../store/chat-store'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'

export type DesignComposerContextStateOptions = {
  route: string
  canvasDocument: CanvasDocument
  selectedIds: ReadonlySet<string>
  setInput: Dispatch<SetStateAction<string>>
}

export type DesignComposerContextState = {
  designContextChips: ReturnType<typeof designContextChipsForRoute>
  designContextSuppressedIds: ReadonlySet<string>
  designHtmlElementContext: DesignHtmlElementContext | null
  removeDesignContextChip: (id: string) => void
  handleDesignHtmlElementAsContext: (
    context: DesignHtmlElementContext | null,
    promptSeed?: string
  ) => void
}

export function focusActiveDesignComposer(browserDocument: Document = document): boolean {
  const selectors = [
    '[data-primary-floating-composer] [data-floating-composer] textarea:not(:disabled)',
    '[data-floating-composer] textarea:not(:disabled)',
    '[data-design-rail-composer] textarea:not(:disabled)'
  ]
  for (const selector of selectors) {
    const textareas = browserDocument.querySelectorAll<HTMLTextAreaElement>(selector)
    for (const textarea of textareas) {
      if (textarea.closest('[hidden], [aria-hidden="true"]')) continue
      const visibilityCheck = textarea as HTMLTextAreaElement & {
        checkVisibility?: (options?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean
      }
      if (
        typeof visibilityCheck.checkVisibility === 'function' &&
        !visibilityCheck.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
      ) continue
      textarea.focus()
      return true
    }
  }
  return false
}

export function useDesignComposerContextState({
  route,
  canvasDocument,
  selectedIds,
  setInput
}: DesignComposerContextStateOptions): DesignComposerContextState {
  const { t } = useTranslation()
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeArtifactId = useDesignWorkspaceStore((s) => s.activeArtifactId)
  const designTarget = useDesignWorkspaceStore((s) => s.designContext.designTarget ?? 'web')
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const documentKey = useCanvasShapeStore((s) => s.documentKey)
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(() => new Set())
  const [htmlElementContext, setHtmlElementContext] =
    useState<DesignHtmlElementContext | null>(null)

  useEffect(() => {
    setHtmlElementContext(null)
    setSuppressedIds(new Set())
  }, [activeThreadId, documentKey])

  const rawTargets = useMemo(
    () => resolveDesignComposerContextViewTargets({
      route,
      artifacts,
      activeArtifactId,
      canvasDocument,
      selectedIds,
      htmlElementContext
    }),
    [activeArtifactId, artifacts, canvasDocument, htmlElementContext, route, selectedIds]
  )
  const rawTargetsKey = useMemo(() => designComposerContextTargetsKey(rawTargets), [rawTargets])

  useEffect(() => {
    setSuppressedIds(new Set())
  }, [rawTargetsKey])

  useEffect(() => {
    setHtmlElementContext((current) => reconcileDesignHtmlElementContext({
      current,
      route,
      artifacts,
      activeArtifactId
    }))
  }, [activeArtifactId, artifacts, route])

  const visibleTargets = useMemo(
    () => resolveDesignComposerContextViewTargets({
      route,
      artifacts,
      activeArtifactId,
      canvasDocument,
      selectedIds,
      suppressedIds,
      htmlElementContext
    }),
    [activeArtifactId, artifacts, canvasDocument, htmlElementContext, route, selectedIds, suppressedIds]
  )
  const targetChip = useMemo(() => {
    return buildDesignTargetContextChip({
      designTarget,
      webLabel: t('designTargetWeb'),
      appLabel: t('designTargetApp'),
      detail: ({ target, width, height }) => t(
        target === 'app' ? 'designTargetContextApp' : 'designTargetContextWeb',
        { width, height }
      )
    })
  }, [designTarget, t])
  const designContextChips = useMemo(
    () => designContextChipsForRoute({
      route,
      targetChip,
      targets: visibleTargets
    }),
    [route, targetChip, visibleTargets]
  )
  const removeDesignContextChip = useCallback((id: string): void => {
    if (isHtmlElementContextChipId(id)) {
      setHtmlElementContext(null)
    }
    setSuppressedIds((current) => nextSuppressedDesignContextIds(current, id))
  }, [])
  const handleDesignHtmlElementAsContext = useCallback(
    (context: DesignHtmlElementContext | null, promptSeed?: string): void => {
      setHtmlElementContext(context)
      if (promptSeed) {
        setInput((current) => (current.trim() ? current : promptSeed))
        requestAnimationFrame(() => {
          focusActiveDesignComposer()
        })
      }
    },
    [setInput]
  )

  return {
    designContextChips,
    designContextSuppressedIds: suppressedIds,
    designHtmlElementContext: htmlElementContext,
    removeDesignContextChip,
    handleDesignHtmlElementAsContext
  }
}
