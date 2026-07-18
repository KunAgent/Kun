import type { ExtensionToolDeclarationInput, JsonObject } from '@kun/extension-api'

const idSchema: JsonObject = {
  type: 'string',
  minLength: 1,
  maxLength: 64,
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$'
}

const pathSchema: JsonObject = {
  type: 'string',
  minLength: 14,
  maxLength: 240,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._ -]*\\.kun-ppt\\.html$'
}

const sha256Schema: JsonObject = {
  type: 'string',
  pattern: '^[0-9a-f]{64}$'
}

const colorSchema: JsonObject = {
  type: 'string',
  pattern: '^#[0-9A-Fa-f]{6}$'
}

const elementBaseProperties: JsonObject = {
  id: idSchema,
  x: { type: 'number', minimum: 0, maximum: 100 },
  y: { type: 'number', minimum: 0, maximum: 100 },
  width: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
  height: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
  rotation: { type: 'number', minimum: -180, maximum: 180 },
  opacity: { type: 'number', minimum: 0, maximum: 1 }
}

const textElementSchema: JsonObject = {
  type: 'object',
  properties: {
    ...elementBaseProperties,
    type: { const: 'text' },
    text: { type: 'string', maxLength: 4000 },
    fontSize: { type: 'number', minimum: 8, maximum: 240 },
    fontWeight: { enum: [400, 500, 600, 700] },
    fontFamily: { enum: ['sans', 'serif', 'mono'] },
    color: colorSchema,
    align: { enum: ['left', 'center', 'right'] },
    verticalAlign: { enum: ['top', 'middle', 'bottom'] }
  },
  required: [
    'id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'opacity',
    'text', 'fontSize', 'fontWeight', 'color', 'align', 'verticalAlign'
  ],
  additionalProperties: false
}

const shapeElementSchema: JsonObject = {
  type: 'object',
  properties: {
    ...elementBaseProperties,
    type: { const: 'shape' },
    shape: { enum: ['rectangle', 'ellipse', 'line'] },
    fillColor: colorSchema,
    strokeColor: colorSchema,
    strokeWidth: { type: 'number', minimum: 0, maximum: 32 },
    cornerRadius: { type: 'number', minimum: 0, maximum: 100 }
  },
  required: [
    'id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'opacity',
    'shape', 'fillColor', 'strokeColor', 'strokeWidth', 'cornerRadius'
  ],
  additionalProperties: false
}

const imageElementSchema: JsonObject = {
  type: 'object',
  properties: {
    ...elementBaseProperties,
    type: { const: 'image' },
    src: {
      type: 'string',
      minLength: 1,
      maxLength: 260,
      // Keep the broker-compiled pattern deliberately simple. The shared
      // parser performs the complete segment/traversal validation.
      pattern: '\\.(?:[Pp][Nn][Gg]|[Jj][Pp][Gg]|[Jj][Pp][Ee][Gg]|[Ww][Ee][Bb][Pp]|[Gg][Ii][Ff])$'
    },
    alt: { type: 'string', maxLength: 500 },
    fit: { enum: ['contain', 'cover'] }
  },
  required: ['id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'src', 'alt', 'fit'],
  additionalProperties: false
}

const elementSchema: JsonObject = {
  oneOf: [textElementSchema, shapeElementSchema, imageElementSchema]
}

const slideSchema: JsonObject = {
  type: 'object',
  properties: {
    id: idSchema,
    title: { type: 'string', minLength: 1, maxLength: 120 },
    backgroundColor: { oneOf: [colorSchema, { type: 'null' }] },
    elements: { type: 'array', maxItems: 128, items: elementSchema }
  },
  required: ['id', 'title', 'elements'],
  additionalProperties: false
}

const themeSchema: JsonObject = {
  type: 'object',
  properties: {
    backgroundColor: colorSchema,
    textColor: colorSchema,
    accentColor: colorSchema,
    fontFamily: { enum: ['sans', 'serif', 'mono'] }
  },
  required: ['backgroundColor', 'textColor', 'accentColor', 'fontFamily'],
  additionalProperties: false
}

const receiptSchema: JsonObject = {
  type: 'object',
  properties: {
    operationId: { type: 'string', minLength: 1, maxLength: 128 },
    digest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    resultingRevision: { type: 'integer', minimum: 1 }
  },
  required: ['operationId', 'digest', 'resultingRevision'],
  additionalProperties: false
}

export const presentationProjectSchema: JsonObject = {
  type: 'object',
  properties: {
    schemaVersion: { const: 1 },
    id: idSchema,
    revision: { type: 'integer', minimum: 1 },
    title: { type: 'string', minLength: 1, maxLength: 160 },
    theme: themeSchema,
    slides: { type: 'array', minItems: 1, maxItems: 64, items: slideSchema },
    operationReceipts: { type: 'array', maxItems: 64, items: receiptSchema }
  },
  required: ['schemaVersion', 'id', 'revision', 'title', 'theme', 'slides', 'operationReceipts'],
  additionalProperties: false
}

const themePatchSchema: JsonObject = {
  type: 'object',
  minProperties: 1,
  properties: {
    backgroundColor: colorSchema,
    textColor: colorSchema,
    accentColor: colorSchema,
    fontFamily: { enum: ['sans', 'serif', 'mono'] }
  },
  additionalProperties: false
}

export const presentationOperationSchema: JsonObject = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'document.update' },
        patch: {
          type: 'object',
          minProperties: 1,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 160 },
            theme: themePatchSchema
          },
          additionalProperties: false
        }
      },
      required: ['kind', 'patch'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'slide.insert' },
        slide: slideSchema,
        index: { type: 'integer', minimum: 0, maximum: 63 }
      },
      required: ['kind', 'slide'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'slide.update' },
        slideId: idSchema,
        patch: {
          type: 'object',
          minProperties: 1,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 120 },
            backgroundColor: { oneOf: [colorSchema, { type: 'null' }] }
          },
          additionalProperties: false
        }
      },
      required: ['kind', 'slideId', 'patch'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: { kind: { const: 'slide.delete' }, slideId: idSchema },
      required: ['kind', 'slideId'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'slide.reorder' },
        slideId: idSchema,
        index: { type: 'integer', minimum: 0, maximum: 63 }
      },
      required: ['kind', 'slideId', 'index'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'element.upsert' },
        slideId: idSchema,
        element: elementSchema,
        index: { type: 'integer', minimum: 0, maximum: 127 }
      },
      required: ['kind', 'slideId', 'element'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'element.style' },
        slideId: idSchema,
        elementId: idSchema,
        css: { type: 'string', minLength: 1, maxLength: 2000 }
      },
      required: ['kind', 'slideId', 'elementId', 'css'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'element.delete' },
        slideId: idSchema,
        elementId: idSchema
      },
      required: ['kind', 'slideId', 'elementId'],
      additionalProperties: false
    }
  ]
}

