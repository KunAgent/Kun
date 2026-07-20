/**
 * [INPUT]: 依赖父级 AbortSignal 与当前阶段的 AbortController
 * [OUTPUT]: 对外提供 throwIfResearchAborted、linkResearchAbortSignal
 * [POS]: research/core 的取消传播工具，让总运行取消能够中断搜索、抓取和模型阶段
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export function throwIfResearchAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('research run aborted')
}

export function linkResearchAbortSignal(
  signal: AbortSignal | undefined,
  controller: AbortController
): () => void {
  if (!signal) return () => undefined
  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => undefined
  }
  const onAbort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}
