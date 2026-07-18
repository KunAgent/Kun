import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_OPERATION_RECEIPTS,
  PresentationOperationError,
  PresentationParseError,
  applyPresentationOperations,
  createImageElement,
  createPresentationProject,
  createPresentationSlide,
  createShapeElement,
  createTextElement,
  digestStableValue,
  digestUtf8Text,
  normalizePresentationProject,
  parsePresentationHtml,
  parsePresentationOperations,
  serializePresentationHtml,
  stableStringify,
  validatePresentationProject
} from './presentation.js'
import {
  PresentationCssEditError,
  applyEditableElementCss,
  editableCssPropertiesForElement,
  serializeEditableElementCss
} from './presentation-css.js'

function sampleProject() {
  const project = createPresentationProject({
    id: 'deck-1',
    title: 'Quarterly plan',
    firstSlideId: 'slide-cover'
  })
  project.slides[0].elements.push(
    createTextElement('element-title', { text: 'Quarterly plan' }),
    createShapeElement('element-accent', { x: 10, y: 40, width: 30, height: 5 })
  )
  return project
}

test('normalizer enforces schema v1 and produces canonical values', () => {
  const project = sampleProject()
  project.theme.accentColor = '#aabbcc'
  const normalized = normalizePresentationProject(project)
  assert.equal(normalized.schemaVersion, 1)
  assert.equal(normalized.revision, 1)
  assert.equal(normalized.theme.accentColor, '#AABBCC')
  assert.equal(validatePresentationProject(normalized).ok, true)
})

test('strict validation rejects unknown fields, duplicate IDs, and unsafe image paths', () => {
  const unknown = { ...sampleProject(), unexpected: true }
  assert.equal(validatePresentationProject(unknown).errors[0]?.code, 'unknown_field')

  const duplicate = sampleProject()
  duplicate.slides[0].elements[1].id = 'element-title'
  assert.equal(validatePresentationProject(duplicate).errors[0]?.code, 'duplicate_id')

  const unsafe = sampleProject()
  unsafe.slides[0].elements.push(createImageElement('image-1', '../secret.png'))
  assert.equal(validatePresentationProject(unsafe).errors[0]?.code, 'invalid_image_path')
})

test('operation reducer is deterministic, revision-independent, and reversible', () => {
  const original = normalizePresentationProject(sampleProject())
  const updatedTitle = createTextElement('element-title', {
    text: 'Revised plan',
    x: 15,
    width: 70
  })
  const result = applyPresentationOperations(original, [
    { kind: 'document.update', patch: { title: 'Revised deck', theme: { fontFamily: 'serif' } } },
    { kind: 'element.upsert', slideId: 'slide-cover', element: updatedTitle },
    { kind: 'slide.insert', slide: createPresentationSlide('slide-agenda', 'Agenda') },
    { kind: 'slide.reorder', slideId: 'slide-agenda', index: 0 }
  ])

  assert.equal(result.project.revision, original.revision)
  assert.equal(result.project.slides[0].id, 'slide-agenda')
  assert.deepEqual(result.changedIds, ['deck-1', 'slide-cover', 'element-title', 'slide-agenda'])
  assert.equal(result.inverseOperations.length, 4)

  const restored = applyPresentationOperations(result.project, result.inverseOperations).project
  assert.equal(stableStringify(restored), stableStringify(original))
  assert.equal(
    stableStringify(applyPresentationOperations(original, [
      { kind: 'document.update', patch: { title: 'Revised deck', theme: { fontFamily: 'serif' } } },
      { kind: 'element.upsert', slideId: 'slide-cover', element: updatedTitle },
      { kind: 'slide.insert', slide: createPresentationSlide('slide-agenda', 'Agenda') },
      { kind: 'slide.reorder', slideId: 'slide-agenda', index: 0 }
    ]).project),
    stableStringify(result.project)
  )
})

test('invalid operation batches fail without mutating their source', () => {
  const project = sampleProject()
  const before = stableStringify(project)
  assert.throws(
    () => applyPresentationOperations(project, [
      { kind: 'document.update', patch: { title: 'Would have changed' } },
      { kind: 'slide.delete', slideId: 'slide-cover' }
    ]),
    PresentationOperationError
  )
  assert.equal(stableStringify(project), before)
})

test('optional operation indexes are omitted instead of serialized as undefined', () => {
  const operations = parsePresentationOperations([
    { kind: 'slide.insert', slide: createPresentationSlide('slide-next', 'Next') },
    {
      kind: 'element.upsert',
      slideId: 'slide-next',
      element: createTextElement('element-next', { text: 'Next' })
    }
  ])
  assert.equal('index' in operations[0], false)
  assert.equal('index' in operations[1], false)
  assert.doesNotThrow(() => stableStringify(operations))
})

test('standalone projection safely escapes text and round-trips the embedded model', () => {
  const project = sampleProject()
  const text = project.slides[0].elements[0]
  assert.equal(text.type, 'text')
  if (text.type !== 'text') throw new Error('Expected text element')
  text.text = '</script><img src=x onerror=alert(1)> & \u2028 safe'

  const html = serializePresentationHtml(project)
  const repeated = serializePresentationHtml(project)
  assert.equal(html, repeated)
  assert.match(html, /script-src 'none'/)
  assert.match(html, /data-kun-slide-id="slide-cover"/)
  assert.match(html, /data-kun-element-id="element-title"/)
  assert.ok(!html.includes('</script><img src=x'))
  assert.ok(html.includes('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;'))
  assert.equal(stableStringify(parsePresentationHtml(html)), stableStringify(normalizePresentationProject(project)))
})

