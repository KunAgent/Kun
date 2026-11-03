import { describe, expect, it } from 'vitest'
import {
  decodeWorkspaceText,
  guessUtf16WithoutBom,
  isProbablyBinary,
  trimIncompleteUtf8Tail
} from './workspace-text-decoding'

const gbk = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex.replaceAll(' ', ''), 'hex'))

describe('workspace text decoding', () => {
  it('reads plain and BOM-prefixed UTF-8', () => {
    expect(decodeWorkspaceText(Buffer.from('hello 世界', 'utf8'))).toEqual({ text: 'hello 世界', encoding: 'utf-8' })
    expect(decodeWorkspaceText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a', 'utf8')]))?.text).toBe('a')
  })

  it('recognizes UTF-16 with and without a BOM', () => {
    const body = Buffer.from('hello utf16\n', 'utf16le')
    expect(decodeWorkspaceText(Buffer.concat([Buffer.from([0xff, 0xfe]), body]))).toEqual({ text: 'hello utf16\n', encoding: 'utf-16le' })
    expect(decodeWorkspaceText(body)).toEqual({ text: 'hello utf16\n', encoding: 'utf-16le' })
    const bigEndian = Buffer.from(body)
    bigEndian.swap16()
    expect(guessUtf16WithoutBom(bigEndian)).toBe('utf-16be')
    expect(decodeWorkspaceText(bigEndian)?.text).toBe('hello utf16\n')
  })

  it('falls back to GB18030 for Chinese text that is not UTF-8', () => {
    // "中文内容" in GBK.
    expect(decodeWorkspaceText(gbk('d6d0 cec4 c4da c8dd 0a'))).toEqual({ text: '中文内容\n', encoding: 'gb18030' })
  })

  it('keeps UTF-8 when a long document has one broken byte', () => {
    const text = '这是一段很长的中文说明。'.repeat(20)
    const bytes = Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0xff]), Buffer.from('结尾', 'utf8')])
    expect(decodeWorkspaceText(bytes)?.encoding).toBe('utf-8')
  })

  it('uses Windows-1252 when neither UTF-8 nor GB18030 fits', () => {
    expect(decodeWorkspaceText(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))).toEqual({ text: 'café\n', encoding: 'windows-1252' })
  })

  it('reports binary content and keeps ANSI-colored logs as text', () => {
    expect(isProbablyBinary(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))).toBe(true)
    expect(decodeWorkspaceText(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00]))).toBeNull()
    expect(decodeWorkspaceText(Buffer.from('\u001b[32mok\u001b[0m done\n', 'utf8'))?.encoding).toBe('utf-8')
  })

  it('drops a multi-byte character cut by the read limit', () => {
    const bytes = Buffer.from('ab世', 'utf8').subarray(0, 4)
    expect(Buffer.from(trimIncompleteUtf8Tail(bytes)).toString('utf8')).toBe('ab')
    expect(decodeWorkspaceText(bytes, { truncated: true })).toEqual({ text: 'ab', encoding: 'utf-8' })
  })

  it('decodes with a forced encoding', () => {
    expect(decodeWorkspaceText(gbk('d6d0 cec4'), { forced: 'gb18030' })?.text).toBe('中文')
    expect(decodeWorkspaceText(Buffer.from('中文', 'utf8'), { forced: 'utf-8' })?.text).toBe('中文')
  })
})
