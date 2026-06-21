import { spawn } from 'node:child_process'
import { existsSync, type Dirent } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type {
  LarkCliConfigurePayload,
  LarkCliConfigureResult,
  LarkCliInstallResult,
  LarkDocumentAuthCompletePayload,
  LarkDocumentAuthCompleteResult,
  LarkDocumentAuthStartResult,
  LarkImportedDocumentRecord,
  LarkImportedDocumentsPayload,
  LarkImportedDocumentsResult,
  LarkDocumentDetail,
  LarkDocumentImportPayload,
  LarkDocumentImportMetadata,
  LarkDocumentImportResult,
  LarkDocumentListItem,
  LarkDocumentListPayload,
  LarkDocumentListResult,
  LarkDocumentMetadataPayload,
  LarkDocumentMetadataResult,
  LarkDocumentRefreshPayload,
  LarkDocumentRefreshResult,
  LarkDocumentRemoteRecord,
  LarkDocumentStatus,
  LarkDocumentUpdateMode,
  LarkDocumentUpdatePayload,
  LarkDocumentUpdateResult
} from '../../shared/lark-document'
import {
  normalizePathSeparators,
  pathExists,
  resolveTargetPathWithinWorkspace
} from './workspace-paths'

const DEFAULT_DETAIL_LIMIT = 80_000
const DEFAULT_LARK_BIN = 'lark-cli'
const LARK_IMPORT_DIR = '飞书文档'
const LARK_CLI_PACKAGE = '@larksuite/cli@latest'
const LARK_DOCUMENT_SCOPES = 'search:docs:read docx:document:readonly docx:document:create docx:document:write_only'
const LARK_METADATA_SCAN_LIMIT = 12_000
const LARK_METADATA_SKIP_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', 'dist', 'out', 'build', '.next', 'coverage'])

type LarkCommandResult =
  | { ok: true; data: unknown }
  | { ok: false; code?: string | number; message: string }

type LarkRawCommandResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; code?: string | number; message: string; stdout?: string; stderr?: string }

type LarkDocumentDetailResult =
  | {
      ok: true
      source: 'lark'
      status: 'enabled'
      document: LarkDocumentDetail
    }
  | {
      ok: false
      source: 'lark'
      status: LarkDocumentStatus
      message: string
    }

type LarkDocumentServiceOptions = {
  larkBin?: string
  npmBin?: string
  managedRoot?: string
}

export async function installLarkCli(
  options: LarkDocumentServiceOptions = {}
): Promise<LarkCliInstallResult> {
  const installRoot = managedLarkCliRoot(options)
  const npmBin = options.npmBin ?? process.env.KUN_NPM_BIN ?? 'npm'
  try {
    await mkdir(installRoot, { recursive: true })
  } catch (error) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: `无法创建 lark-cli 安装目录：${error instanceof Error ? error.message : String(error)}`
    }
  }

  const result = await runCommand(
    npmBin,
    [
      'install',
      '--prefix',
      installRoot,
      '--no-audit',
      '--no-fund',
      LARK_CLI_PACKAGE
    ],
    { timeoutMs: 180_000 }
  )
  if (!result.ok) {
    const missingNpm = result.code === 'ENOENT' || /ENOENT|not found|未找到/i.test(result.message)
    return {
      ok: false,
      source: 'lark',
      status: missingNpm ? 'disabled' : 'error',
      message: missingNpm
        ? '无法自动安装 lark-cli：当前系统没有找到 npm。请先安装 Node.js/npm 后重试。'
        : `自动安装 lark-cli 失败：${result.message}`
    }
  }

  const cliPath = managedLarkCliBinPath(options)
  if (!existsSync(cliPath)) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: 'lark-cli 安装完成，但没有找到可执行文件。'
    }
  }

  const version = await readLarkCliVersion(cliPath)
  return {
    ok: true,
    source: 'lark',
    status: 'enabled',
    cliPath,
    version,
    message: version ? `已安装 lark-cli ${version}。` : '已安装 lark-cli。'
  }
}

export async function configureLarkCli(
  payload: LarkCliConfigurePayload,
  options: LarkDocumentServiceOptions = {}
): Promise<LarkCliConfigureResult> {
  const larkBin = resolveLarkBin(options)
  if (!commandLooksAvailable(larkBin)) {
    return {
      ok: false,
      source: 'lark',
      status: 'disabled',
      message: disabledMessage()
    }
  }

  const appId = payload.appId.trim()
  const appSecret = payload.appSecret.trim()
  if (!appId || !appSecret) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: '飞书 CLI 配置缺少 appId 或 appSecret。'
    }
  }

  const brand = payload.domain?.trim().toLowerCase() === 'lark' ? 'lark' : 'feishu'
  const result = await runCommand(
    larkBin,
    [
      'config',
      'init',
      '--app-id',
      appId,
      '--app-secret-stdin',
      '--brand',
      brand
    ],
    { timeoutMs: 45_000, input: appSecret }
  )
  if (!result.ok) {
    const status = larkErrorStatus(result.message, result.code)
    return {
      ok: false,
      source: 'lark',
      status,
      message: larkErrorMessage(result.message, status, 'config')
    }
  }

  return {
    ok: true,
    source: 'lark',
    status: 'enabled',
    message: '已完成飞书 CLI 应用配置。'
  }
}

