import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  presentationCommandContributions,
  presentationSidebarViewContribution,
  presentationToolDeclarations
} from './tool-contracts.js'
import { operationsFrom } from './extension.js'

test('runtime declarations exactly match the Manifest', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../../../kun-extension.json', import.meta.url), 'utf8')
  ) as {
    main: string
    permissions: string[]
    activationEvents: string[]
    contributes: {
      commands: unknown[]
      'views.rightSidebar': unknown[]
      tools: unknown[]
    }
  }
  assert.deepEqual(manifest.contributes.commands, presentationCommandContributions)
  assert.deepEqual(
    manifest.contributes['views.rightSidebar'],
    [presentationSidebarViewContribution]
  )
  assert.deepEqual(manifest.contributes.tools, presentationToolDeclarations)
  assert.equal(manifest.main, 'dist/host/extension.js')
  assert.ok(manifest.activationEvents.includes('onView:studio'))
  assert.ok(manifest.activationEvents.every((event) => !event.startsWith('onAgentProfile:')))
  assert.ok(!('agentProfiles' in manifest.contributes))
  assert.deepEqual(manifest.permissions, [
    'commands.register',
    'ui.views',
    'webview',
    'tools.register',
    'workspace.read',
    'workspace.write'
  ])
})

test('the Webview is a sidebar workspace controlled by the main Agent tools', async () => {
  const [markup, styles, controller] = await Promise.all([
    readFile(new URL('../../../src/webview/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/webview/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/webview/main.ts', import.meta.url), 'utf8')
  ])
  assert.equal(markup.match(/data-studio-tab=/gu)?.length, 3)
  assert.doesNotMatch(markup, /agent-(?:form|panel|prompt|events)/u)
  assert.match(styles, /data-active-panel="slides"/u)
  assert.match(styles, /data-active-panel="canvas"/u)
  assert.match(styles, /data-active-panel="properties"/u)
  assert.match(styles, /grid-template-columns:\s*clamp\(104px, 22%, 148px\) minmax\(0, 1fr\)/u)
  assert.match(styles, /\.workspace-grid\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\)/u)
  assert.doesNotMatch(styles, /@media \(max-width: 900px\)[\s\S]*?grid-template-rows:\s*auto minmax\(620px, 1fr\) auto/u)
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*?\.slide-rail\s*\{[\s\S]*?display:\s*none/u)
  assert.match(markup, /id="deck-menu"/u)
  assert.match(markup, /class="brand-mark"[\s\S]*?<svg/u)
  assert.match(markup, /id="canvas-viewport"[\s\S]*?class="canvas-toolbar"/u)
  assert.match(markup, /id="edit-selected-text"/u)
  assert.match(markup, /id="delete-selected-element"/u)
  assert.doesNotMatch(styles, /\.canvas-background\s*\{[^}]*\bfill\s*:/u)
  assert.equal(markup.match(/class="canvas-background"[^>]*fill="#ffffff"/gu)?.length, 2)
  assert.doesNotMatch(controller, /node\.hidden = name !== panel/u)
  assert.match(controller, /ui\.slidesPanel\.hidden = false/u)
  assert.match(controller, /function setActivePanel\([\s\S]*?ui\.deckMenu\.open = false/u)
  assert.match(controller, /INLINE_EDIT_DOUBLE_CLICK_MS/u)
  assert.match(controller, /contentEditable = 'plaintext-only'/u)
  assert.match(controller, /focusInlineEditorAtEnd/u)
  assert.doesNotMatch(markup, /inline-text-editor/u)
  assert.match(styles, /\.canvas-text-content\s*\{[\s\S]*?background:\s*transparent/u)
  assert.doesNotMatch(styles, /\.canvas-text-frame\.is-editing[\s\S]*?background:\s*#fff(?:fff)?/iu)
  assert.match(controller, /focusCanvasElement\(element\.id\)/u)
  assert.match(controller, /focusedElementId === selected\?\.id[\s\S]*?focusCanvasElement\(focusedElementId\)/u)
  assert.match(controller, /ui\.deleteSelectedElement\.addEventListener\('click', deleteSelectedElement\)/u)
  assert.match(controller, /function layerSection\(/u)
  assert.match(controller, /kind: 'element\.style'/u)
  assert.match(styles, /\.css-declarations\s*\{/u)
  assert.doesNotMatch(controller, /client\.agent/u)
})

test('all tool schemas are strict, bounded, and side-effect classified', () => {
  assert.deepEqual(
    presentationToolDeclarations.map(({ id }) => id),
    [
      'presentation-create',
      'presentation-read',
      'presentation-apply',
      'presentation-validate',
      'presentation-export-copy'
    ]
  )
  for (const declaration of presentationToolDeclarations) {
    assert.equal(declaration.inputSchema.additionalProperties, false)
    assert.ok(declaration.maxOutputBytes >= 1024 && declaration.maxOutputBytes <= 1024 * 1024)
    assert.notEqual(declaration.sideEffects, 'none')
  }
})

test('every contributed command and tool schema passes the runtime compiler', async () => {
  const validatorUrl = new URL(
    '../../../../../../kun/dist/extensions/json-schema-validator.js',
    import.meta.url
  )
  const runtime = await import(validatorUrl.href) as {
    compileExtensionJsonSchema(
      schema: Record<string, unknown>,
      subject: string
    ): { assert(value: unknown, subject: string): void }
  }
  for (const command of presentationCommandContributions) {
    assert.doesNotThrow(() => runtime.compileExtensionJsonSchema(
      command.inputSchema as Record<string, unknown>,
      `commands.${command.id}.inputSchema`
    ))
  }
  for (const tool of presentationToolDeclarations) {
    assert.doesNotThrow(() => runtime.compileExtensionJsonSchema(
      tool.inputSchema as Record<string, unknown>,
      `tools.${tool.id}.inputSchema`
    ))
    assert.doesNotThrow(() => runtime.compileExtensionJsonSchema(
      tool.outputSchema as Record<string, unknown>,
      `tools.${tool.id}.outputSchema`
    ))
  }
})

test('deep operation parsing reports a public validation failure', () => {
  assert.throws(() => operationsFrom({
    operations: [{
      kind: 'element.upsert',
      slideId: 'slide-1',
      element: {
        id: 'image-1',
        type: 'image',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
        opacity: 1,
        src: '../secret.PNG',
        alt: 'unsafe',
        fit: 'cover'
      }
    }]
  }), (error: unknown) =>
    error instanceof Error &&
    'code' in error && error.code === 'VALIDATION_FAILED')
})

test('main Agent apply calls may omit operationId and slide background defaults', async () => {
  const declaration = presentationToolDeclarations.find(({ id }) => id === 'presentation-apply')
  assert.ok(declaration)
  const validatorUrl = new URL(
    '../../../../../../kun/dist/extensions/json-schema-validator.js',
    import.meta.url
  )
  const runtime = await import(validatorUrl.href) as {
    compileExtensionJsonSchema(
      schema: Record<string, unknown>,
      subject: string
    ): { assert(value: unknown, subject: string): void }
  }
  const input = {
    path: 'learning-theme.kun-ppt.html',
    expectedRevision: 1,
    operations: [{
      kind: 'slide.insert',
      slide: {
        id: 'slide-2',
        title: 'Learning plan',
        elements: [{
          id: 'title-2',
          type: 'text',
          x: 8,
          y: 8,
          width: 84,
          height: 12,
          rotation: 0,
          opacity: 1,
          text: 'Learn deliberately',
          fontSize: 36,
          fontWeight: 700,
          fontFamily: 'sans',
          color: '#F9FAFB',
          align: 'left',
          verticalAlign: 'top'
        }]
      }
    }]
  }
  const validator = runtime.compileExtensionJsonSchema(
    declaration.inputSchema as Record<string, unknown>,
    'tools.presentation-apply.inputSchema'
  )
  assert.doesNotThrow(() => validator.assert(input, 'presentation-apply arguments'))
  const operations = operationsFrom(input)
  assert.equal(operations[0]?.kind, 'slide.insert')
  if (operations[0]?.kind !== 'slide.insert') assert.fail('expected slide.insert')
  assert.equal(operations[0].slide.backgroundColor, null)
  const element = operations[0].slide.elements[0]
  assert.equal(element?.type, 'text')
  if (element?.type !== 'text') assert.fail('expected text element')
  assert.equal(element.fontFamily, 'sans')
})

test('main Agent may apply bounded safe CSS to one presentation element', async () => {
  const declaration = presentationToolDeclarations.find(({ id }) => id === 'presentation-apply')
  assert.ok(declaration)
  const validatorUrl = new URL(
    '../../../../../../kun/dist/extensions/json-schema-validator.js',
    import.meta.url
  )
  const runtime = await import(validatorUrl.href) as {
    compileExtensionJsonSchema(
      schema: Record<string, unknown>,
      subject: string
    ): { assert(value: unknown, subject: string): void }
  }
  const input = {
    path: 'learning-theme.kun-ppt.html',
    expectedRevision: 3,
    operations: [{
      kind: 'element.style',
      slideId: 'slide-1',
      elementId: 'title-1',
      css: 'left: 8%; width: 84%; color: #FFFFFF; font-size: 56px;'
    }]
  }
  const validator = runtime.compileExtensionJsonSchema(
    declaration.inputSchema as Record<string, unknown>,
    'tools.presentation-apply.inputSchema'
  )
  assert.doesNotThrow(() => validator.assert(input, 'presentation-apply arguments'))
  assert.deepEqual(operationsFrom(input), input.operations)
})
