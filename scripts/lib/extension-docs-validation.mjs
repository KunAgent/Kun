import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

export const API_EXPORTS_BEGIN = '<!-- BEGIN GENERATED SDK EXPORTS -->'
export const API_EXPORTS_END = '<!-- END GENERATED SDK EXPORTS -->'
export const SDK_SNAPSHOTS_BEGIN = '<!-- BEGIN GENERATED SDK PUBLIC SURFACE SNAPSHOTS -->'
export const SDK_SNAPSHOTS_END = '<!-- END GENERATED SDK PUBLIC SURFACE SNAPSHOTS -->'

const SDK_DEFINITIONS = [
  {
    name: '@kun/extension-api',
    packageRoot: 'packages/extension-api',
    entry: 'src/index.ts'
  },
  {
    name: '@kun/extension-react',
    packageRoot: 'packages/extension-react',
    entry: 'src/index.tsx'
  },
  {
    name: '@kun/extension-test',
    packageRoot: 'packages/extension-test',
    entry: 'src/index.ts'
  }
]

export async function validateExtensionDocumentation(root) {
  const docsRoot = join(root, 'docs', 'extensions')
  const files = (await readdir(docsRoot)).filter((name) => name.endsWith('.md')).sort()
  const problems = []
  let checkedSnippets = 0
  const pairs = []

  for (const name of files) {
    if (name.endsWith('.en.md')) continue
    const english = name === 'README.md' ? 'README.en.md' : name.replace(/\.md$/, '.en.md')
    if (!files.includes(english)) problems.push(`${english} is missing for ${name}`)
    else pairs.push([name, english])
  }
  for (const name of files.filter((candidate) => candidate.endsWith('.en.md'))) {
    const chinese = name === 'README.en.md' ? 'README.md' : name.replace(/\.en\.md$/, '.md')
    if (!files.includes(chinese)) problems.push(`${name} has no Chinese source ${chinese}`)
  }

  const markdownByPath = new Map()
  for (const name of files) {
    const path = join(docsRoot, name)
    const markdown = await readFile(path, 'utf8')
    markdownByPath.set(resolve(path), markdown)
    const snippetResult = validateMarkdownSnippets(name, markdown)
    problems.push(...snippetResult.problems)
    checkedSnippets += snippetResult.checked
  }

  for (const [chinese, english] of pairs) {
    problems.push(...validateBilingualPair(
      chinese,
      markdownByPath.get(resolve(docsRoot, chinese)),
      english,
      markdownByPath.get(resolve(docsRoot, english))
    ))
  }

  for (const name of files) {
    const path = resolve(docsRoot, name)
    problems.push(...await validateMarkdownLinks(name, path, markdownByPath.get(path), markdownByPath))
  }

  for (const [readme, expected] of [
    ['README.md', 'docs/extensions/README.md'],
    ['README.en.md', 'docs/extensions/README.en.md']
  ]) {
    const text = await readFile(join(root, readme), 'utf8')
    if (!text.includes(expected)) problems.push(`${readme} does not link to ${expected}`)
  }

  const sdkPackages = await inspectPublicSdkPackages(root)
  for (const [name, locale] of [['api-reference.md', 'zh'], ['api-reference.en.md', 'en']]) {
    const markdown = markdownByPath.get(resolve(docsRoot, name))
    if (markdown === undefined) {
      problems.push(`${name} is missing`)
      continue
    }
    problems.push(...validateGeneratedRegion(
      name,
      markdown,
      renderApiExportsRegion(sdkPackages, locale),
      API_EXPORTS_BEGIN,
      API_EXPORTS_END
    ))
  }

  const expectedSnapshots = renderSdkSnapshotsRegion(sdkPackages)
  for (const name of ['release-troubleshooting-changelog.md', 'release-troubleshooting-changelog.en.md']) {
    const markdown = markdownByPath.get(resolve(docsRoot, name))
    if (markdown === undefined) continue
    problems.push(...validateGeneratedRegion(
      name,
      markdown,
      expectedSnapshots,
      SDK_SNAPSHOTS_BEGIN,
      SDK_SNAPSHOTS_END
    ))
    const apiVersion = sdkPackages.find((candidate) => candidate.name === '@kun/extension-api')?.version
    if (apiVersion && !markdown.includes(`### v${apiVersion}`)) {
      problems.push(`${name}: API Changelog has no v${apiVersion} entry`)
    }
  }

  for (const name of ['README.md', 'README.en.md']) {
    const markdown = markdownByPath.get(resolve(docsRoot, name))
    const target = name === 'README.md' ? './api-reference.md' : './api-reference.en.md'
    if (markdown !== undefined && !markdown.includes(target)) {
      problems.push(`${name} does not link to ${target}`)
    }
  }

  return { files, pairs, problems, checkedSnippets, sdkPackages }
}

