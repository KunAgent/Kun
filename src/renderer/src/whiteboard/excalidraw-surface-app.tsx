import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import {
  createEmptyExcalidrawScene,
  discardPendingExcalidrawScene,
  excalidrawScenePath,
  pendingExcalidrawDraft,
  serializeExcalidrawScene,
  subscribeExcalidrawSaveError,
  isExcalidrawSceneEmpty,
  loadExcalidrawScene,
  persistExcalidrawScene,
  rememberLiveExcalidrawScene,
  type ExcalidrawSceneV1
} from './excalidraw-persistence'
import {
  excalidrawApplyKey,
  registerExcalidrawApplyHandler,
  reloadAndExportExcalidrawScene
} from './excalidraw-apply'
import {
  ensureExcalidrawAssetPath,
  excalidrawLangCode,
  readDocumentTheme
} from './excalidraw-assets'
import { writeDesignWorkspaceFile } from '../design/design-persistence-coordinator'
import type { ExcalidrawSurfaceProps } from './excalidraw-surface'
import './excalidraw-host.css'

function sceneFromLive(
  elements: readonly OrderedExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles
): ExcalidrawSceneV1 {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'kun',
    elements: [...elements],
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor,
      gridSize: appState.gridSize,
      zoom: appState.zoom,
      scrollX: appState.scrollX,
      scrollY: appState.scrollY
    },
    files: { ...files }
  }
}

