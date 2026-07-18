import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Clipboard,
  Code2,
  Copy,
  Loader2,
  Monitor,
  MoreHorizontal,
  RefreshCw,
  Smartphone,
  TriangleAlert
} from 'lucide-react'
import type { ComponentPrototypeMetadata, ToolBlock } from '../../agent/types'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { DesignHtmlPreviewHost } from '../design/DesignHtmlPreviewHost'

type ComponentPrototypeCardProps = {
  block: ToolBlock
  workspaceRoot: string
  onPrompt?: (prompt: string) => void
}

type PreviewMode = 'desktop' | 'mobile'

export function componentPrototypeFromBlock(block: ToolBlock): ComponentPrototypeMetadata | null {
  const value = block.meta?.componentPrototype
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.version !== 1) return null
  const profile = raw.profile === 'component-designer' ? 'component-designer' : undefined
  const producer = raw.producer === 'main-agent' || raw.producer === 'component-designer'
    ? raw.producer
    : profile === 'component-designer'
      ? 'component-designer'
      : undefined
  if (!producer || (producer === 'main-agent' && profile)) return null
  if (raw.status !== 'preparing' && raw.status !== 'running' && raw.status !== 'completed' && raw.status !== 'failed') {
    return null
  }
  const artifactId = typeof raw.artifactId === 'string' ? raw.artifactId.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const relativePath = typeof raw.relativePath === 'string' ? raw.relativePath.trim().replaceAll('\\', '/') : ''
  const viewport = raw.viewport && typeof raw.viewport === 'object' && !Array.isArray(raw.viewport)
    ? raw.viewport as Record<string, unknown>
    : null
  if (!artifactId || !title || !relativePath || !viewport) return null
  if (
    !/^\.kun-design\/component-prototypes\/[^/]+\/prototype\.html$/i.test(relativePath)
    || relativePath.split('/').includes('..')
  ) return null
  if (
    typeof viewport.width !== 'number'
    || !Number.isInteger(viewport.width)
    || viewport.width < 280
    || viewport.width > 1_200
    || typeof viewport.height !== 'number'
    || !Number.isInteger(viewport.height)
    || viewport.height < 240
    || viewport.height > 900
  ) return null
  return {
    version: 1,
    status: raw.status,
    artifactId,
    title,
    relativePath,
    viewport: { width: viewport.width, height: viewport.height },
    producer,
    ...(producer === 'component-designer' ? { profile: 'component-designer' as const } : {}),
    ...(typeof raw.childId === 'string' && raw.childId.trim() ? { childId: raw.childId.trim() } : {}),
    ...(typeof raw.byteSize === 'number' && Number.isInteger(raw.byteSize) && raw.byteSize >= 0
      ? { byteSize: raw.byteSize }
      : {}),
    ...(typeof raw.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(raw.contentHash)
      ? { contentHash: raw.contentHash.toLowerCase() }
      : {}),
    ...(typeof raw.summary === 'string' && raw.summary.trim() ? { summary: raw.summary.trim() } : {}),
    ...(typeof raw.error === 'string' && raw.error.trim() ? { error: raw.error.trim() } : {})
  }
}

export function componentPrototypeFrameSize(
  prototype: ComponentPrototypeMetadata,
  mode: PreviewMode
): { width: number | '100%'; height: number } {
  if (mode === 'mobile') {
    return {
      width: Math.min(360, prototype.viewport.width),
      height: Math.min(420, Math.max(240, Math.round(prototype.viewport.height * 0.65)))
    }
  }
  return {
    width: '100%',
    height: Math.min(160, Math.max(124, Math.round(prototype.viewport.height * 0.25)))
  }
}