export async function startLarkDocumentAuth(
  options: LarkDocumentServiceOptions = {}
): Promise<LarkDocumentAuthStartResult> {
  const larkBin = resolveLarkBin(options)
  if (!commandLooksAvailable(larkBin)) {
    return {
      ok: false,
      source: 'lark',
      status: 'disabled',
      message: disabledMessage()
    }
  }

  const result = await runJsonCommand(
    larkBin,
    ['auth', 'login', '--scope', LARK_DOCUMENT_SCOPES, '--no-wait', '--json'],
    { timeoutMs: 20_000 }
  )
  if (!result.ok) return larkAuthStartError(result)

  const verificationUrl = findStringDeep(result.data, [
    'verification_url',
    'verification_uri_complete',
    'verification_uri',
    'url'
  ])
  const deviceCode = findStringDeep(result.data, ['device_code', 'deviceCode'])
  if (!verificationUrl || !deviceCode) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: 'lark-cli 没有返回完整的授权链接。'
    }
  }

  return {
    ok: true,
    source: 'lark',
    status: 'auth_required',
    verificationUrl,
    deviceCode,
    userCode: findStringDeep(result.data, ['user_code', 'userCode']) || null,
    interval: numberValue(findValueDeep(result.data, ['interval'])),
    expireIn: numberValue(findValueDeep(result.data, ['expire_in', 'expires_in'])),
    message: '请在飞书中完成授权，Kun 会自动继续。'
  }
}

export async function completeLarkDocumentAuth(
  payload: LarkDocumentAuthCompletePayload,
  options: LarkDocumentServiceOptions = {}
): Promise<LarkDocumentAuthCompleteResult> {
  const larkBin = resolveLarkBin(options)
  if (!commandLooksAvailable(larkBin)) {
    return {
      ok: false,
      source: 'lark',
      status: 'disabled',
      message: disabledMessage()
    }
  }

  const deviceCode = payload.deviceCode.trim()
  if (!deviceCode) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: '缺少飞书授权 device_code。'
    }
  }

  const result = await runJsonCommand(
    larkBin,
    ['auth', 'login', '--device-code', deviceCode, '--json'],
    { timeoutMs: 300_000 }
  )
  if (!result.ok) return larkAuthCompleteError(result)

  return {
    ok: true,
    source: 'lark',
    status: 'enabled',
    message: '飞书文档授权已完成。'
  }
}

export async function listLarkDocuments(
  payload: LarkDocumentListPayload = {},
  options: LarkDocumentServiceOptions = {}
): Promise<LarkDocumentListResult> {
  const larkBin = resolveLarkBin(options)
  if (!commandLooksAvailable(larkBin)) {
    return disabledResult()
  }

  const pageSize = clampNumber(payload.pageSize ?? 20, 1, 20)
  const maxPages = clampNumber(payload.maxPages ?? 5, 1, 10)
  const editedSince = payload.editedSince?.trim() || '1y'
  const openedSince = payload.openedSince?.trim() || '90d'
  const query = payload.query?.trim() ?? ''
  const docTypes = 'docx,doc,wiki'
  const wideSearch = payload.wide === true
  const searches = wideSearch
    ? [
        { label: '最近编辑', args: ['--edited-since', editedSince] },
        { label: '最近打开', args: ['--opened-since', openedSince] },
        { label: '我负责', args: ['--mine'] }
      ]
    : [{ label: '最近编辑', args: ['--edited-since', editedSince] }]

  const documentsById = new Map<string, LarkDocumentListItem>()
  const notices: string[] = []
  for (const search of searches) {
    const result = await runLarkSearch(larkBin, {
      query,
      docTypes,
      pageSize,
      maxPages,
      extraArgs: search.args
    })
    if (result.status !== 'enabled') return result
    if (result.notice) notices.push(result.notice)
    for (const document of result.documents) {
      const existing = documentsById.get(document.id)
      if (!existing || String(document.updatedAt || '').localeCompare(String(existing.updatedAt || '')) > 0) {
        documentsById.set(document.id, {
          ...document,
          matchedBy: existing?.matchedBy ? unique([...existing.matchedBy, search.label]) : [search.label]
        })
      } else {
        existing.matchedBy = unique([...(existing.matchedBy ?? []), search.label])
      }
    }
  }

  const documents = [...documentsById.values()]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))

  return {
    ok: true,
    source: 'lark',
    status: 'enabled',
    documents,
    message: documents.length
      ? `通过 lark-cli 读取飞书文档，显示最近 ${editedSince} 编辑过的文档。${wideSearch ? '已合并最近打开和我负责的文档。' : ''}${notices.length ? 'lark-cli 有更新可用。' : ''}`
      : '已连接 lark-cli，但没有搜到可显示的 doc/docx/wiki 文档。'
  }
}