export function validateBilingualPair(chineseName, chineseMarkdown, englishName, englishMarkdown) {
  const problems = []
  const chinese = parseMarkdown(chineseMarkdown)
  const english = parseMarkdown(englishMarkdown)
  const chineseHeadings = markdownHeadings(chinese.outside)
  const englishHeadings = markdownHeadings(english.outside)
  const chineseLevels = chineseHeadings.map((heading) => heading.level)
  const englishLevels = englishHeadings.map((heading) => heading.level)
  if (JSON.stringify(chineseLevels) !== JSON.stringify(englishLevels)) {
    problems.push(
      `${chineseName}/${englishName}: heading hierarchy differs ` +
      `(${chineseLevels.join(',')} vs ${englishLevels.join(',')})`
    )
  }
  if (chineseHeadings.filter((heading) => heading.level === 1).length !== 1) {
    problems.push(`${chineseName}: expected exactly one level-1 heading`)
  }
  if (englishHeadings.filter((heading) => heading.level === 1).length !== 1) {
    problems.push(`${englishName}: expected exactly one level-1 heading`)
  }
  for (const [name, headings] of [[chineseName, chineseHeadings], [englishName, englishHeadings]]) {
    for (const heading of headings) {
      if (!heading.anchor) problems.push(`${name}: heading cannot produce a usable anchor: ${heading.text}`)
    }
  }
  const chineseFences = chinese.fences.map((fence) => fence.language)
  const englishFences = english.fences.map((fence) => fence.language)
  if (JSON.stringify(chineseFences) !== JSON.stringify(englishFences)) {
    problems.push(
      `${chineseName}/${englishName}: fenced-code sequence differs ` +
      `(${chineseFences.join(',')} vs ${englishFences.join(',')})`
    )
  }
  return problems
}

export function validateMarkdownSnippets(name, markdown) {
  const problems = []
  let checked = 0
  const parsed = parseMarkdown(markdown)
  problems.push(...parsed.problems.map((problem) => `${name}: ${problem}`))
  for (const fence of parsed.fences) {
    if (!['json', 'jsonc', 'ts', 'typescript', 'tsx'].includes(fence.language)) continue
    const skip = fence.options.find((option) => option.startsWith('doc-skip='))
    if (skip) {
      if (!/^doc-skip=[a-z0-9][a-z0-9-]*$/u.test(skip)) {
        problems.push(`${name}:${fence.line}: doc-skip requires a stable kebab-case reason`)
      }
      continue
    }
    if (fence.options.some((option) => option === 'doc-skip' || option.startsWith('doc-skip'))) {
      problems.push(`${name}:${fence.line}: malformed doc-skip marker`)
      continue
    }
    checked += 1
    if (fence.language === 'json') {
      try {
        JSON.parse(fence.code)
      } catch (error) {
        problems.push(`${name}:${fence.line}: invalid JSON snippet: ${error.message}`)
      }
      continue
    }
    if (fence.language === 'jsonc') {
      const parsedJson = ts.parseConfigFileTextToJson(`${name}:${fence.line}`, fence.code)
      if (parsedJson.error) {
        problems.push(
          `${name}:${fence.line}: invalid JSONC snippet: ` +
          ts.flattenDiagnosticMessageText(parsedJson.error.messageText, ' ')
        )
      }
      continue
    }
    const transpiled = ts.transpileModule(fence.code, {
      fileName: `${name.replace(/\.md$/u, '')}-${fence.line}.${fence.language === 'tsx' ? 'tsx' : 'ts'}`,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX
      }
    })
    for (const diagnostic of transpiled.diagnostics ?? []) {
      if (diagnostic.category !== ts.DiagnosticCategory.Error) continue
      problems.push(
        `${name}:${fence.line}: invalid TypeScript snippet: ` +
        ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
      )
    }
  }
  return { problems, checked }
}