const issueSchema: JsonObject = {
  type: 'object',
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 128 },
    path: { type: 'string', maxLength: 1024 },
    message: { type: 'string', minLength: 1, maxLength: 4096 }
  },
  required: ['code', 'path', 'message'],
  additionalProperties: false
}

export const MAX_TOOL_CHANGED_IDS = 512
export const MAX_TOOL_ISSUES = 16

const pathInputSchema: JsonObject = {
  type: 'object',
  properties: { path: pathSchema },
  required: ['path'],
  additionalProperties: false
}

const createInputSchema: JsonObject = {
  type: 'object',
  properties: {
    path: pathSchema,
    title: { type: 'string', minLength: 1, maxLength: 160 }
  },
  required: ['path'],
  additionalProperties: false
}

const createOutputSchema: JsonObject = {
  type: 'object',
  properties: {
    path: pathSchema,
    revision: { type: 'integer', minimum: 1 },
    contentSha256: sha256Schema,
    warnings: { type: 'array', maxItems: MAX_TOOL_ISSUES, items: issueSchema },
    warningCount: { type: 'integer', minimum: 0 },
    warningsTruncated: { type: 'boolean' }
  },
  required: ['path', 'revision', 'contentSha256', 'warnings', 'warningCount', 'warningsTruncated'],
  additionalProperties: false
}

const readOutputSchema: JsonObject = {
  type: 'object',
  properties: {
    path: pathSchema,
    project: presentationProjectSchema,
    htmlBytes: { type: 'integer', minimum: 1, maximum: 900000 },
    contentSha256: sha256Schema
  },
  required: ['path', 'project', 'htmlBytes', 'contentSha256'],
  additionalProperties: false
}

const applyInputSchema: JsonObject = {
  type: 'object',
  properties: {
    path: pathSchema,
    expectedRevision: { type: 'integer', minimum: 1 },
    operationId: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'Optional idempotency key. Kun derives one from the tool invocation when omitted.'
    },
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: 128,
      items: presentationOperationSchema,
      description: 'Use only the declared operation kinds. element.upsert requires a complete typed element; element.style accepts bounded safe CSS declarations.'
    }
  },
  required: ['path', 'expectedRevision', 'operations'],
  additionalProperties: false
}

const applyOutputSchema: JsonObject = {
  type: 'object',
  properties: {
    path: pathSchema,
    resultingRevision: { type: 'integer', minimum: 1 },
    currentRevision: { type: 'integer', minimum: 1 },
    contentSha256: sha256Schema,
    changedIds: { type: 'array', maxItems: MAX_TOOL_CHANGED_IDS, items: idSchema },
    changedIdCount: { type: 'integer', minimum: 0 },
    changedIdsTruncated: { type: 'boolean' },
    warnings: { type: 'array', maxItems: MAX_TOOL_ISSUES, items: issueSchema },
    warningCount: { type: 'integer', minimum: 0 },
    warningsTruncated: { type: 'boolean' },
    idempotentReplay: { type: 'boolean' }
  },
  required: [
    'path', 'resultingRevision', 'currentRevision', 'contentSha256',
    'changedIds', 'changedIdCount', 'changedIdsTruncated',
    'warnings', 'warningCount', 'warningsTruncated', 'idempotentReplay'
  ],
  additionalProperties: false
}

