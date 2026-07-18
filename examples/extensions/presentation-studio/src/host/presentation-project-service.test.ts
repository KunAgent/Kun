import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ExtensionApiError,
  type JsonObject,
  type WorkspaceApi,
  type WorkspaceFile
} from '@kun/extension-api'
import {
  MAX_PRESENTATION_HTML_BYTES,
  createPresentationProject,
  createPresentationSlide,
  createTextElement,
  parsePresentationOperations,
  stableStringify
} from '../shared/presentation.js'
import {
  PresentationProjectService,
  validatePresentationPath
} from './presentation-project-service.js'

class MemoryWorkspace implements WorkspaceApi {
  readonly files = new Map<string, WorkspaceFile>()
  writes = 0
  corruptNextWrite = false
  listOverride: JsonObject[] | undefined

  async readFile(path: string): Promise<WorkspaceFile> {
    const file = this.files.get(path)
    if (!file) throw new Error(`Unexpected read of missing file: ${path}`)
    return file
  }

  async writeFile(file: WorkspaceFile): Promise<void> {
    this.writes += 1
    this.files.set(file.path, {
      ...file,
      content: this.corruptNextWrite ? `${file.content}\n` : file.content
    })
    this.corruptNextWrite = false
  }

  async stat(path: string): Promise<JsonObject> {
    if (!this.files.has(path)) throw new Error(`Missing workspace entry: ${path}`)
    return { path, type: 'file' }
  }

  async list(): Promise<JsonObject[]> {
    return this.listOverride ?? [...this.files.values()].map(({ path, content }) => ({
      name: path,
      type: 'file',
      size: content.length
    }))
  }
}

test('presentation paths are root-level bounded .kun-ppt.html names', () => {
  assert.equal(validatePresentationPath('roadmap.kun-ppt.html'), 'roadmap.kun-ppt.html')
  for (const invalid of [
    '../roadmap.kun-ppt.html',
    'slides/roadmap.kun-ppt.html',
    '/roadmap.kun-ppt.html',
    'C:\\roadmap.kun-ppt.html',
    '.kun-ppt.html',
    'roadmap.html'
  ]) {
    assert.throws(() => validatePresentationPath(invalid), (error: unknown) =>
      error instanceof ExtensionApiError && error.code === 'INVALID_ARGUMENT')
  }
})

test('apply uses revision CAS and durable operation receipts', async () => {
  const workspace = new MemoryWorkspace()
  const service = new PresentationProjectService(workspace)
  const created = await service.create({ path: 'roadmap.kun-ppt.html', title: 'Roadmap' })
  assert.equal(created.project.revision, 1)
  assert.match(created.contentSha256, /^[0-9a-f]{64}$/)

  const operation = [{ kind: 'document.update', patch: { title: 'Roadmap 2027' } }] as const
  const applied = await service.apply({
    path: created.path,
    expectedRevision: 1,
    operationId: 'agent-op-1',
    operations: [...operation]
  })
  assert.notEqual(applied.contentSha256, created.contentSha256)
  assert.equal(applied.resultingRevision, 2)
  assert.equal(applied.project.operationReceipts.length, 1)
  assert.equal(workspace.writes, 2)

  const replay = await service.apply({
    path: created.path,
    expectedRevision: 1,
    operationId: 'agent-op-1',
    operations: [...operation]
  })
  assert.equal(replay.idempotentReplay, true)
  assert.equal(replay.resultingRevision, 2)
  assert.equal(workspace.writes, 2)

  await assert.rejects(service.apply({
    path: created.path,
    expectedRevision: 2,
    operationId: 'agent-op-1',
    operations: [{ kind: 'document.update', patch: { title: 'Different payload' } }]
  }), isConflict)
  await assert.rejects(service.apply({
    path: created.path,
    expectedRevision: 1,
    operationId: 'agent-op-2',
    operations: [{ kind: 'document.update', patch: { title: 'Stale write' } }]
  }), isConflict)
  assert.equal((await service.read(created.path)).project.title, 'Roadmap 2027')
})

