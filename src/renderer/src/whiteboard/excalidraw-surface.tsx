import { lazy, Suspense, type ReactElement } from 'react'
import type { ExcalidrawSceneV1 } from './excalidraw-persistence'
import type { CanvasEngine } from './canvas-engine'

export type ExcalidrawSurfaceProps = {
  workspaceRoot: string
  identityId: string
  baseDir: string
  readOnly?: boolean
  onEmptyChange?: (empty: boolean) => void
  onSceneChange?: (scene: ExcalidrawSceneV1) => void
}

const ExcalidrawSurfaceApp = lazy(async () => {
  const module = await import('./excalidraw-surface-app')
  return { default: module.ExcalidrawSurfaceApp }
})

export function ExcalidrawSurface(props: ExcalidrawSurfaceProps): ReactElement {
  return (
    <Suspense
      fallback={(
        <div
          className="flex h-full min-h-0 w-full items-center justify-center text-xs text-ds-muted"
          data-excalidraw-host="loading"
        >
          Loading Excalidraw…
        </div>
      )}
    >
      <ExcalidrawSurfaceApp {...props} />
    </Suspense>
  )
}

export type CanvasEngineSwitcherProps = {
  engine: CanvasEngine
  canSwitch: boolean
  disabledReason?: string
  onChange: (engine: CanvasEngine) => void
  kunLabel: string
  excalidrawLabel: string
}

export function CanvasEngineSwitcher({
  engine,
  canSwitch,
  disabledReason,
  onChange,
  kunLabel,
  excalidrawLabel
}: CanvasEngineSwitcherProps): ReactElement {
  const disabled = !canSwitch
  return (
    <div
      className="pointer-events-auto inline-flex rounded-full border border-ds-border-muted bg-white/88 p-0.5 shadow-sm backdrop-blur-xl dark:bg-ds-card/88"
      data-canvas-engine-switcher="true"
      title={disabled ? disabledReason : undefined}
    >
      {([
        ['kun', kunLabel],
        ['excalidraw', excalidrawLabel]
      ] as const).map(([value, label]) => {
        const active = engine === value
        return (
          <button
            key={value}
            type="button"
            disabled={disabled && !active}
            data-canvas-engine-option={value}
            aria-pressed={active}
            className={`h-7 rounded-full px-2.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
              active ? 'bg-accent text-white' : 'text-ds-muted hover:text-ds-ink'
            }`}
            onClick={() => {
              if (!disabled && value !== engine) onChange(value)
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