export function componentPrototypeFollowUpPrompt(
  prototype: ComponentPrototypeMetadata,
  action: 'adopt' | 'iterate',
  language = 'zh'
): string {
  if (!language.toLowerCase().startsWith('zh')) {
    if (action === 'adopt') {
      return `Adopt the “${prototype.title}” interaction prototype from this conversation (${prototype.relativePath}) and apply its confirmed interaction and visual states to the existing component. Check the current component boundary first and preserve the project's design language.`
    }
    return `Continue adjusting the “${prototype.title}” interaction prototype from this conversation (${prototype.relativePath}). I want to change: `
  }
  if (action === 'adopt') {
    return `请采纳会话中的「${prototype.title}」交互稿（${prototype.relativePath}），把确认后的交互和视觉状态应用到现有组件代码。实现前先核对现有组件边界，并保留项目当前设计语言。`
  }
  return `请继续调整会话中的「${prototype.title}」交互稿（${prototype.relativePath}）。我希望修改：`
}

function componentPrototypePartition(blockId: string): string {
  const safe = blockId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'prototype'
  return `kun-component-prototype-${safe}`
}

export function ComponentPrototypeCard({
  block,
  workspaceRoot,
  onPrompt
}: ComponentPrototypeCardProps): ReactElement | null {
  const { t, i18n } = useTranslation('common')
  const prototype = useMemo(() => componentPrototypeFromBlock(block), [block])
  const [mode, setMode] = useState<PreviewMode>('desktop')
  const [mountNonce, setMountNonce] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && !menuRootRef.current?.contains(target)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  if (!prototype) return null

  const running = prototype.status === 'preparing' || prototype.status === 'running'
  const failed = prototype.status === 'failed' || block.status === 'error'
  const frame = componentPrototypeFrameSize(prototype, mode)
  const producerLabel = prototype.producer === 'main-agent'
    ? t('componentPrototypeMainAgent')
    : t('componentPrototypeSubagent')
  const producerSummary = prototype.producer === 'main-agent'
    ? t('componentPrototypeGeneratedByMainAgent')
    : t('componentPrototypeGeneratedBy')
  const statusLabel = failed
    ? t('componentPrototypeFailed')
    : running
      ? t('componentPrototypeDesigning')
      : t('componentPrototypeInteractive')
  const prompt = (action: 'adopt' | 'iterate'): void => {
    setMenuOpen(false)
    onPrompt?.(componentPrototypeFollowUpPrompt(
      prototype,
      action,
      i18n.resolvedLanguage || i18n.language
    ))
  }
  const inspectCode = (): void => {
    setMenuOpen(false)
    previewWorkspaceFile({ path: prototype.relativePath, workspaceRoot })
  }
  const copyCode = async (): Promise<void> => {
    setMenuOpen(false)
    if (typeof window.kunGui?.readWorkspaceFile !== 'function') {
      setCopyState('error')
      return
    }
    const result = await window.kunGui.readWorkspaceFile({ path: prototype.relativePath, workspaceRoot })
      .catch(() => ({ ok: false as const, message: 'read failed' }))
    if (!result.ok) {
      setCopyState('error')
      return
    }
    try {
      await navigator.clipboard.writeText(result.content)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1_500)
    } catch {
      setCopyState('error')
    }
  }

  return (
    <article
      className="ds-component-prototype-card relative mx-auto w-full max-w-[600px] min-w-0 rounded-[11px] border border-ds-border bg-ds-card/95 shadow-[0_5px_18px_rgba(36,68,112,0.06)]"
      data-component-prototype-id={prototype.artifactId}
    >
      <header className="flex h-8 items-center justify-between gap-2 rounded-t-[11px] border-b border-ds-border-muted px-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[12.5px] font-semibold leading-none text-ds-ink">{prototype.title}</h3>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              failed ? 'bg-rose-500' : running ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            title={statusLabel}
            aria-label={statusLabel}
          />
        </div>
        <div ref={menuRootRef} className="relative shrink-0">
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={t('browserMore')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen ? (
            <div
              className="absolute right-0 top-7 z-30 w-48 rounded-[10px] border border-ds-border bg-ds-card p-1.5 shadow-[0_14px_36px_rgba(27,45,76,0.16)]"
              role="menu"
              data-component-prototype-menu
            >
              <p className="truncate px-2 py-1 text-[10.5px] text-ds-faint" title={producerSummary}>{producerLabel}</p>
              <div className="my-1 h-px bg-ds-border-muted" />
              <PrototypeMenuButton
                icon={<Monitor className="h-3.5 w-3.5" />}
                label={t('componentPrototypeDesktop')}
                active={mode === 'desktop'}
                onClick={() => {
                  setMode('desktop')
                  setMenuOpen(false)
                }}
              />
              <PrototypeMenuButton
                icon={<Smartphone className="h-3.5 w-3.5" />}
                label={t('componentPrototypeMobile')}
                active={mode === 'mobile'}
                onClick={() => {
                  setMode('mobile')
                  setMenuOpen(false)
                }}
              />
              <PrototypeMenuButton
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                label={t('componentPrototypeRefresh')}
                onClick={() => {
                  setMountNonce((value) => value + 1)
                  setMenuOpen(false)
                }}
              />
              <div className="my-1 h-px bg-ds-border-muted" />
              <PrototypeMenuButton
                icon={<Code2 className="h-3.5 w-3.5" />}
                label={t('componentPrototypeViewCode')}
                onClick={inspectCode}
              />
              <PrototypeMenuButton
                icon={copyState === 'copied'
                  ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                  : copyState === 'error'
                    ? <TriangleAlert className="h-3.5 w-3.5 text-rose-500" />
                    : <Copy className="h-3.5 w-3.5" />}
                label={t('componentPrototypeCopyCode')}
                onClick={() => void copyCode()}
              />
              {onPrompt ? (
                <>
                  <div className="my-1 h-px bg-ds-border-muted" />
                  <PrototypeMenuButton
                    icon={<Clipboard className="h-3.5 w-3.5" />}
                    label={t('componentPrototypeIterate')}
                    onClick={() => prompt('iterate')}
                    disabled={running || failed}
                  />
                  <PrototypeMenuButton
                    icon={<Check className="h-3.5 w-3.5" />}
                    label={t('componentPrototypeAdopt')}
                    onClick={() => prompt('adopt')}
                    disabled={running || failed}
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex justify-center overflow-auto rounded-b-[11px] bg-ds-subtle/35 p-2">
        {failed ? (
          <div className="flex min-h-[124px] w-full items-center justify-center px-5 py-4 text-center">
            <div className="max-w-md">
              <TriangleAlert className="mx-auto h-4 w-4 text-rose-500" />
              <p className="mt-2 text-[12px] font-medium text-ds-ink">{t('componentPrototypeFailed')}</p>
              <p className="mt-1 break-words text-[11px] leading-4 text-ds-muted">{prototype.error || t('componentPrototypeLoadFailed')}</p>
            </div>
          </div>
        ) : (
          <div
            className="min-w-0 overflow-hidden bg-white transition-[width,height] duration-200"
            style={{ width: frame.width, height: frame.height, maxWidth: '100%' }}
          >
            <DesignHtmlPreviewHost
              key={`${block.id}:${mountNonce}`}
              workspaceRoot={workspaceRoot}
              relativePath={prototype.relativePath}
              enabled={Boolean(workspaceRoot)}
              partition={componentPrototypePartition(block.id)}
              retryMissingFile={running}
              mountWhileSkeleton
            >
              {({ state, renderWebview }) => {
                if (!state.webviewUrl) {
                  return (
                    <div className="flex h-full w-full items-center justify-center bg-[#f7f9fc] text-[11.5px] text-slate-500">
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-accent" />
                      {state.error && !running ? state.error : t('componentPrototypeDesigning')}
                    </div>
                  )
                }
                return renderWebview({
                  className: 'h-full w-full border-0 bg-white',
                  style: { height: '100%', width: '100%' },
                  title: prototype.title
                })
              }}
            </DesignHtmlPreviewHost>
          </div>
        )}
      </div>
    </article>
  )
}

function PrototypeMenuButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick
}: {
  icon: ReactElement
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-accent/10 text-accent' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active ? <Check className="h-3 w-3 shrink-0" /> : null}
    </button>
  )
}
