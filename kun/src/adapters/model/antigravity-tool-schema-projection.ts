/**
 * agy converts MCP schemas to Google's protobuf Schema, whose enum entries
 * are strings. Numeric/null/empty entries otherwise become empty strings and
 * reject the entire request. Keep their constraints in the description and
 * numeric bounds. The canonical schema and tool execution remain unchanged.
 */
export function projectAntigravityToolInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  // Clone exactly the JSON that the MCP route would otherwise serialize.
  // Do not truncate unrelated schema branches or mutate the shared catalog.
  const projected = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
  visit(projected)
  return projected
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function visit(schema: Record<string, unknown>): void {
  const values = schema.enum
  if (Array.isArray(values) && (!values.length || values.some((value) => typeof value !== 'string' || !value.length))) {
    delete schema.enum
    if (schema.format === 'enum') delete schema.format
    if (values.length) {
      const note = `Allowed values: ${values.map((value) => JSON.stringify(value)).join(', ')}.`
      schema.description = [schema.description, note].filter((part) => typeof part === 'string' && part.length).join(' ')
      if ((schema.type === 'integer' || schema.type === 'number') &&
        values.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) {
        const lower = values.reduce((bound, value) => Math.min(bound, value), Infinity)
        const upper = values.reduce((bound, value) => Math.max(bound, value), -Infinity)
        schema.minimum = typeof schema.minimum === 'number' ? Math.max(schema.minimum, lower) : lower
        schema.maximum = typeof schema.maximum === 'number' ? Math.min(schema.maximum, upper) : upper
      }
    }
  }
  for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
    const entries = schema[key]
    if (record(entries)) for (const value of Object.values(entries)) if (record(value)) visit(value)
  }
  for (const key of ['items', 'additionalProperties', 'unevaluatedProperties', 'contains', 'propertyNames', 'not', 'if', 'then', 'else']) {
    const value = schema[key]
    if (record(value)) visit(value)
  }
  for (const key of ['oneOf', 'anyOf', 'allOf', 'prefixItems']) {
    const values = schema[key]
    if (Array.isArray(values)) for (const value of values) if (record(value)) visit(value)
  }
}