test('safe CSS declarations round-trip and map back to typed element fields', () => {
  const original = createTextElement('element-css', {
    x: 8,
    y: 12,
    width: 70,
    height: 18,
    text: 'Editable DIV'
  })
  assert.deepEqual(
    applyEditableElementCss(original, serializeEditableElementCss(original)),
    original
  )

  const edited = applyEditableElementCss(original, `
    left: 12.5%;
    top: 20%;
    width: 65%;
    opacity: 0.8;
    transform: rotate(-6deg);
    color: #aabbcc;
    font-size: 64px;
    font-family: serif;
    text-align: center;
    justify-content: flex-end;
  `)
  assert.equal(edited.type, 'text')
  if (edited.type !== 'text') throw new Error('Expected text element')
  assert.deepEqual(
    {
      x: edited.x,
      y: edited.y,
      width: edited.width,
      opacity: edited.opacity,
      rotation: edited.rotation,
      color: edited.color,
      fontSize: edited.fontSize,
      fontFamily: edited.fontFamily,
      align: edited.align,
      verticalAlign: edited.verticalAlign
    },
    {
      x: 12.5,
      y: 20,
      width: 65,
      opacity: 0.8,
      rotation: -6,
      color: '#AABBCC',
      fontSize: 64,
      fontFamily: 'serif',
      align: 'center',
      verticalAlign: 'bottom'
    }
  )
})

test('element.style uses the typed reducer and produces a reversible edit for Agent and UI calls', () => {
  const project = createPresentationProject({ id: 'deck-css', firstSlideId: 'slide-css' })
  project.slides[0].elements.push(createShapeElement('shape-css', {
    x: 10,
    width: 40,
    fillColor: '#112233'
  }))
  const normalized = normalizePresentationProject(project)
  const result = applyPresentationOperations(normalized, [{
    kind: 'element.style',
    slideId: 'slide-css',
    elementId: 'shape-css',
    css: 'left: 20%; width: 55%; background-color: #AABBCC; border-radius: 24px;'
  }])
  const styled = result.project.slides[0].elements[0]
  assert.equal(styled?.type, 'shape')
  if (styled?.type !== 'shape') throw new Error('Expected shape element')
  assert.deepEqual(
    { x: styled.x, width: styled.width, fillColor: styled.fillColor, cornerRadius: styled.cornerRadius },
    { x: 20, width: 55, fillColor: '#AABBCC', cornerRadius: 24 }
  )
  assert.deepEqual(
    applyPresentationOperations(result.project, result.inverseOperations).project,
    normalized
  )
})

test('safe CSS editor rejects selectors, injection syntax, unknown properties, and overflow', () => {
  const shape = createShapeElement('shape-css')
  assert.throws(
    () => applyEditableElementCss(shape, '.shape { background-color: #FFFFFF; }'),
    PresentationCssEditError
  )
  assert.throws(
    () => applyEditableElementCss(shape, 'background-image: url(https://example.com/x.png);'),
    /Invalid CSS declaration|Unsupported CSS property/
  )
  assert.throws(
    () => applyEditableElementCss(shape, 'left: 80%; width: 40%;'),
    /remain inside/
  )
  assert.ok(editableCssPropertiesForElement(shape).includes('border-radius'))
  assert.ok(!editableCssPropertiesForElement(shape).includes('font-family'))
})

test('HTML extraction rejects missing, duplicate, and malformed model markers', () => {
  assert.throws(() => parsePresentationHtml('<!doctype html><title>Not a deck</title>'), PresentationParseError)
  const html = serializePresentationHtml(sampleProject())
  const marker = '<script id="kun-presentation-model" type="application/json">{}</script>'
  assert.throws(() => parsePresentationHtml(`${html}${marker}`), PresentationParseError)
  assert.throws(
    () => parsePresentationHtml('<script id="kun-presentation-model" type="application/json">{bad}</script>'),
    PresentationParseError
  )
})

test('stable stringify and SHA-256 digest ignore object key insertion order', async () => {
  const left = { beta: [3, 2, 1], alpha: { y: true, x: 'value' } }
  const right = { alpha: { x: 'value', y: true }, beta: [3, 2, 1] }
  assert.equal(stableStringify(left), stableStringify(right))
  assert.equal(await digestStableValue(left), await digestStableValue(right))
  assert.match(await digestStableValue(left), /^[0-9a-f]{64}$/)
  assert.equal(
    await digestUtf8Text('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
})

test('receipt and warning bounds are enforced', () => {
  const project = createPresentationProject('deck-bounds')
  project.operationReceipts = Array.from({ length: MAX_OPERATION_RECEIPTS + 1 }, (_, index) => ({
    operationId: `operation-${index}`,
    digest: 'a'.repeat(64),
    resultingRevision: 1
  }))
  assert.equal(validatePresentationProject(project).errors[0]?.code, 'too_many_receipts')

  const warningProject = createPresentationProject('deck-warnings')
  warningProject.slides[0].elements.push(createImageElement('image-1', 'assets/photo.png'))
  const warningCodes = validatePresentationProject(warningProject).warnings.map((warning) => warning.code)
  assert.deepEqual(warningCodes, ['missing_alt_text'])
})
