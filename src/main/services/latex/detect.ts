import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { LatexEngine, LatexTools } from '../../../shared/latex-project'

export async function detectLatexTools(engine: LatexEngine, toolDirectory = ''): Promise<LatexTools> {
  const searchedPaths = [...new Set([toolDirectory, ...String(process.env.PATH ?? '').split(delimiter),
    ...(process.platform === 'darwin' ? ['/Library/TeX/texbin', '/opt/homebrew/bin', '/usr/local/bin'] : [])].filter(Boolean))]
  async function find(name: string): Promise<string | null> {
    for (const dir of searchedPaths) {
      const path = join(dir, process.platform === 'win32' ? `${name}.exe` : name)
      try { await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return path } catch { /* Try next tool directory. */ }
    }
    return null
  }
  const [latexmk, enginePath, synctex] = await Promise.all([find('latexmk'), find(engine), find('synctex')])
  return { latexmk, engine: enginePath, synctex, searchedPaths }
}
