import { createWriteStream } from 'node:fs'
import { Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type CreateJsonlWriteStream = (path: string) => Writable

type WriteJsonlLinesOptions = {
  createWriteStream?: CreateJsonlWriteStream
}

const createDefaultWriteStream: CreateJsonlWriteStream = (path) => createWriteStream(path, {
  encoding: 'utf-8',
  mode: 0o600
})

/**
 * Streams complete JSONL records to a file and keeps an error listener active
 * for the writer's whole lifetime. `pipeline` owns backpressure and finalization.
 */
export async function writeJsonlLines(
  targetPath: string,
  lines: AsyncIterable<string>,
  options: WriteJsonlLinesOptions = {}
): Promise<void> {
  const writer = (options.createWriteStream ?? createDefaultWriteStream)(targetPath)
  let writerError: unknown
  const onError = (error: Error) => { writerError ??= error }
  writer.on('error', onError)
  try {
    await pipeline(Readable.from(lines), writer)
    if (writerError) throw writerError
  } finally {
    if (!writer.destroyed) writer.destroy()
  }
}
