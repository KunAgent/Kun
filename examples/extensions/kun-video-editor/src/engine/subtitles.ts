import { engineError } from './errors.js'
import type { Caption, Rational } from './schema.js'
import { framesToMicroseconds } from './time.js'

export type SubtitleFormat = 'srt' | 'vtt'

export function generateSubtitles(
  captions: readonly Caption[],
  fps: Rational,
  format: SubtitleFormat
): string {
  const ordered = [...captions].sort((left, right) =>
    left.startFrame - right.startFrame || left.endFrame - right.endFrame || left.id.localeCompare(right.id)
  )
  for (const caption of ordered) {
    if (caption.endFrame <= caption.startFrame) {
      throw engineError('invalid_project', `Caption ${caption.id} has an empty timing range`)
    }
  }
  if (format === 'srt') {
    const cues = ordered.map((caption, index) => [
      String(index + 1),
      `${formatTimestamp(framesToMicroseconds(caption.startFrame, fps), ',')} --> ${formatTimestamp(framesToMicroseconds(caption.endFrame, fps), ',')}`,
      escapeSubtitleText(caption.text),
      ''
    ].join('\n'))
    return cues.length === 0 ? '' : `${cues.join('\n')}\n`
  }
  const cues = ordered.map((caption) => [
    caption.id,
    `${formatTimestamp(framesToMicroseconds(caption.startFrame, fps), '.')} --> ${formatTimestamp(framesToMicroseconds(caption.endFrame, fps), '.')}`,
    escapeSubtitleText(caption.text),
    ''
  ].join('\n'))
  return `WEBVTT\n\n${cues.join('\n')}`
}

export function escapeSubtitleText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return !(
        code <= 8 ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
      )
    })
    .join('')
    .replaceAll('-->', '→')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .trim()
}

function formatTimestamp(microseconds: number, separator: ',' | '.'): string {
  const milliseconds = Math.floor(microseconds / 1000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1000)
  const millis = milliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`
}
