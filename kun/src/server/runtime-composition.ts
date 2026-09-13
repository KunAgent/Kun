import {
  acquireRuntimeDataDirLease,
  type ServerRuntime
} from './runtime-factory-dependencies.js'
import { createRuntimeCore } from './runtime-composition-core.js'
import { createRuntimeModelComposition } from './runtime-composition-model.js'
import { createRuntimeServices } from './runtime-composition-services.js'
import { createRuntimeRegistry } from './runtime-composition-registry.js'
import { createRuntimeAgentComposition } from './runtime-composition-agent.js'
import { createRuntimeExtensionComposition } from './runtime-composition-extensions.js'
import { createRuntimeConfigController } from './runtime-composition-config.js'
import { createServerRuntimeComposition } from './runtime-composition-runtime.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'

export async function createKunServeRuntime(
  options: KunServeRuntimeOptions
): Promise<ServerRuntime> {
  const dataDirLease = options.serviceManager
    ? undefined
    : await acquireRuntimeDataDirLease(options.dataDir)
  try {
    const core = await createRuntimeCore(options, dataDirLease)
    const model = await createRuntimeModelComposition(core)
    const services = await createRuntimeServices(model)
    const registry = createRuntimeRegistry(services)
    const agent = await createRuntimeAgentComposition(registry)
    let runtime: ServerRuntime | undefined
    const extensions = await createRuntimeExtensionComposition(agent, () => runtime?.rooms)
    const config = createRuntimeConfigController(extensions)
    runtime = createServerRuntimeComposition(extensions, config)
    return runtime
  } catch (error) {
    await dataDirLease?.release().catch(() => undefined)
    throw error
  }
}
