import { createHash } from 'node:crypto'

type RecordValue = Record<string, unknown>
export type ResponsesFunctionIdentity = { name: string; namespace?: string }
const ALIAS_PREFIX = 'kun_ns_'

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
}
function name(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a nonempty string`)
  return value
}
function namespace(value: unknown): string | undefined {
  return value == null ? undefined : name(value, 'function namespace')
}
function identityKey(identity: ResponsesFunctionIdentity): string {
  return JSON.stringify([identity.namespace ?? null, identity.name])
}

/**
 * Responses namespace tools are grouped function identities, not hosted tools.
 * The canonical ModelRequest has flat names: use deterministic, bounded aliases
 * and a request-local reverse map, never an ambiguous delimiter-based split.
 * Schema: https://github.com/openai/openai-node/blob/master/src/resources/responses/responses.ts
 */
export class ResponsesToolNamespaces {
  readonly input: RecordValue
  private readonly identities = new Map<string, ResponsesFunctionIdentity>()
  private readonly globals = new Set<string>()
  private readonly declared = new Set<string>()
  private readonly qualifiedChoices = new Map<string, string | null>()
  private hasNamespaces = false

  constructor(input: RecordValue) {
    const tools = input.tools
    if (tools != null && !Array.isArray(tools)) throw new Error('tools must be an array')
    // Reserve global names first, including old calls whose tools were removed.
    for (const raw of (tools as unknown[] | undefined) ?? []) {
      const tool = record(raw)
      if (tool.type === 'function' && typeof tool.name === 'string') this.globals.add(tool.name)
    }
    for (const raw of Array.isArray(input.input) ? input.input : []) {
      const item = record(raw)
      if (item.type === 'function_call' && item.namespace == null && typeof item.name === 'string') this.globals.add(item.name)
    }
    const flattened: RecordValue[] = []
    const groups = new Set<string>()
    const declarations = new Set<string>()
    const add = (tool: RecordValue, group?: { name: string; description: string }) => {
      const identity = { name: name(tool.name, 'function name'), ...(group ? { namespace: group.name } : {}) }
      const key = identityKey(identity)
      if (declarations.has(key)) throw new Error('Duplicate Responses function identity')
      declarations.add(key)
      validateFunctionControls(tool)
      const alias = group ? this.alias(identity) : identity.name
      this.declared.add(alias)
      const description = group
        ? [`Namespace ${JSON.stringify(group.name)}: ${group.description}`, `Function ${JSON.stringify(identity.name)}: ${typeof tool.description === 'string' ? tool.description : ''}`].join('\n')
        : tool.description
      flattened.push({ ...tool, name: alias, description })
      if (flattened.length > 128) throw new Error('tools must contain at most 128 function tools after namespace expansion')
      if (group) {
        const qualified = `${group.name}.${identity.name}`
        this.qualifiedChoices.set(qualified, this.qualifiedChoices.has(qualified) ? null : alias)
      }
    }
    for (const raw of (tools as unknown[] | undefined) ?? []) {
      const tool = record(raw)
      if (tool.type !== 'namespace') {
        if (tool.type === 'function') add(tool)
        else flattened.push(tool) // The existing parser rejects other tool families.
        continue
      }
      this.hasNamespaces = true
      const groupName = name(tool.name, 'namespace name')
      if (groups.has(groupName)) throw new Error('Duplicate Responses namespace declaration')
      groups.add(groupName)
      if (Object.keys(tool).some((key) => !['type', 'name', 'description', 'tools'].includes(key))) throw new Error('Unsupported Responses namespace controls')
      if (typeof tool.description !== 'string') throw new Error('namespace description must be a string')
      if (!Array.isArray(tool.tools) || tool.tools.length === 0) throw new Error('namespace tools must be a nonempty array')
      for (const rawMember of tool.tools) {
        const member = record(rawMember)
        if (member.type !== 'function') throw new Error(`Namespace member type '${String(member.type)}' is not supported; only function members can be translated`)
        add(member, { name: groupName, description: tool.description })
      }
    }
    const calls = new Map<string, ResponsesFunctionIdentity>()
    const normalizedInput = Array.isArray(input.input) ? input.input.map((raw) => {
      const item = record(raw)
      if (item.type === 'function_call') {
        if (item.async === true || (item.caller != null && record(item.caller).type !== 'direct') || item.encrypted_function_args != null) throw new Error('Async, programmatic or encrypted function calls are not supported by the local gateway')
        const identity = { name: name(item.name, 'function_call name'), namespace: namespace(item.namespace) }
        if (typeof item.call_id === 'string') calls.set(item.call_id, identity)
        const { namespace: _namespace, ...rest } = item
        return { ...rest, name: identity.namespace ? this.alias(identity) : identity.name }
      }
      if (item.type === 'function_call_output' && (item.name != null || item.namespace != null)) {
        const call = calls.get(String(item.call_id))
        if (!call || (item.name != null && name(item.name, 'function_call_output name') !== call.name) ||
          (item.namespace != null && namespace(item.namespace) !== call.namespace)) throw new Error('function_call_output identity does not match its call_id')
        const { name: _name, namespace: _namespace, ...rest } = item
        return rest
      }
      return raw
    }) : input.input
    this.input = { ...input, ...(tools != null ? { tools: flattened } : {}), input: normalizedInput,
      tool_choice: this.normalizeChoice(input.tool_choice) }
  }

  private alias(identity: ResponsesFunctionIdentity): string {
    const key = identityKey(identity)
    const alias = ALIAS_PREFIX + createHash('sha256').update(key).digest('hex').slice(0, 56)
    const previous = this.identities.get(alias)
    if (this.globals.has(alias) || (previous && identityKey(previous) !== key)) throw new Error('Responses namespace alias collides with another function identity')
    this.identities.set(alias, identity)
    return alias
  }

  private normalizeChoice(value: unknown): unknown {
    const choice = record(value)
    if (choice.type !== 'function') return value
    const requested = name(choice.name, 'tool_choice name')
    const group = namespace(choice.namespace)
    const qualified = this.qualifiedChoices.get(requested)
    let alias = requested
    if (group) alias = this.alias({ namespace: group, name: requested })
    else if (qualified !== undefined) {
      if (qualified === null || this.globals.has(requested)) throw new Error('Ambiguous namespaced tool_choice; specify namespace and name separately')
      alias = qualified
    }
    if (!this.declared.has(alias)) throw new Error('tool_choice must name an advertised function identity')
    const { namespace: _namespace, ...rest } = choice
    return { ...rest, name: alias }
  }

  /** Decode only known aliases. Never infer a namespace from punctuation or suffixes. */
  wireIdentity(flatName: string): ResponsesFunctionIdentity {
    if (!flatName) return { name: flatName } // A later upstream delta may supply the name.
    const identity = this.identities.get(flatName)
    if (((this.hasNamespaces || identity) && !this.declared.has(flatName)) || (!identity && flatName.startsWith(ALIAS_PREFIX) && !this.declared.has(flatName))) {
      throw new Error('Upstream selected an undeclared or ambiguous namespaced function')
    }
    return identity ?? { name: flatName }
  }
}

function validateFunctionControls(tool: RecordValue): void {
  if (tool.namespace != null || tool.function != null) throw new Error('Responses functions must use the flat function declaration shape')
  if (tool.strict != null && typeof tool.strict !== 'boolean') throw new Error('function strict must be a boolean')
  if (tool.description != null && typeof tool.description !== 'string') throw new Error('function description must be a string')
  if (tool.defer_loading != null && tool.defer_loading !== false) throw new Error('Deferred function discovery is not supported by the local gateway')
  if (tool.async != null && tool.async !== false) throw new Error('Asynchronous function tools are not supported by the local gateway')
  if (tool.allowed_callers != null && (!Array.isArray(tool.allowed_callers) || tool.allowed_callers.length !== 1 || tool.allowed_callers[0] !== 'direct')) throw new Error('Only direct function callers are supported by the local gateway')
  if (tool.output_schema != null) throw new Error('Function output_schema is not supported by the local gateway')
}