export async function listImportedLarkDocuments(
  payload: LarkImportedDocumentsPayload
): Promise<LarkImportedDocumentsResult> {
  try {
    const workspaceRoot = await resolveTargetPathWithinWorkspace('.', payload.workspaceRoot)
    const documents: LarkImportedDocumentRecord[] = []
    const stack = [workspaceRoot]
    let scanned = 0

    while (stack.length > 0 && scanned < LARK_METADATA_SCAN_LIMIT) {
      const current = stack.pop()!
      let entries: Dirent[]
      try {
        entries = await readdir(current, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        scanned += 1
        if (entry.isDirectory()) {
          if (!LARK_METADATA_SKIP_DIRS.has(entry.name)) stack.push(join(current, entry.name))
          continue
        }
        if (!entry.isFile() || !/\.lark\.json$/i.test(entry.name)) continue
        const metadataPath = join(current, entry.name)
        const metadata = await readLarkMetadataFile(metadataPath)
        if (!metadata?.document?.token && !metadata?.document?.url && !metadata?.document?.documentId) continue
        const localPath = await localPathForMetadataPath(metadataPath)
        documents.push({
          path: localPath,
          metadataPath,
          title: metadata.document.title,
          url: metadata.document.url,
          token: metadata.document.token,
          documentId: metadata.document.documentId ?? metadata.document.token ?? null,
          revisionId: metadata.document.revisionId ?? null,
          importedAt: metadata.importedAt ?? null,
          updatedAt: metadata.document.updatedAt ?? null
        })
      }
    }

    return {
      ok: true,
      source: 'lark',
      status: 'enabled',
      documents,
      message: scanned >= LARK_METADATA_SCAN_LIMIT ? '已达到本地飞书元数据扫描上限，结果可能不完整。' : undefined
    }
  } catch (error) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function importLarkDocumentToWorkspace(
  payload: LarkDocumentImportPayload,
  options: LarkDocumentServiceOptions = {}
): Promise<LarkDocumentImportResult> {
  const workspaceRoot = payload.workspaceRoot.trim()
  if (!workspaceRoot) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: '导入飞书文档前需要先选择写作空间。'
    }
  }

  const detail = await getLarkDocumentDetail(payload.document, payload.limit, options)
  if (!detail.ok) return detail

  const importDir = await resolveTargetPathWithinWorkspace(LARK_IMPORT_DIR, workspaceRoot)
  await mkdir(importDir, { recursive: true })
  const fileName = `${safeFileStem(detail.document.title || payload.document.title || 'feishu-document')}.md`
  const targetPath = await uniqueFilePath(importDir, fileName)
  const metadataPath = metadataPathForMarkdown(targetPath)
  const content = detail.document.content.trim()
    ? detail.document.content
    : `# ${detail.document.title || payload.document.title || '飞书文档'}\n\n`

  await writeFile(targetPath, content, 'utf8')
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        source: 'lark',
        importedAt: new Date().toISOString(),
        document: {
          id: detail.document.id,
          title: detail.document.title,
          url: detail.document.url,
          token: detail.document.token,
          documentId: detail.document.documentId ?? detail.document.token,
          extension: detail.document.extension,
          ownerName: detail.document.ownerName ?? null,
          updatedAt: detail.document.updatedAt ?? null,
          createdAt: detail.document.createdAt ?? null,
          openedAt: detail.document.openedAt ?? null,
          revisionId: detail.document.revisionId ?? null
        },
        sync: {
          mode: 'local-cache',
          remoteWriteBack: 'manual'
        }
      },
      null,
      2
    ),
    'utf8'
  )

  return {
    ok: true,
    source: 'lark',
    status: 'enabled',
    path: targetPath,
    metadataPath,
    title: detail.document.title,
    message: '已导入为本地 Markdown。修改会先保存到本机，不会自动回写飞书。'
  }
}

export async function getLarkDocumentImportMetadata(
  payload: LarkDocumentMetadataPayload
): Promise<LarkDocumentMetadataResult> {
  try {
    const targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    const metadataPath = metadataPathForMarkdown(targetPath)
    const metadata = await readLarkMetadataFile(metadataPath)
    return {
      ok: true,
      source: 'lark',
      status: 'enabled',
      path: targetPath,
      metadataPath,
      metadata
    }
  } catch (error) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function refreshLarkDocumentFromWorkspace(
  payload: LarkDocumentRefreshPayload,
  options: LarkDocumentServiceOptions = {}
): Promise<LarkDocumentRefreshResult> {
  let targetPath: string
  let metadataPath: string
  let metadata: LarkDocumentImportMetadata | null
  try {
    targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    metadataPath = metadataPathForMarkdown(targetPath)
    metadata = await readLarkMetadataFile(metadataPath)
  } catch (error) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }

  if (!metadata?.document?.token && !metadata?.document?.url) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: '当前文件还没有关联飞书文档，不能重新拉取。'
    }
  }

  const detail = await getLarkDocumentDetail(
    {
      id: metadata.document.id,
      source: 'lark',
      title: metadata.document.title,
      url: metadata.document.url,
      token: metadata.document.token,
      extension: metadata.document.extension,
      ownerName: metadata.document.ownerName,
      updatedAt: metadata.document.updatedAt,
      createdAt: metadata.document.createdAt,
      openedAt: metadata.document.openedAt
    },
    payload.limit,
    options
  )
  if (!detail.ok) return detail

  const content = detail.document.content.trim()
    ? detail.document.content
    : `# ${detail.document.title || metadata.document.title || '飞书文档'}\n\n`
  const refreshedAt = new Date().toISOString()
  const nextMetadata: LarkDocumentImportMetadata = {
    ...metadata,
    document: {
      ...metadata.document,
      id: detail.document.id || metadata.document.id,
      title: detail.document.title || metadata.document.title,
      url: detail.document.url || metadata.document.url,
      token: detail.document.token || metadata.document.token,
      documentId: detail.document.documentId ?? metadata.document.documentId ?? metadata.document.token,
      extension: detail.document.extension || metadata.document.extension,
      ownerName: detail.document.ownerName ?? metadata.document.ownerName ?? null,
      updatedAt: refreshedAt,
      createdAt: detail.document.createdAt ?? metadata.document.createdAt ?? null,
      openedAt: detail.document.openedAt ?? metadata.document.openedAt ?? null,
      revisionId: detail.document.revisionId ?? metadata.document.revisionId ?? null
    },
    sync: {
      ...metadata.sync,
      mode: 'local-cache',
      remoteWriteBack: 'manual'
    }
  }

  await writeFile(targetPath, content, 'utf8')
  await writeFile(metadataPath, JSON.stringify(nextMetadata, null, 2), 'utf8')

  return {
    ok: true,
    source: 'lark',
    status: 'enabled',
    path: targetPath,
    metadataPath,
    title: nextMetadata.document.title,
    content,
    revisionId: nextMetadata.document.revisionId ?? null,
    message: '已从飞书重新拉取并覆盖本地文件。'
  }
}

