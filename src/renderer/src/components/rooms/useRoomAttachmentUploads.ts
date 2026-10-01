import { useEffect, useRef, useState } from 'react'
import { uploadRuntimeAttachment } from '../../lib/runtime-attachment'
import { roomComposerImagePreview } from './room-composer-image-preview'

export type PendingRoomAttachment = { id: string; name: string; state: 'uploading' | 'failed'; error?: string }
type Preview = { url: string; transient: boolean } | undefined
type Uploaded = Awaited<ReturnType<typeof uploadRuntimeAttachment>>
/** Cancellation fences late responses; providers without abort support may finish storing unused bytes. */
export function useRoomAttachmentUploads(onUploaded: (attachment: Uploaded, file: File, preview: Preview) => void) {
  const [pending, setPending] = useState<PendingRoomAttachment[]>([])
  const jobs = useRef(new Map<string, { file: File; controller: AbortController }>())
  const callback = useRef(onUploaded); callback.current = onUploaded
  useEffect(() => () => { for (const job of jobs.current.values()) job.controller.abort(); jobs.current.clear() }, [])
  const run = async (id: string, file: File, controller: AbortController) => {
    let preview: Preview
    const signal = controller.signal
    try {
      preview = await roomComposerImagePreview(file)
      if (signal.aborted) return
      const localFilePath = window.kunGui.getPathForFile(file)
      const dataBase64 = localFilePath ? '' : await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(reader.error)
        reader.onabort = () => reject(new Error('Upload cancelled'))
        signal.addEventListener('abort', () => reader.abort(), { once: true })
        reader.readAsDataURL(file)
      })
      if (signal.aborted) return
      const attachment = await uploadRuntimeAttachment({ name: file.name, mimeType: file.type, dataBase64,
        localFilePath: localFilePath || undefined })
      if (signal.aborted) return
      callback.current(attachment, file, preview)
      preview = undefined // The draft owns any accepted preview from here.
      jobs.current.delete(id)
      setPending((current) => current.filter((item) => item.id !== id))
    } catch (error) {
      if (!signal.aborted) setPending((current) => current.map((item) => item.id === id
        ? { ...item, state: 'failed', error: error instanceof Error ? error.message : String(error) } : item))
    } finally { if (preview?.transient) URL.revokeObjectURL(preview.url) }
  }
  const add = async (files: File[], slots: number) => {
    const selected = files.slice(0, Math.max(0, slots - jobs.current.size))
    const scheduled = selected.map((file) => {
      const id = 'upload-' + crypto.randomUUID(), controller = new AbortController()
      jobs.current.set(id, { file, controller })
      return { id, file, controller }
    })
    setPending((current) => [...current, ...scheduled.map(({ id, file }) => ({ id, name: file.name, state: 'uploading' as const }))])
    await Promise.all(scheduled.map(({ id, file, controller }) => run(id, file, controller)))
  }
  const cancel = (id: string) => {
    jobs.current.get(id)?.controller.abort(); jobs.current.delete(id)
    setPending((current) => current.filter((item) => item.id !== id))
  }
  const retry = (id: string) => {
    const job = jobs.current.get(id)
    if (!job || !pending.some((item) => item.id === id && item.state === 'failed')) return
    job.controller.abort()
    const controller = new AbortController(); jobs.current.set(id, { file: job.file, controller })
    setPending((current) => current.map((item) => item.id === id ? { ...item, state: 'uploading', error: undefined } : item))
    void run(id, job.file, controller)
  }
  return { pending, add, cancel, retry, hasPending: () => jobs.current.size > 0, uploading: pending.some((item) => item.state === 'uploading') }
}