export function ExcalidrawSurfaceApp(props: ExcalidrawSurfaceProps): ReactElement {
  const { i18n, t } = useTranslation()
  const [saveError, setSaveError] = useState('')
  const [resolving, setResolving] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(readDocumentTheme)
  const [initialScene, setInitialScene] = useState<ExcalidrawSceneV1 | null>(null)
  const [loadEpoch, setLoadEpoch] = useState(0)
  const emptyRef = useRef<boolean | null>(null)
  const skipPersistRef = useRef(false)
  const onEmptyChangeRef = useRef(props.onEmptyChange)
  const onSceneChangeRef = useRef(props.onSceneChange)
  onEmptyChangeRef.current = props.onEmptyChange
  onSceneChangeRef.current = props.onSceneChange
  const identityKey = `${props.workspaceRoot}\0${props.baseDir}\0${props.identityId}`

  useEffect(() => {
    ensureExcalidrawAssetPath()
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const sync = (): void => setTheme(readDocumentTheme())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    setInitialScene(null)
    emptyRef.current = null
    const draft = pendingExcalidrawDraft(props.workspaceRoot, props.identityId, props.baseDir)
    void (draft ? Promise.resolve(draft) : loadExcalidrawScene(props.workspaceRoot, props.identityId, props.baseDir)).then((loaded) => {
      if (cancelled) return
      skipPersistRef.current = true
      const scene = loaded ?? createEmptyExcalidrawScene()
      rememberLiveExcalidrawScene(props.workspaceRoot, props.identityId, props.baseDir, scene)
      setInitialScene(scene)
      setLoadEpoch((epoch) => epoch + 1)
      const empty = isExcalidrawSceneEmpty(scene)
      emptyRef.current = empty
      onEmptyChangeRef.current?.(empty)
    })
    return () => {
      cancelled = true
    }
  }, [identityKey, props.baseDir, props.identityId, props.workspaceRoot])

  useEffect(() => {
    const key = excalidrawApplyKey(props.workspaceRoot, props.identityId, props.baseDir)
    return registerExcalidrawApplyHandler(key, () => reloadAndExportExcalidrawScene({
      workspaceRoot: props.workspaceRoot,
      identityId: props.identityId,
      baseDir: props.baseDir,
      onReload: (scene) => {
        skipPersistRef.current = true
        setInitialScene(scene)
        setLoadEpoch((epoch) => epoch + 1)
        const empty = isExcalidrawSceneEmpty(scene)
        emptyRef.current = empty
        onEmptyChangeRef.current?.(empty)
      }
    }))
  }, [props.baseDir, props.identityId, props.workspaceRoot])

  useEffect(() => subscribeExcalidrawSaveError(props.workspaceRoot, props.identityId, props.baseDir, setSaveError),
    [props.workspaceRoot, props.identityId, props.baseDir])

  const recoverDiskScene = async (): Promise<void> => {
    setResolving(true)
    try {
      const draft = pendingExcalidrawDraft(props.workspaceRoot, props.identityId, props.baseDir)
      if (draft) {
        const path = excalidrawScenePath(props.identityId, props.baseDir).replace(/excalidraw\.json$/, `local-draft-${crypto.randomUUID()}.json`)
        const result = await writeDesignWorkspaceFile({ workspaceRoot: props.workspaceRoot, path, content: serializeExcalidrawScene(draft) })
        if (!result.ok) throw new Error(result.message)
      }
      await discardPendingExcalidrawScene(props.workspaceRoot, props.identityId, props.baseDir)
      const scene = await loadExcalidrawScene(props.workspaceRoot, props.identityId, props.baseDir)
      if (!scene) throw new Error('The saved board could not be loaded; the local copy was retained.')
      skipPersistRef.current = true
      rememberLiveExcalidrawScene(props.workspaceRoot, props.identityId, props.baseDir, scene)
      setInitialScene(scene)
      setLoadEpoch((epoch) => epoch + 1)
      setSaveError('')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally { setResolving(false) }
  }

  const handleChange = useCallback((
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles
  ): void => {
    const scene = sceneFromLive(elements, appState, files)
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      rememberLiveExcalidrawScene(props.workspaceRoot, props.identityId, props.baseDir, scene)
      onSceneChangeRef.current?.(scene)
      const empty = isExcalidrawSceneEmpty(scene)
      if (emptyRef.current !== empty) {
        emptyRef.current = empty
        onEmptyChangeRef.current?.(empty)
      }
      return
    }
    if (props.readOnly) return
    persistExcalidrawScene(props.workspaceRoot, props.identityId, props.baseDir, scene)
    onSceneChangeRef.current?.(scene)
    const empty = isExcalidrawSceneEmpty(scene)
    if (emptyRef.current !== empty) {
      emptyRef.current = empty
      onEmptyChangeRef.current?.(empty)
    }
  }, [props.baseDir, props.identityId, props.readOnly, props.workspaceRoot])

  const initialData = useMemo(() => {
    if (!initialScene) return null
    return {
      elements: initialScene.elements as OrderedExcalidrawElement[],
      appState: {
        ...(initialScene.appState ?? {}),
        collaborators: new Map()
      },
      files: (initialScene.files ?? {}) as BinaryFiles
    }
  }, [initialScene, loadEpoch])

  if (!initialData) {
    return (
      <div
        className="flex h-full min-h-0 w-full items-center justify-center text-xs text-ds-muted"
        data-excalidraw-host="loading"
      >
        Loading Excalidraw…
      </div>
    )
  }

  return (
    <div className="kun-excalidraw-host relative h-full min-h-0 w-full" data-excalidraw-host="ready">
      {saveError ? <div role="alert" className="absolute left-2 right-2 top-2 z-50 rounded bg-ds-panel p-3 text-sm">
        <p>{saveError}</p>
        <button type="button" disabled={resolving} onClick={() => void recoverDiskScene()}>
          {t('excalidrawRecoverDisk', { defaultValue: 'Save local copy and reload disk version' })}
        </button>
      </div> : null}
      <Excalidraw
        key={identityKey + String(loadEpoch)}
        theme={theme}
        langCode={excalidrawLangCode(i18n.resolvedLanguage ?? i18n.language)}
        viewModeEnabled={props.readOnly === true}
        initialData={initialData}
        onChange={handleChange}
        UIOptions={{
          canvasActions: {
            loadScene: true,
            saveToActiveFile: false,
            toggleTheme: false
          }
        }}
      />
    </div>
  )
}