export async function updateLarkDocumentFromWorkspace(
  payload: LarkDocumentUpdatePayload,
  options: LarkDocumentServiceOptions = {}
): Promise<LarkDocumentUpdateResult> {
  const larkBin = resolveLarkBin(options)
  if (!commandLooksAvailable(larkBin)) {
    return {
      ok: false,
      source: 'lark',
      status: 'disabled',
      message: disabledMessage()
    }
  }

  let targetPath: string
  let metadataPath: string
  let metadata: LarkDocumentImportMetadata | null
  try {
    targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    metadataPath = metadataPathForMarkdown(targetPath)
    metadata = await readLarkMetadataFile(metadataPath)
  } catch (error) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
  const mode = normalizeLarkDocumentUpdateMode(payload.mode ?? (metadata ? 'overwrite' : 'create'))
  if (mode === 'create') {
    return createLarkDocumentFromWorkspace({
      larkBin,
      payload,
      metadata,
      metadataPath
    })
  }

  return overwriteLarkDocumentFromWorkspace({
    larkBin,
    payload,
    metadata,
    metadataPath
  })
}

async function overwriteLarkDocumentFromWorkspace({
  larkBin,
  payload,
  metadata,
  metadataPath
}: {
  larkBin: string
  payload: LarkDocumentUpdatePayload
  metadata: LarkDocumentImportMetadata | null
  metadataPath: string
}): Promise<LarkDocumentUpdateResult> {
  if (!metadata) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: '当前文件还没有关联飞书文档，请先选择新增文档。'
    }
  }
  const docRef = metadata.document.url || metadata.document.token
  if (!docRef) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: '当前文件还没有关联飞书文档，请先选择新增文档。'
    }
  }

  const result = await runJsonCommand(
    larkBin,
    [
      'docs',
      '+update',
      '--api-version',
      'v2',
      '--as',
      'user',
      '--doc',
      docRef,
      '--command',
      'overwrite',
      '--doc-format',
      'markdown',
      '--content',
      '-',
      '--format',
      'json'
    ],
    { timeoutMs: 45_000, input: payload.content }
  )
  if (!result.ok) return larkUpdateError(result)
  if (isLarkApiError(result.data)) {
    return larkUpdateError({
      ok: false,
      code: result.data.error?.code,
      message: result.data.error?.message || JSON.stringify(result.data.error ?? result.data)
    })
  }

  const response = recordValue(dataPayload(result.data))
  const updatedDocument = recordValue(response?.document)
  const revisionId = stringOrNumberValue(updatedDocument?.revision_id)
  const remoteDocument = buildRemoteRecord({
    metadata,
    fallbackTitle: metadata.document.title,
    responseDocument: {
      ...metadata.document,
      revision_id: revisionId ?? metadata.document.revisionId
    }
  })
  const nextMetadata: LarkDocumentImportMetadata = {
    ...metadata,
    document: {
      ...metadata.document,
      revisionId: revisionId ?? metadata.document.revisionId ?? null
    },
    sync: {
      ...metadata.sync,
      mode: 'local-cache',
      remoteWriteBack: 'manual',
      lastPushedMode: 'overwrite',
      lastPushedAt: new Date().toISOString(),
      lastPushedRevisionId: revisionId ?? metadata.sync?.lastPushedRevisionId ?? null
    }
  }
  await writeFile(metadataPath, JSON.stringify(nextMetadata, null, 2), 'utf8')

  return {
    ok: true,
    source: 'lark',
    status: 'enabled',
    mode: 'overwrite',
    message: '已覆盖更新飞书文档。',
    revisionId,
    document: remoteDocument
  }
}

