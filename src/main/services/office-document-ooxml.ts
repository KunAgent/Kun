import type { OfficeDocumentFormat } from '../../shared/office-document'

const OOXML_CONTENT_TYPES_MAX_BYTES = 256 * 1024
const EXPECTED_MAIN_CONTENT_TYPE: Record<OfficeDocumentFormat, string> = {
  docx: 'wordprocessingml.document.main+xml',
  xlsx: 'spreadsheetml.sheet.main+xml',
  pptx: 'presentationml.presentation.main+xml'
}

export async function assertOoxmlPackageType(
  filePath: string,
  format: OfficeDocumentFormat
): Promise<void> {
  const contentTypes = await readOoxmlContentTypes(filePath)
  if (!contentTypes.includes(EXPECTED_MAIN_CONTENT_TYPE[format])) {
    throw new Error(`File content does not match the .${format} OOXML format.`)
  }
}

async function readOoxmlContentTypes(filePath: string): Promise<string> {
  const yauzlModule = await import('yauzl')
  const yauzl = yauzlModule.default ?? yauzlModule
  return new Promise<string>((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError ?? new Error('Could not open OOXML package.'))
        return
      }
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        callback()
      }
      zip.once('error', (error) => finish(() => reject(error)))
      zip.once('end', () => finish(() => reject(
        new Error('OOXML package is missing [Content_Types].xml.')
      )))
      zip.on('entry', (entry) => {
        if (entry.fileName !== '[Content_Types].xml') {
          zip.readEntry()
          return
        }
        if (entry.uncompressedSize > OOXML_CONTENT_TYPES_MAX_BYTES) {
          finish(() => reject(new Error('OOXML content types manifest is unexpectedly large.')))
          return
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            finish(() => reject(streamError ?? new Error('Could not read OOXML content types.')))
            return
          }
          const chunks: Buffer[] = []
          let total = 0
          stream.on('data', (chunk: Buffer) => {
            total += chunk.length
            if (total > OOXML_CONTENT_TYPES_MAX_BYTES) {
              stream.destroy(new Error('OOXML content types manifest exceeds the read limit.'))
              return
            }
            chunks.push(chunk)
          })
          stream.once('error', (error) => finish(() => reject(error)))
          stream.once('end', () => finish(() => resolve(Buffer.concat(chunks).toString('utf8'))))
        })
      })
      zip.readEntry()
    })
  })
}
