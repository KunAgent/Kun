import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { npmInvocation } from './lib/extension-release-execution.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const kunTests = [
  'src/contracts/graph.test.ts',
  'src/graph',
  'src/adapters/tool/graph-define-plan-tool.test.ts',
  'src/adapters/tool/graph-lead-patch-tool.test.ts',
  'src/adapters/tool/graph-lead-review-tool.test.ts',
  'src/adapters/tool/graph-lead-supervision-tool.test.ts',
  'src/loop/agent-loop-host-shutdown.test.ts',
  'src/runtime/delegated-graph-turn-policy.test.ts',
  'src/runtime/agent-sdk/agent-sdk-runtime-factory.test.ts',
  'src/runtime/agent-sdk/agent-sdk-runtime.test.ts',
  'src/runtime/cursor/cursor-sdk-runtime-factory.test.ts',
  'src/runtime/cursor/cursor-sdk-runtime.test.ts',
  'src/runtime/antigravity/antigravity-cli-runtime.test.ts',
  'src/server/graph-runtime-bootstrap.test.ts',
  'src/server/graph-runtime-factory.test.ts',
  'src/server/graph-runtime-shutdown-recovery.test.ts',
  'src/server/runtime-graph-planning-recovery.test.ts',
  'src/server/runtime-graph-shutdown-order.test.ts',
  'src/server/routes/graphs.test.ts',
  'src/tui/graph-mode.test.ts',
  'src/tui/commands.test.ts',
  'src/tui/client.test.ts',
  'src/tui/controller.test.ts',
  'src/tui/state.test.ts',
  'src/tui/pages/graph-page.test.ts'
]

const rendererTests = [
  'src/renderer/src/components/chat/FloatingComposerGraphProgress.test.ts',
  'src/renderer/src/components/graph/GraphModePanel.test.ts',
  'src/renderer/src/components/graph/GraphNodeInspector.test.ts',
  'src/renderer/src/components/graph/GraphRunCanvas.test.ts',
  'src/renderer/src/components/workbench-layout.test.ts',
  'src/renderer/src/graph/graph-store.test.ts'
]

const kunNpm = npmInvocation({
  args: [
    '--prefix',
    'kun',
    'test',
    '--',
    ...kunTests,
    '--reporter=dot'
  ]
})
run(kunNpm.command, kunNpm.args)

run(process.execPath, [
  join(root, 'node_modules', 'vitest', 'vitest.mjs'),
  'run',
  ...rendererTests,
  '--reporter=dot'
])

process.stdout.write(
  `Graph platform suite passed on ${process.platform}/${process.arch}.\n`
)

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.signal) {
    throw new Error(`Graph platform suite terminated by ${result.signal}`)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