test('parsed insert and upsert operations work without optional indexes', async () => {
  const workspace = new MemoryWorkspace()
  const service = new PresentationProjectService(workspace)
  await service.create({ path: 'optional-index.kun-ppt.html' })
  const inserted = await service.apply({
    path: 'optional-index.kun-ppt.html',
    expectedRevision: 1,
    operationId: 'insert-without-index',
    operations: parsePresentationOperations([
      { kind: 'slide.insert', slide: createPresentationSlide('slide-next', 'Next') }
    ])
  })
  const updated = await service.apply({
    path: 'optional-index.kun-ppt.html',
    expectedRevision: inserted.currentRevision,
    operationId: 'upsert-without-index',
    operations: parsePresentationOperations([{
      kind: 'element.upsert',
      slideId: 'slide-next',
      element: createTextElement('element-next', { text: 'Next' })
    }])
  })
  assert.equal(updated.project.slides[1]?.elements[0]?.id, 'element-next')
})

test('per-path queue serializes concurrent mutations before CAS', async () => {
  const workspace = new MemoryWorkspace()
  const service = new PresentationProjectService(workspace)
  await service.create({ path: 'queue.kun-ppt.html' })
  const results = await Promise.allSettled([
    service.apply({
      path: 'queue.kun-ppt.html',
      expectedRevision: 1,
      operationId: 'queue-a',
      operations: [{ kind: 'document.update', patch: { title: 'A' } }]
    }),
    service.apply({
      path: 'queue.kun-ppt.html',
      expectedRevision: 1,
      operationId: 'queue-b',
      operations: [{ kind: 'document.update', patch: { title: 'B' } }]
    })
  ])
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1)
  assert.equal((await service.read('queue.kun-ppt.html')).project.revision, 2)
})

test('case aliases share a lock and cannot overwrite an existing presentation', async () => {
  const workspace = new MemoryWorkspace()
  const service = new PresentationProjectService(workspace)
  await service.create({ path: 'Roadmap.kun-ppt.html' })
  await assert.rejects(
    service.create({ path: 'roadmap.kun-ppt.html' }),
    isConflict
  )
  assert.equal(workspace.writes, 1)
})

test('semantic operation failures stay classified before persistence', async () => {
  const workspace = new MemoryWorkspace()
  const service = new PresentationProjectService(workspace)
  await service.create({ path: 'semantic-failure.kun-ppt.html' })
  await assert.rejects(service.apply({
    path: 'semantic-failure.kun-ppt.html',
    expectedRevision: 1,
    operationId: 'missing-slide',
    operations: [{
      kind: 'element.upsert',
      slideId: 'missing-slide',
      element: createTextElement('element-orphan')
    }]
  }), (error: unknown) =>
    error instanceof ExtensionApiError && error.code === 'VALIDATION_FAILED')
  assert.equal(workspace.writes, 1)
})

test('write verification detects transport corruption', async () => {
  const workspace = new MemoryWorkspace()
  workspace.corruptNextWrite = true
  const service = new PresentationProjectService(workspace)
  await assert.rejects(
    service.create({ path: 'corrupt.kun-ppt.html' }),
    (error: unknown) =>
      error instanceof ExtensionApiError && error.code === 'INTERNAL_ERROR'
  )
})

test('validation reports malformed and non-canonical HTML without accepting an unsafe shell', async () => {
  const workspace = new MemoryWorkspace()
  const service = new PresentationProjectService(workspace)
  await service.create({ path: 'validate.kun-ppt.html' })
  const canonical = workspace.files.get('validate.kun-ppt.html')
  assert.ok(canonical)

  workspace.files.set('validate.kun-ppt.html', {
    ...canonical,
    content: canonical.content.replace('<body>', '<body><script>alert(1)</script>')
  })
  const unsafe = await service.validate('validate.kun-ppt.html')
  assert.equal(unsafe.valid, false)
  assert.equal(unsafe.revision, 1)
  assert.equal(unsafe.errors[0]?.code, 'non_canonical_html')
  await assert.rejects(service.read('validate.kun-ppt.html'), (error: unknown) =>
    error instanceof ExtensionApiError && error.code === 'VALIDATION_FAILED')

  workspace.files.set('validate.kun-ppt.html', {
    ...canonical,
    content: '<!doctype html><title>broken</title>'
  })
  const malformed = await service.validate('validate.kun-ppt.html')
  assert.equal(malformed.valid, false)
  assert.equal(malformed.revision, null)
  assert.ok(malformed.errors.length > 0)
})

