import { appendFile } from 'node:fs/promises'
import { fileMutationLockRoot, withFileMutationQueue } from '../../src/adapters/tool/file-mutation-queue'

/**
 * Child-process worker for the cross-process credential lock test.
 *
 * It takes exactly the coordination call the OAuth store makes
 * (`withFileMutationQueue` on the physical credential path, with the lock root
 * derived from that path) so two children started with different `TMPDIR`
 * values prove the lock domain follows the file rather than the environment.
 *
 * argv: <credentialPath> <logPath> <label> <holdMs>
 */
const [credentialPath, logPath, label, holdMs] = process.argv.slice(2)
if (!credentialPath || !logPath || !label) throw new Error('worker arguments are missing')

await withFileMutationQueue(credentialPath, async () => {
  await appendFile(logPath, `${label}:enter\n`)
  await new Promise((resolve) => setTimeout(resolve, Number(holdMs ?? '0')))
  await appendFile(logPath, `${label}:exit\n`)
}, { lockRoot: fileMutationLockRoot(credentialPath) })