export async function inspectPublicSdkPackages(root) {
  const result = []
  for (const definition of SDK_DEFINITIONS) {
    const packageRoot = resolve(root, definition.packageRoot)
    const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    const configPath = join(packageRoot, 'tsconfig.build.json')
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
    if (configFile.error) throw new Error(formatDiagnostic(configFile.error))
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageRoot, undefined, configPath)
    if (parsed.errors.length > 0) throw new Error(parsed.errors.map(formatDiagnostic).join('\n'))
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } })
    const typeErrors = ts.getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    if (typeErrors.length > 0) {
      throw new Error(
        `${definition.name} cannot produce an API reference:\n` +
        typeErrors.map(formatDiagnosticWithLocation).join('\n')
      )
    }
    const checker = program.getTypeChecker()
    const entryPath = resolve(packageRoot, definition.entry)
    const entry = program.getSourceFile(entryPath)
    const moduleSymbol = entry && checker.getSymbolAtLocation(entry)
    if (!entry || !moduleSymbol) throw new Error(`Cannot inspect public SDK entry ${entryPath}`)
    const exports = checker.getExportsOfModule(moduleSymbol).map((exportSymbol) => {
      const symbol = exportSymbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exportSymbol)
        : exportSymbol
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
      if (!declaration) throw new Error(`Public export ${exportSymbol.name} has no declaration`)
      const sourceFile = declaration.getSourceFile().fileName
      if (!isPathWithinRoot(join(packageRoot, 'src'), sourceFile)) {
        throw new Error(`Public export ${exportSymbol.name} escapes ${definition.name}: ${sourceFile}`)
      }
      return {
        name: exportSymbol.name,
        kind: publicSymbolKind(symbol),
        module: relative(join(packageRoot, 'src'), sourceFile)
          .replaceAll('\\', '/')
          .replace(/\.(?:d\.)?[cm]?[jt]sx?$/u, '')
      }
    }).sort((left, right) => left.name.localeCompare(right.name, 'en'))
    const duplicateNames = exports.filter((entry, index) => exports[index - 1]?.name === entry.name)
    if (duplicateNames.length > 0) {
      throw new Error(`${definition.name} exposes duplicate names: ${duplicateNames.map((entry) => entry.name).join(', ')}`)
    }
    const entryPoints = Object.keys(packageJson.exports ?? { '.': packageJson.main }).sort()
    result.push({
      name: definition.name,
      version: packageJson.version,
      entryPoints,
      exports,
      surfaceSha256: publicSurfaceFingerprint(packageRoot, entryPath, parsed, entryPoints, exports)
    })
  }
  return result
}

export function isPathWithinRoot(root, candidate, pathApi = { isAbsolute, relative, sep }) {
  const relativePath = pathApi.relative(root, candidate)
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(relativePath)
  )
}

export function renderApiExportsRegion(sdkPackages, locale) {
  const summaryLabels = locale === 'zh'
    ? ['SDK 包', '版本', '公开入口', '公开导出数', '公开 surface SHA-256']
    : ['SDK package', 'Version', 'Public entry points', 'Public exports', 'Public surface SHA-256']
  const inventoryLabels = locale === 'zh'
    ? ['SDK 包', '源码模块', '运行时导出', '类型导出']
    : ['SDK package', 'Source module', 'Runtime exports', 'Type exports']
  const lines = [API_EXPORTS_BEGIN]
  lines.push(`| ${summaryLabels.join(' | ')} |`)
  lines.push(`| ${summaryLabels.map(() => '---').join(' | ')} |`)
  for (const sdk of sdkPackages) {
    lines.push(
      `| \`${sdk.name}\` | \`${sdk.version}\` | ${sdk.entryPoints.map((entry) => `\`${entry}\``).join('<br>')} | ` +
      `${sdk.exports.length} | \`${sdk.surfaceSha256}\` |`
    )
  }
  lines.push('')
  lines.push(`| ${inventoryLabels.join(' | ')} |`)
  lines.push(`| ${inventoryLabels.map(() => '---').join(' | ')} |`)
  for (const sdk of sdkPackages) {
    const modules = new Map()
    for (const entry of sdk.exports) {
      const bucket = modules.get(entry.module) ?? { runtime: [], types: [] }
      if (['class', 'const', 'enum', 'function'].includes(entry.kind)) bucket.runtime.push(entry.name)
      else bucket.types.push(entry.name)
      modules.set(entry.module, bucket)
    }
    for (const [module, bucket] of [...modules.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
      lines.push(
        `| \`${sdk.name}\` | \`${module}\` | ${renderSymbolList(bucket.runtime)} | ${renderSymbolList(bucket.types)} |`
      )
    }
  }
  lines.push(API_EXPORTS_END)
  return lines.join('\n')
}