async function createLarkDocumentFromWorkspace({
  larkBin,
  payload,
  metadata,
  metadataPath
}: {
  larkBin: string
  payload: LarkDocumentUpdatePayload
  metadata: LarkDocumentImportMetadata | null
  metadataPath: string
}): Promise<LarkDocumentUpdateResult> {
  const result = await runJsonCommand(
    larkBin,
    [
      'docs',
      '+create',
      '--api-version',
      'v2',
      '--as',
      'user',
      '--doc-format',
      'markdown',
      '--content',
      '-',
      '--format',
      'json'
    ],
    { timeoutMs: 45_000, input: payload.content }
  )
  if (!result.ok) return larkCreateError(result)
  if (isLarkApiError(result.data)) {
    return larkCreateError({
      ok: false,
      code: result.data.error?.code,
      message: result.data.error?.message || JSON.stringify(result.data.error ?? result.data)
    })
  }

  const response = recordValue(dataPayload(result.data))
  const createdDocument = recordValue(response?.document) ?? response
  const revisionId = stringOrNumberValue(createdDocument?.revision_id)
  const createdAt = new Date().toISOString()
  const remoteDocument = buildRemoteRecord({
    metadata,
    fallbackTitle: payload.title?.trim() || metadata?.document?.title || '飞书文档',
    responseDocument: {
      ...createdDocument,
      revision_id: revisionId,
      created_at: createdAt
    }
  })
  const baseMetadata = metadata ?? metadataFromRemoteDocument(remoteDocument, createdAt)
  const nextMetadata: LarkDocumentImportMetadata = {
    ...baseMetadata,
    sync: {
      ...baseMetadata.sync,
      mode: 'local-cache',
      remoteWriteBack: 'manual',
      lastPushedMode: 'create',
      lastPushedAt: createdAt,
      lastPushedRevisionId: revisionId ?? baseMetadata.sync?.lastPushedRevisionId ?? null,
      lastCreatedDocument: remoteDocument
    }
  }
  await writeFile(metadataPath, JSON.stringify(nextMetadata, null, 2), 'utf8')

  return {
    ok: true,
    source: 'lark',
    status: 'enabled',
    mode: 'create',
    message: '已新建飞书文档。',
    revisionId,
    document: remoteDocument
  }
}

async function getLarkDocumentDetail(
  document: LarkDocumentListItem,
  limit: number | undefined,
  options: LarkDocumentServiceOptions
): Promise<LarkDocumentDetailResult> {
  const larkBin = resolveLarkBin(options)
  if (!commandLooksAvailable(larkBin)) {
    return {
      ok: false,
      source: 'lark',
      status: 'disabled',
      message: disabledMessage()
    }
  }

  const docRef = document.url || document.token || String(document.id || '').replace(/^lark:/, '')
  if (!docRef) {
    return {
      ok: false,
      source: 'lark',
      status: 'error',
      message: '缺少飞书文档 URL 或 token，无法读取正文。'
    }
  }

  const result = await runJsonCommand(
    larkBin,
    [
      'docs',
      '+fetch',
      '--api-version',
      'v2',
      '--as',
      'user',
      '--doc',
      docRef,
      '--doc-format',
      'markdown',
      '--detail',
      'simple',
      '--format',
      'json'
    ],
    { timeoutMs: 45_000 }
  )
  if (!result.ok) return larkDetailError(result)
  if (isLarkApiError(result.data)) {
    return larkDetailError({
      ok: false,
      code: result.data.error?.code,
      message: result.data.error?.message || JSON.stringify(result.data.error ?? result.data)
    })
  }

  const payload = dataPayload(result.data)
  const fetchedDocument = recordValue(payload)?.document ?? payload
  const fetched = recordValue(fetchedDocument)
  const content = String(fetched?.content ?? '')
  const maxChars = clampNumber(limit ?? DEFAULT_DETAIL_LIMIT, 1_000, 400_000)
  const title = document.title || stringValue(fetched?.title) || document.token || '飞书文档'
  const documentId = stringValue(fetched?.document_id) || document.token || tokenFromLarkUrl(document.url)
  return {
    ok: true,
    source: 'lark',
    status: 'enabled',
    document: {
      id: document.id || `lark:${docRef}`,
      source: 'lark',
      title,
      url: document.url || '',
      token: document.token || documentId || '',
      extension: document.extension || 'docx',
      ownerName: document.ownerName ?? null,
      updatedAt: document.updatedAt ?? null,
      createdAt: document.createdAt ?? null,
      openedAt: document.openedAt ?? null,
      content: content.slice(0, maxChars),
      contentFormat: 'markdown',
      truncated: content.length > maxChars,
      documentId: documentId || null,
      revisionId: stringOrNumberValue(fetched?.revision_id)
    }
  }
}

async function runLarkSearch(
  larkBin: string,
  options: {
    query: string
    docTypes: string
    pageSize: number
    maxPages: number
    extraArgs: string[]
  }
): Promise<LarkDocumentListResult & { notice?: string }> {
  const documents: LarkDocumentListItem[] = []
  let pageToken: string | null = null
  let updateNotice: string | null = null
  for (let page = 0; page < options.maxPages; page += 1) {
    const args = [
      'drive',
      '+search',
      '--as',
      'user',
      '--query',
      options.query,
      '--doc-types',
      options.docTypes,
      '--sort',
      'edit_time',
      '--page-size',
      String(options.pageSize),
      '--format',
      'json',
      ...options.extraArgs
    ]
    if (pageToken) args.push('--page-token', pageToken)
    const result = await runJsonCommand(larkBin, args, { timeoutMs: 30_000 })
    if (!result.ok) return larkSearchError(result)
    if (isLarkApiError(result.data)) {
      return larkSearchError({
        ok: false,
        code: result.data.error?.code,
        message: result.data.error?.message || JSON.stringify(result.data.error ?? result.data)
      })
    }
    const updateNoticePayload = recordValue(recordValue(result.data)?._notice)?.update
    updateNotice ??= stringValue(recordValue(updateNoticePayload)?.message ?? updateNoticePayload).trim() || null
    const payload = recordValue(dataPayload(result.data))
    const results = Array.isArray(payload?.results) ? payload.results : []
    for (const item of results) {
      const mapped = mapLarkSearchResult(item)
      if (mapped) documents.push(mapped)
    }
    if (payload?.has_more !== true || !payload?.page_token) break
    pageToken = String(payload.page_token)
  }

  return {
    ok: true,
    source: 'lark',
    status: 'enabled',
    documents,
    ...(updateNotice ? { notice: updateNotice } : {})
  }
}

