import { expect, it } from 'vitest'
import { utf8Size } from '@kun/remote-protocol'
import { committedTextChunks, desktopPoint } from './input'
it('maps only the letterboxed video and preserves Unicode when splitting IME text', () => {
  const rect = { left: 100, top: 50, width: 800, height: 600 }, size = { width: 3840, height: 2160 }
  expect(desktopPoint(rect,size,500,350)).toEqual({x:0.5,y:0.5})
  expect(desktopPoint(rect,size,500,70)).toBeNull()
  expect(desktopPoint(rect,size,Infinity,100)).toBeNull()
  const text = '中文👩🏽‍💻'.repeat(500), chunks = committedTextChunks(text)
  expect(chunks.join('')).toBe(text)
  expect(chunks.every(value => utf8Size(value)<=1024)).toBe(true)
  expect(chunks.some(value => /[\ud800-\udbff]$/.test(value))).toBe(false)
})
