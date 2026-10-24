/**
 * File-type icon kinds. The glyph comes from the family (code, data, text,
 * media...) and the tint from the kind, so TypeScript and Python share a glyph
 * but not a color. Colors live in file-tree-and-viewers.css.
 */
export type FileIconKind =
  | 'ts' | 'js' | 'py' | 'go' | 'rs' | 'java' | 'c' | 'rb' | 'php' | 'swift' | 'code'
  | 'html' | 'css' | 'json' | 'md' | 'txt' | 'sh' | 'env' | 'cfg' | 'lock'
  | 'img' | 'vid' | 'aud' | 'pdf' | 'doc' | 'sheet' | 'slide' | 'zip' | 'bin' | 'file'

const ICON_BY_NAME: Record<string, FileIconKind> = {
  'package-lock.json': 'lock',
  'pnpm-lock.yaml': 'lock',
  'yarn.lock': 'lock',
  'bun.lockb': 'lock',
  'cargo.lock': 'lock',
  'poetry.lock': 'lock',
  'gemfile.lock': 'lock',
  'composer.lock': 'lock',
  license: 'txt',
  licence: 'txt',
  copying: 'txt',
  notice: 'txt',
  authors: 'txt',
  readme: 'md',
  changelog: 'md',
  dockerfile: 'cfg',
  containerfile: 'cfg',
  makefile: 'cfg',
  justfile: 'cfg',
  procfile: 'cfg',
  gemfile: 'rb',
  rakefile: 'rb',
  codeowners: 'cfg'
}

const ICON_BY_EXTENSION: Record<string, FileIconKind> = {}

function register(kind: FileIconKind, extensions: string): void {
  for (const ext of extensions.split(' ')) ICON_BY_EXTENSION[ext] = kind
}

register('ts', 'ts tsx mts cts')
register('js', 'js jsx mjs cjs')
register('py', 'py pyi pyw ipynb')
register('go', 'go')
register('rs', 'rs')
register('java', 'java kt kts scala groovy gradle')
register('c', 'c h cc cpp cxx hpp hh hxx m mm cs')
register('rb', 'rb erb')
register('php', 'php')
register('swift', 'swift')
register('code', 'lua zig nim dart ex exs erl hs ml clj r jl pl sol v diff patch')
register('html', 'html htm xhtml xml vue svelte astro')
register('css', 'css scss sass less styl')
register('json', 'json jsonc json5 jsonl ndjson yaml yml toml proto graphql gql prisma sql')
register('md', 'md mdx markdown rst adoc org tex bib')
register('txt', 'txt text log srt vtt')
register('sh', 'sh bash zsh fish bat cmd ps1 psm1 psd1')
register('env', 'env pem key crt cer p12 pfx')
register('cfg', 'conf cfg ini properties plist editorconfig gitignore gitattributes dockerignore npmrc nvmrc tf hcl')
register('img', 'png jpg jpeg gif webp svg bmp ico icns avif heic heif tif tiff psd')
register('vid', 'mp4 mov m4v webm mkv avi ogv')
register('aud', 'mp3 wav flac aac m4a ogg oga opus')
register('pdf', 'pdf')
register('doc', 'doc docx rtf odt pages')
register('sheet', 'xls xlsx csv tsv ods numbers parquet')
register('slide', 'ppt pptx odp key')
register('zip', 'zip tar gz tgz bz2 xz 7z rar zst jar')
register('bin', 'exe dll so dylib bin wasm o a class dmg iso db sqlite sqlite3 gguf safetensors onnx pt pyc woff woff2 ttf otf')

function fileName(path: string): string {
  return (path.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? path).toLowerCase()
}

export function workspaceFileIconKind(path: string): FileIconKind {
  const name = fileName(path)
  const byName = ICON_BY_NAME[name]
  if (byName) return byName
  if (name === '.env' || name.startsWith('.env.')) return 'env'
  if (name.startsWith('dockerfile.')) return 'cfg'
  if (/^\.[\w-]+rc(\.\w+)?$/.test(name)) return 'cfg'
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'file'
  return ICON_BY_EXTENSION[name.slice(dot + 1)] ?? (dot === 0 ? 'cfg' : 'file')
}