function mapLarkSearchResult(item: unknown): LarkDocumentListItem | null {
  const raw = recordValue(item)
  if (!raw) return null
  const meta = recordValue(raw.result_meta) ?? {}
  const url = stringValue(meta.url)
  const token = stringValue(meta.token)
  const type = normalizeLarkDocType(meta.doc_types ?? raw.entity_type)
  const title = stripHighlight(stringValue(raw.title_highlighted) || stringValue(meta.title) || token || url || '未命名飞书文档')
  const updatedAt = stringValue(meta.update_time_iso) ||
    stringValue(meta.edit_time_iso) ||
    stringValue(meta.last_open_time_iso) ||
    stringValue(meta.create_time_iso) ||
    null
  const id = `lark:${url || token || title}`
  return {
    id,
    source: 'lark',
    title,
    url,
    token,
    extension: type,
    larkType: stringValue(raw.entity_type) || null,
    ownerName: stringValue(meta.owner_name) || null,
    updatedAt,
    createdAt: stringValue(meta.create_time_iso) || null,
    openedAt: stringValue(meta.last_open_time_iso) || null
  }
}

function runJsonCommand(
  command: string,
  args: string[],
  options: { timeoutMs: number; input?: string }
): Promise<LarkCommandResult> {
  return runCommand(command, args, options).then((result) => {
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: result.message
      }
    }
    try {
      return { ok: true, data: parseJsonOutput(result.stdout) }
    } catch (error) {
      return {
        ok: false,
        code: 'INVALID_JSON',
        message: `lark-cli 返回了非 JSON 输出：${error instanceof Error ? error.message : String(error)}`
      }
    }
  })
}

function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs: number; input?: string }
): Promise<LarkRawCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (result: LarkRawCommandResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({
        ok: false,
        code: 'TIMEOUT',
        message: `lark-cli 执行超时：${options.timeoutMs}ms`
      })
    }, options.timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.stdin.on('error', () => {
      // The process may exit before stdin is fully written on command failure.
    })
    child.stdin.end(options.input ?? '')
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        ok: false,
        code: error.code ?? 'SPAWN_ERROR',
        message: error.message
      })
    })
    child.on('exit', (code) => {
      if (code !== 0) {
        finish({
          ok: false,
          code: code ?? 'EXIT_ERROR',
          message: stderr.trim() || stdout.trim() || `lark-cli exited with code ${code}`,
          stdout,
          stderr
        })
        return
      }
      finish({ ok: true, stdout, stderr })
    })
  })
}

function larkSearchError(result: Extract<LarkCommandResult, { ok: false }>): LarkDocumentListResult {
  const message = result.message || 'lark-cli 飞书文档搜索失败。'
  const status = larkErrorStatus(message, result.code)
  return {
    ok: true,
    source: 'lark',
    status,
    documents: [],
    message: larkErrorMessage(message, status, 'search')
  }
}

function larkDetailError(result: Extract<LarkCommandResult, { ok: false }>): LarkDocumentDetailResult {
  const message = result.message || 'lark-cli 飞书文档读取失败。'
  const status = larkErrorStatus(message, result.code)
  return {
    ok: false,
    source: 'lark',
    status,
    message: larkErrorMessage(message, status, 'fetch')
  }
}

function larkUpdateError(result: Extract<LarkCommandResult, { ok: false }>): LarkDocumentUpdateResult {
  const message = result.message || 'lark-cli 飞书文档更新失败。'
  const status = larkErrorStatus(message, result.code)
  return {
    ok: false,
    source: 'lark',
    status,
    message: larkErrorMessage(message, status, 'update')
  }
}

function larkCreateError(result: Extract<LarkCommandResult, { ok: false }>): LarkDocumentUpdateResult {
  const message = result.message || 'lark-cli 飞书文档创建失败。'
  const status = larkErrorStatus(message, result.code)
  return {
    ok: false,
    source: 'lark',
    status,
    message: larkErrorMessage(message, status, 'create')
  }
}

function larkAuthStartError(
  result: Extract<LarkCommandResult, { ok: false }>
): Extract<LarkDocumentAuthStartResult, { ok: false }> {
  const message = result.message || 'lark-cli 飞书授权失败。'
  const status = larkErrorStatus(message, result.code)
  return {
    ok: false,
    source: 'lark',
    status,
    message: larkErrorMessage(message, status, 'auth-start')
  }
}

function larkAuthCompleteError(
  result: Extract<LarkCommandResult, { ok: false }>
): Extract<LarkDocumentAuthCompleteResult, { ok: false }> {
  const message = result.message || 'lark-cli 飞书授权失败。'
  const status = larkErrorStatus(message, result.code)
  return {
    ok: false,
    source: 'lark',
    status,
    message: larkErrorMessage(message, status, 'auth-complete')
  }
}