test('oversized rendered projections fail as known validation errors before writing', async () => {
  const workspace = new MemoryWorkspace()
  const service = new PresentationProjectService(workspace)
  await service.create({ path: 'render-limit.kun-ppt.html' })
  const operations = Array.from({ length: 128 }, (_, index) => ({
    kind: 'element.upsert' as const,
    slideId: 'slide-1',
    element: createTextElement(`element-${index}`, { text: '<'.repeat(1000) })
  }))
  await assert.rejects(service.apply({
    path: 'render-limit.kun-ppt.html',
    expectedRevision: 1,
    operationId: 'render-too-large',
    operations
  }), (error: unknown) =>
    error instanceof ExtensionApiError && error.code === 'VALIDATION_FAILED')
  assert.equal(workspace.writes, 1)

  const project = createPresentationProject({
    id: 'deck-render-limit',
    firstSlideId: 'slide-1'
  })
  project.slides[0].elements = operations.map(({ element }) => element)
  const minimalHtml = `<script id="kun-presentation-model" type="application/json">${stableStringify(project)}</script>`
  assert.ok(new TextEncoder().encode(minimalHtml).byteLength < MAX_PRESENTATION_HTML_BYTES)
  workspace.files.set('render-limit.kun-ppt.html', {
    path: 'render-limit.kun-ppt.html',
    content: minimalHtml,
    encoding: 'utf8'
  })
  const validation = await service.validate('render-limit.kun-ppt.html')
  assert.equal(validation.valid, false)
  assert.equal(validation.revision, 1)
  assert.equal(validation.errors[0]?.code, 'html_too_large')
})

test('workspace entries reported as symlinks or other types fail closed', async () => {
  const workspace = new MemoryWorkspace()
  const service = new PresentationProjectService(workspace)
  await service.create({ path: 'regular.kun-ppt.html' })
  workspace.listOverride = [{ name: 'regular.kun-ppt.html', type: 'other' }]
  await assert.rejects(service.read('regular.kun-ppt.html'), (error: unknown) =>
    error instanceof ExtensionApiError && error.code === 'VALIDATION_FAILED')
})

test('copy export is non-destructive and safely replayable', async () => {
  const workspace = new MemoryWorkspace()
  const service = new PresentationProjectService(workspace)
  await service.create({ path: 'source.kun-ppt.html' })
  const exported = await service.exportCopy({
    path: 'source.kun-ppt.html',
    destinationPath: 'copy.kun-ppt.html',
    expectedRevision: 1
  })
  assert.equal(exported.idempotentReplay, false)
  assert.match(exported.contentSha256, /^[0-9a-f]{64}$/)
  const replay = await service.exportCopy({
    path: 'source.kun-ppt.html',
    destinationPath: 'copy.kun-ppt.html',
    expectedRevision: 1
  })
  assert.equal(replay.idempotentReplay, true)
  assert.equal(replay.contentSha256, exported.contentSha256)

  await service.create({ path: 'occupied.kun-ppt.html', title: 'Other' })
  await assert.rejects(service.exportCopy({
    path: 'source.kun-ppt.html',
    destinationPath: 'occupied.kun-ppt.html',
    expectedRevision: 1
  }), isConflict)
})

test('size and saturated root listings fail closed', async () => {
  const workspace = new MemoryWorkspace()
  workspace.files.set('large.kun-ppt.html', {
    path: 'large.kun-ppt.html',
    content: 'x'.repeat(MAX_PRESENTATION_HTML_BYTES + 1),
    encoding: 'utf8'
  })
  const service = new PresentationProjectService(workspace)
  await assert.rejects(service.read('large.kun-ppt.html'), (error: unknown) =>
    error instanceof ExtensionApiError && error.code === 'RESOURCE_LIMIT')

  workspace.listOverride = Array.from({ length: 10_000 }, (_, index) => ({
    name: `entry-${index}.txt`,
    type: 'file'
  }))
  await assert.rejects(service.create({ path: 'unseen.kun-ppt.html' }), isConflict)
})

function isConflict(error: unknown): boolean {
  return error instanceof ExtensionApiError && error.code === 'CONFLICT'
}
