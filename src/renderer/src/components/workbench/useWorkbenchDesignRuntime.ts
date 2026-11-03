import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { ModelReasoningEffort } from '@shared/app-settings'
import {
  buildComposerAssistantPickList,
  resolveComposerAssistantProviderId
} from '../chat/composer-model-selection'
import { useDesignComposerContextState } from '../design/useDesignComposerContextState'
import { useCanvasSelectionStore } from '../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { displayDrawingTitle } from '../../design/design-drawing-title'
import {
  composerReasoningEffortForSelection,
  persistComposerReasoningEffort
} from '../../store/chat-store-helpers'

type UseWorkbenchDesignRuntimeInput = {
  route: string
  designTaskActive?: boolean
  composerPickList: readonly string[]
  composerModelGroups: readonly ModelProviderModelGroup[]
  setInput: Dispatch<SetStateAction<string>>
}

export function useWorkbenchDesignRuntime({
  route,
  designTaskActive = false,
  composerPickList,
  composerModelGroups,
  setInput
}: UseWorkbenchDesignRuntimeInput) {
  const { t } = useTranslation('common')
  const designWorkspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const designAssistantOpen = useDesignWorkspaceStore((s) => s.canvasAssistantOpen)
  const setDesignAssistantOpen = useDesignWorkspaceStore((s) => s.setCanvasAssistantOpen)
  const designImplementOpen = useDesignWorkspaceStore((s) => s.implementOpen)
  const designImplementTitle = useDesignWorkspaceStore((s) => s.implementTitle)
  const designActiveDocumentId = useDesignWorkspaceStore((s) => s.activeDocumentId)
  const designDocuments = useDesignWorkspaceStore((s) => s.documents)
  const designDrawingCreationSubmitting = useDesignWorkspaceStore((s) => s.drawingCreationSubmitting)
  const designAssistantModel = useDesignWorkspaceStore((s) => s.assistantModel)
  const designAssistantProviderId = useDesignWorkspaceStore((s) => s.assistantProviderId)
  const setDesignAssistantModel = useDesignWorkspaceStore((s) => s.setAssistantModel)
  const canvasDocument = useCanvasShapeStore((s) => s.document)
  const canvasDocumentKey = useCanvasShapeStore((s) => s.documentKey)
  const canvasSelectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const designContextRoute = route === 'chat' ? (designTaskActive ? 'design' : 'code') : route
  const contextState = useDesignComposerContextState({
    route: designContextRoute,
    canvasDocument,
    selectedIds: canvasSelectedIds,
    setInput
  })
  const designAssistantPickList = useMemo(() => {
    return buildComposerAssistantPickList({
      composerPickList
    })
  }, [composerPickList])
  const resolvedDesignAssistantProviderId = useMemo(() => {
    return resolveComposerAssistantProviderId({
      composerModelGroups,
      model: designAssistantModel,
      storedProviderId: designAssistantProviderId
    })
  }, [composerModelGroups, designAssistantModel, designAssistantProviderId])
  const [designComposerReasoningEffort, setDesignComposerReasoningEffortState] =
    useState<ModelReasoningEffort>(() => composerReasoningEffortForSelection(
      composerModelGroups,
      designAssistantModel,
      resolvedDesignAssistantProviderId
    ))
  useEffect(() => {
    setDesignComposerReasoningEffortState(composerReasoningEffortForSelection(
      composerModelGroups,
      designAssistantModel,
      resolvedDesignAssistantProviderId
    ))
  }, [composerModelGroups, designAssistantModel, resolvedDesignAssistantProviderId])
  const setDesignComposerReasoningEffort = useCallback((effort: ModelReasoningEffort): void => {
    persistComposerReasoningEffort(
      designAssistantModel,
      resolvedDesignAssistantProviderId,
      effort
    )
    setDesignComposerReasoningEffortState(effort)
  }, [designAssistantModel, resolvedDesignAssistantProviderId])
  const activeDrawing = useMemo(
    () => designDocuments.find((document) => document.id === designActiveDocumentId) ?? null,
    [designActiveDocumentId, designDocuments]
  )
  const designDrawingTitle = activeDrawing
    ? displayDrawingTitle(activeDrawing, t('designUntitledDrawing'))
    : t('designUntitledDrawing')

  const selectCanvasShape = useCallback((shapeId: string): void => {
    useCanvasSelectionStore.getState().select([shapeId])
  }, [])

  return {
    designWorkspaceRoot,
    designAssistantOpen,
    setDesignAssistantOpen,
    designImplementOpen,
    designImplementTitle,
    designActiveDocumentId,
    designDrawingCreationSubmitting,
    designDrawingTitle,
    designAssistantModel,
    setDesignAssistantModel,
    designComposerReasoningEffort,
    setDesignComposerReasoningEffort,
    canvasDocument,
    canvasDocumentKey,
    canvasSelectedIds,
    designAssistantPickList,
    resolvedDesignAssistantProviderId,
    selectCanvasShape,
    ...contextState
  }
}