function larkErrorStatus(message: string, code: unknown): LarkDocumentStatus {
  if (code === 'ENOENT' || /ENOENT|not found|未找到/i.test(message)) return 'disabled'
  if (/not_configured|not configured|config init|未配置/i.test(message)) return 'config_required'
  if (/auth|login|unauthorized|token|scope|permission|forbidden/i.test(message)) return 'auth_required'
  if (/too many request|rate limit|429|9499/i.test(message) || String(code) === '9499') return 'rate_limited'
  return 'error'
}

function larkErrorMessage(
  message: string,
  status: LarkDocumentStatus,
  phase: 'search' | 'fetch' | 'update' | 'create' | 'config' | 'auth-start' | 'auth-complete'
): string {
  if (status === 'disabled') return disabledMessage()
  if (status === 'config_required') return 'lark-cli 尚未配置飞书应用。请在 Kun 内扫码完成飞书 CLI 配置。'
  if (status === 'auth_required') {
    if (phase === 'auth-start' || phase === 'auth-complete') return `${message}。请重新发起飞书文档授权。`
    if (phase === 'search') return `${message}。请运行 lark-cli auth login --scope "search:docs:read" 完成用户授权。`
    if (phase === 'update') return `${message}。请按 lark-cli 提示补充 docs +update 所需权限。`
    if (phase === 'create') return `${message}。请按 lark-cli 提示补充 docs +create 所需权限。`
    if (phase === 'config') return `${message}。请重新扫码配置飞书 CLI。`
    return `${message}。请按 lark-cli 提示补充 docs +fetch 所需权限，常见方式是 lark-cli auth login --scope "docx:document:readonly"。`
  }
  if (status === 'rate_limited') return '飞书接口暂时限流，请稍等几十秒后重试。'
  return message
}

function disabledResult(): LarkDocumentListResult {
  return {
    ok: true,
    source: 'lark',
    status: 'disabled',
    documents: [],
    message: disabledMessage()
  }
}

function disabledMessage(): string {
  return '未找到 lark-cli。请在 Kun 内自动安装，或设置 KUN_LARK_CLI 指向可执行文件。'
}

function commandLooksAvailable(command: string): boolean {
  if (!command) return false
  if (command.includes('/') || command.startsWith('.')) return existsSync(command)
  return true
}

function managedLarkCliRoot(options: LarkDocumentServiceOptions = {}): string {
  return options.managedRoot ?? join(homedir(), '.kun', 'tools', 'lark-cli')
}

function managedLarkCliBinPath(options: LarkDocumentServiceOptions = {}): string {
  const executable = process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli'
  return join(managedLarkCliRoot(options), 'node_modules', '.bin', executable)
}

function resolveLarkBin(options: LarkDocumentServiceOptions = {}): string {
  const explicit = options.larkBin ?? process.env.KUN_LARK_CLI ?? process.env.DTW_LARK_CLI
  if (explicit?.trim()) return explicit.trim()
  const managed = managedLarkCliBinPath(options)
  if (existsSync(managed)) return managed
  return DEFAULT_LARK_BIN
}

async function readLarkCliVersion(larkBin: string): Promise<string | null> {
  const result = await runCommand(larkBin, ['--version'], { timeoutMs: 10_000 })
  if (!result.ok) return null
  const text = result.stdout.trim() || result.stderr.trim()
  return text || null
}

function parseJsonOutput(output = ''): unknown {
  const text = String(output).trim()
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) throw new Error('missing JSON object')
    return JSON.parse(text.slice(start, end + 1))
  }
}

function isLarkApiError(value: unknown): value is { ok: false; error?: { code?: string | number; message?: string } } {
  return recordValue(value)?.ok === false
}

function dataPayload(value: unknown): unknown {
  return recordValue(value)?.data ?? value
}

function findValueDeep(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 5) return undefined
  const raw = recordValue(value)
  if (!raw) return undefined
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) return raw[key]
  }
  for (const item of Object.values(raw)) {
    const found = findValueDeep(item, keys, depth + 1)
    if (found !== undefined && found !== null && found !== '') return found
  }
  return undefined
}