const validateOutputSchema: JsonObject = {
  type: 'object',
  properties: {
    path: pathSchema,
    revision: { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
    valid: { type: 'boolean' },
    errors: { type: 'array', maxItems: MAX_TOOL_ISSUES, items: issueSchema },
    errorCount: { type: 'integer', minimum: 0 },
    errorsTruncated: { type: 'boolean' },
    warnings: { type: 'array', maxItems: MAX_TOOL_ISSUES, items: issueSchema },
    warningCount: { type: 'integer', minimum: 0 },
    warningsTruncated: { type: 'boolean' }
  },
  required: [
    'path', 'revision', 'valid',
    'errors', 'errorCount', 'errorsTruncated',
    'warnings', 'warningCount', 'warningsTruncated'
  ],
  additionalProperties: false
}

const exportInputSchema: JsonObject = {
  type: 'object',
  properties: {
    path: pathSchema,
    destinationPath: pathSchema,
    expectedRevision: { type: 'integer', minimum: 1 }
  },
  required: ['path', 'destinationPath', 'expectedRevision'],
  additionalProperties: false
}

const exportOutputSchema: JsonObject = {
  type: 'object',
  properties: {
    sourcePath: pathSchema,
    destinationPath: pathSchema,
    revision: { type: 'integer', minimum: 1 },
    bytes: { type: 'integer', minimum: 1, maximum: 900000 },
    contentSha256: sha256Schema,
    idempotentReplay: { type: 'boolean' }
  },
  required: [
    'sourcePath', 'destinationPath', 'revision', 'bytes', 'contentSha256', 'idempotentReplay'
  ],
  additionalProperties: false
}

export const presentationToolDeclarations = [
  {
    id: 'presentation-create',
    description: 'Create a new root-level standalone .kun-ppt.html presentation without overwriting an existing file.',
    inputSchema: createInputSchema,
    outputSchema: createOutputSchema,
    sideEffects: 'write',
    idempotent: false,
    maxOutputBytes: 65_536
  },
  {
    id: 'presentation-read',
    description: 'Read the current structured presentation model and revision before planning edits.',
    inputSchema: pathInputSchema,
    outputSchema: readOutputSchema,
    sideEffects: 'read',
    idempotent: true,
    maxOutputBytes: 950_000
  },
  {
    id: 'presentation-apply',
    description: 'Apply typed operations to the revision returned by presentation-read. operationId is optional. slide.insert defaults backgroundColor to null; element.upsert accepts complete elements; element.style accepts bounded safe CSS declarations for one element.',
    inputSchema: applyInputSchema,
    outputSchema: applyOutputSchema,
    sideEffects: 'write',
    idempotent: true,
    maxOutputBytes: 131_072
  },
  {
    id: 'presentation-validate',
    description: 'Validate a presentation and report bounded structural and accessibility diagnostics.',
    inputSchema: pathInputSchema,
    outputSchema: validateOutputSchema,
    sideEffects: 'read',
    idempotent: true,
    maxOutputBytes: 131_072
  },
  {
    id: 'presentation-export-copy',
    description: 'Copy a verified revision after checking that the destination is absent or already identical.',
    inputSchema: exportInputSchema,
    outputSchema: exportOutputSchema,
    sideEffects: 'write',
    idempotent: true,
    maxOutputBytes: 65_536
  }
] satisfies ExtensionToolDeclarationInput[]

export const presentationCommandContributions = [
  {
    id: 'presentation-create',
    title: 'Kun PPT: Create Deck',
    description: 'Create a new root-level standalone HTML presentation.',
    inputSchema: createInputSchema
  },
  {
    id: 'presentation-load',
    title: 'Kun PPT: Load Deck',
    description: 'Load a root-level standalone HTML presentation.',
    inputSchema: pathInputSchema
  },
  {
    id: 'presentation-save',
    title: 'Kun PPT: Save Operations',
    description: 'Save one revision-aware batch of visual presentation operations.',
    inputSchema: {
      ...applyInputSchema,
      required: ['path', 'expectedRevision', 'operations']
    }
  },
  {
    id: 'presentation-export-copy',
    title: 'Kun PPT: Export Copy',
    description: 'Copy the current revision to another root-level HTML presentation.',
    inputSchema: exportInputSchema
  }
]

export const presentationSidebarViewContribution = {
  id: 'studio',
  title: 'Kun PPT',
  entry: 'dist/webview/index.html',
  icon: 'assets/presentation-studio.svg',
  order: 40,
  multiple: false,
  localResourceRoots: ['dist/webview']
}