export function renderSdkSnapshotsRegion(sdkPackages) {
  return [
    SDK_SNAPSHOTS_BEGIN,
    ...sdkPackages.map((sdk) =>
      `<!-- sdk-surface-snapshot ${sdk.name}@${sdk.version} sha256:${sdk.surfaceSha256} -->`
    ),
    SDK_SNAPSHOTS_END
  ].join('\n')
}

export function validateGeneratedRegion(name, markdown, expected, begin, end) {
  const start = markdown.indexOf(begin)
  const finish = markdown.indexOf(end)
  if (start < 0 || finish < 0 || finish < start) {
    return [`${name}: generated region ${begin} ... ${end} is missing or malformed`]
  }
  const actual = markdown.slice(start, finish + end.length).replaceAll('\r\n', '\n')
  if (actual !== expected.replaceAll('\r\n', '\n')) {
    return [`${name}: generated API/export snapshot drifted; regenerate it and update the API Changelog`]
  }
  return []
}

export function replaceGeneratedRegion(markdown, replacement, begin, end) {
  const start = markdown.indexOf(begin)
  const finish = markdown.indexOf(end)
  if (start < 0 || finish < 0 || finish < start) {
    throw new Error(`Generated region ${begin} ... ${end} is missing or malformed`)
  }
  return `${markdown.slice(0, start)}${replacement}${markdown.slice(finish + end.length)}`
}

function parseMarkdown(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const outside = [...lines]
  const fences = []
  const problems = []
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^(\s*)(`{3,}|~{3,})(.*)$/u.exec(lines[index])
    if (!opening) continue
    const openingLine = index + 1
    const marker = opening[2]
    const info = opening[3].trim().split(/\s+/u).filter(Boolean)
    const code = []
    outside[index] = ''
    let closed = false
    for (index += 1; index < lines.length; index += 1) {
      outside[index] = ''
      const closing = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`, 'u')
      if (closing.test(lines[index])) {
        closed = true
        break
      }
      code.push(lines[index])
    }
    if (!closed) problems.push(`unterminated fenced code block at line ${openingLine}`)
    fences.push({
      language: (info[0] ?? 'plain').toLowerCase(),
      options: info.slice(1),
      code: code.join('\n'),
      line: openingLine
    })
  }
  return { outside: outside.join('\n'), fences, problems }
}

function markdownHeadings(markdown) {
  const used = new Map()
  return [...markdown.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gmu)].map((match) => {
    const base = githubHeadingSlug(match[2])
    const count = used.get(base) ?? 0
    used.set(base, count + 1)
    return {
      level: match[1].length,
      text: match[2],
      anchor: count === 0 ? base : `${base}-${count}`
    }
  })
}