function findStringDeep(value: unknown, keys: string[]): string {
  return stringValue(findValueDeep(value, keys)).trim()
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function numberValue(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function stringOrNumberValue(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function normalizeLarkDocumentUpdateMode(value: unknown): LarkDocumentUpdateMode {
  return value === 'create' ? 'create' : 'overwrite'
}

function normalizeLarkDocType(value: unknown): string {
  return String(value || 'doc').toLowerCase()
}

function stripHighlight(value = ''): string {
  return String(value).replace(/<\/?h>|<\/?hb>/g, '').trim()
}

function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return max
  return Math.max(min, Math.min(max, Math.trunc(number)))
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function safeFileStem(raw: string): string {
  const strippedExtension = basename(raw.trim().replace(/\0/g, ''), extname(raw))
  const safe = strippedExtension
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!safe || safe === '.' || safe === '..') return 'feishu-document'
  return safe.slice(0, 80)
}

async function uniqueFilePath(directory: string, fileName: string): Promise<string> {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  let index = 0
  while (index < 10_000) {
    const suffix = index === 0 ? '' : `-${index + 1}`
    const candidate = join(directory, `${stem}${suffix}${ext}`)
    if (!await pathExists(candidate)) return candidate
    index += 1
  }
  throw new Error('Unable to choose an import file name.')
}

function metadataPathForMarkdown(markdownPath: string): string {
  const normalized = normalizePathSeparators(markdownPath)
  if (/\.md$/i.test(normalized)) return normalized.replace(/\.md$/i, '.lark.json')
  return `${normalized}.lark.json`
}

async function localPathForMetadataPath(metadataPath: string): Promise<string> {
  const basePath = metadataPath.replace(/\.lark\.json$/i, '')
  const markdownPath = `${basePath}.md`
  if (await pathExists(markdownPath)) return markdownPath
  return basePath
}

function tokenFromLarkUrl(url: string): string {
  const match = url.match(/\/(?:docx|doc|wiki)\/([^/?#]+)/)
  return match?.[1] ?? ''
}

function buildRemoteRecord({
  metadata,
  fallbackTitle,
  responseDocument
}: {
  metadata: LarkDocumentImportMetadata | null
  fallbackTitle: string
  responseDocument: Record<string, unknown> | null
}): LarkDocumentRemoteRecord {
  const existingDocument = metadata?.document
  const url = stringValue(responseDocument?.url) || existingDocument?.url || ''
  const documentId = stringValue(responseDocument?.document_id) || existingDocument?.documentId || existingDocument?.token || tokenFromLarkUrl(url)
  const token = documentId || tokenFromLarkUrl(url) || existingDocument?.token || ''
  const title = stringValue(responseDocument?.title) || fallbackTitle || existingDocument?.title || '飞书文档'
  const revisionId = stringOrNumberValue(responseDocument?.revision_id) ?? existingDocument?.revisionId ?? null
  return {
    id: documentId ? `lark:${documentId}` : (url ? `lark:${url}` : existingDocument?.id || 'lark:document'),
    title,
    url,
    token,
    documentId: documentId || null,
    extension: existingDocument?.extension || 'docx',
    revisionId,
    createdAt: stringValue(responseDocument?.created_at) || null
  }
}

function metadataFromRemoteDocument(
  document: LarkDocumentRemoteRecord,
  createdAt: string
): LarkDocumentImportMetadata {
  return {
    source: 'lark',
    document: {
      id: document.id,
      title: document.title,
      url: document.url,
      token: document.token,
      documentId: document.documentId ?? document.token ?? null,
      extension: document.extension || 'docx',
      ownerName: null,
      updatedAt: null,
      createdAt,
      openedAt: null,
      revisionId: document.revisionId ?? null
    },
    sync: {
      mode: 'local-cache',
      remoteWriteBack: 'manual',
      lastPushedAt: createdAt,
      lastPushedMode: 'create',
      lastPushedRevisionId: document.revisionId ?? null,
      lastCreatedDocument: document
    }
  }
}

async function readLarkMetadataFile(metadataPath: string): Promise<LarkDocumentImportMetadata | null> {
  try {
    const raw = await readFile(metadataPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<LarkDocumentImportMetadata>
    const document = recordValue(parsed.document)
    if (parsed?.source !== 'lark' || !document) return null
    return {
      source: 'lark',
      importedAt: stringValue(parsed.importedAt) || undefined,
      document: {
        id: stringValue(document?.id),
        title: stringValue(document?.title) || '飞书文档',
        url: stringValue(document?.url),
        token: stringValue(document?.token),
        documentId: stringValue(document?.documentId) || stringValue(document?.token) || null,
        extension: stringValue(document?.extension) || 'docx',
        ownerName: stringValue(document?.ownerName) || null,
        updatedAt: stringValue(document?.updatedAt) || null,
        createdAt: stringValue(document?.createdAt) || null,
        openedAt: stringValue(document?.openedAt) || null,
        revisionId: stringOrNumberValue(document?.revisionId)
      },
      sync: normalizeLarkSyncMetadata(parsed.sync)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function normalizeLarkSyncMetadata(value: unknown): LarkDocumentImportMetadata['sync'] {
  const raw = recordValue(value)
  if (!raw) return undefined
  return {
    mode: raw.mode === 'local-cache' ? 'local-cache' : undefined,
    remoteWriteBack: raw.remoteWriteBack === 'manual' ? 'manual' : undefined,
    lastPushedAt: stringValue(raw.lastPushedAt) || null,
    lastPushedMode: normalizeNullableLarkDocumentUpdateMode(raw.lastPushedMode),
    lastPushedRevisionId: stringOrNumberValue(raw.lastPushedRevisionId),
    lastCreatedDocument: normalizeRemoteRecord(raw.lastCreatedDocument)
  }
}

function normalizeNullableLarkDocumentUpdateMode(value: unknown): LarkDocumentUpdateMode | null {
  if (value === 'overwrite' || value === 'create') return value
  return null
}

function normalizeRemoteRecord(value: unknown): LarkDocumentRemoteRecord | null {
  const raw = recordValue(value)
  if (!raw) return null
  return {
    id: stringValue(raw.id),
    title: stringValue(raw.title) || '飞书文档',
    url: stringValue(raw.url),
    token: stringValue(raw.token),
    documentId: stringValue(raw.documentId) || null,
    extension: stringValue(raw.extension) || 'docx',
    revisionId: stringOrNumberValue(raw.revisionId),
    createdAt: stringValue(raw.createdAt) || null
  }
}

export async function readLarkImportMetadata(path: string): Promise<{ exists: boolean; size?: number }> {
  try {
    const info = await stat(metadataPathForMarkdown(path))
    return { exists: true, size: info.size }
  } catch {
    return { exists: false }
  }
}