export function githubHeadingSlug(heading) {
  return stripInlineHtmlTags(heading)
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/`([^`]*)`/gu, '$1')
    .toLocaleLowerCase('en-US')
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/\s+/gu, '-')
}

function stripInlineHtmlTags(value) {
  let result = ''
  let cursor = 0
  while (cursor < value.length) {
    const opening = value.indexOf('<', cursor)
    if (opening < 0) return result + value.slice(cursor)
    const closing = value.indexOf('>', opening + 1)
    if (closing < 0) return result + value.slice(cursor)
    result += value.slice(cursor, opening)
    cursor = closing + 1
  }
  return result
}

export async function validateMarkdownLinks(name, path, markdown, markdownByPath) {
  const problems = []
  const { outside } = parseMarkdown(markdown)
  const targets = [
    ...[...outside.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)].map((match) => match[1]),
    ...[...outside.matchAll(/^\[[^\]]+\]:\s*(\S+)/gmu)].map((match) => match[1])
  ]
  for (const rawTarget of targets) {
    let target = rawTarget.trim().replace(/^<|>$/gu, '')
    target = target.split(/\s+["']/u, 1)[0]
    if (!target || /^(?:https?:|mailto:|app:)/iu.test(target)) continue
    let decoded
    try {
      decoded = decodeURIComponent(target)
    } catch {
      problems.push(`${name}: link is not valid URI encoding: ${target}`)
      continue
    }
    const hashIndex = decoded.indexOf('#')
    const fileTarget = hashIndex >= 0 ? decoded.slice(0, hashIndex) : decoded
    const anchor = hashIndex >= 0 ? decoded.slice(hashIndex + 1) : ''
    const targetPath = resolve(dirname(path), fileTarget || '.')
    if (fileTarget) {
      try {
        await access(targetPath)
      } catch {
        problems.push(`${name}: broken relative link ${target}`)
        continue
      }
    }
    if (!anchor || (fileTarget && extname(targetPath).toLowerCase() !== '.md')) continue
    const targetMarkdown = fileTarget
      ? markdownByPath.get(targetPath) ?? await readFile(targetPath, 'utf8')
      : markdown
    const anchors = new Set(markdownHeadings(parseMarkdown(targetMarkdown).outside).map((heading) => heading.anchor))
    for (const match of targetMarkdown.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/giu)) anchors.add(match[1])
    if (!anchors.has(anchor)) problems.push(`${name}: broken Markdown anchor ${target}`)
  }
  return problems
}

function publicSurfaceFingerprint(packageRoot, entryPath, parsed, entryPoints, publicExports) {
  const outputs = new Map()
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: {
      ...parsed.options,
      composite: false,
      declaration: true,
      declarationMap: false,
      emitDeclarationOnly: true,
      incremental: false,
      noEmit: false,
      noEmitOnError: false,
      sourceMap: false
    }
  })
  const emitted = program.emit(undefined, (fileName, data) => {
    if (!fileName.endsWith('.d.ts')) return
    outputs.set(resolve(fileName), {
      path: relative(packageRoot, fileName).replaceAll('\\', '/'),
      data: data.replaceAll('\r\n', '\n')
    })
  })
  if (emitted.emitSkipped || outputs.size === 0) {
    throw new Error(`Cannot emit public declarations for ${packageRoot}`)
  }
  const sourceRoot = parsed.options.rootDir ?? packageRoot
  const outputRoot = parsed.options.declarationDir ?? parsed.options.outDir ?? sourceRoot
  const relativeEntry = relative(sourceRoot, entryPath).replace(/\.[cm]?[jt]sx?$/u, '.d.ts')
  const entryOutput = resolve(outputRoot, relativeEntry)
  if (!outputs.has(entryOutput)) throw new Error(`Cannot find emitted public declaration entry ${entryOutput}`)
  const reachable = new Set()
  const pending = [entryOutput]
  while (pending.length > 0) {
    const path = pending.pop()
    if (reachable.has(path)) continue
    reachable.add(path)
    const output = outputs.get(path)
    if (!output) throw new Error(`Public declaration graph references missing output ${path}`)
    const source = ts.createSourceFile(path, output.data, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const specifiers = []
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specifiers.push(node.moduleSpecifier.text)
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        specifiers.push(node.argument.literal.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    for (const specifier of specifiers.filter((candidate) => candidate.startsWith('.'))) {
      const base = resolve(dirname(path), specifier)
      const declarationBase = base.replace(/\.[cm]?js$/u, '.d.ts')
      const dependency = [base, declarationBase, `${base}.d.ts`, join(base, 'index.d.ts')]
        .find((candidate) => outputs.has(candidate))
      if (!dependency) throw new Error(`Cannot resolve public declaration import ${specifier} from ${path}`)
      pending.push(dependency)
    }
  }
  const hash = createHash('sha256')
  hash.update(JSON.stringify({
    entryPoints,
    exports: publicExports.map(({ name, kind, module }) => ({ name, kind, module }))
  }))
  hash.update('\0')
  const publicOutputs = [...reachable].map((path) => outputs.get(path))
  for (const output of publicOutputs.sort((left, right) => left.path.localeCompare(right.path, 'en'))) {
    hash.update(output.path)
    hash.update('\0')
    hash.update(output.data)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function publicSymbolKind(symbol) {
  if (symbol.flags & ts.SymbolFlags.Class) return 'class'
  if (symbol.flags & ts.SymbolFlags.Function) return 'function'
  if (symbol.flags & ts.SymbolFlags.Enum) return 'enum'
  if (symbol.flags & ts.SymbolFlags.Variable) return 'const'
  if (symbol.flags & ts.SymbolFlags.Interface) return 'interface'
  if (symbol.flags & ts.SymbolFlags.TypeAlias) return 'type'
  return 'type'
}

function renderSymbolList(symbols) {
  return symbols.length > 0 ? symbols.map((symbol) => `\`${symbol}\``).join('<br>') : '—'
}

function formatDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
}

function formatDiagnosticWithLocation(diagnostic) {
  const message = formatDiagnostic(diagnostic)
  if (!diagnostic.file || diagnostic.start === undefined) return message
  const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  return `${diagnostic.file.fileName}:${location.line + 1}:${location.character + 1}: ${message}`
}
