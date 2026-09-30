import { resolveExecutable } from '../../process/owned-process.js'

/** ACP agents may send either executable + argv, or an entire shell command with no argv. */
export async function resolveAcpTerminalCommand(command: string, args: readonly string[] = [],
  options: { cwd: string; env: NodeJS.ProcessEnv; platform?: NodeJS.Platform }
): Promise<{ command: string; args: readonly string[] }> {
  if (args.length > 0) return { command, args }
  // Preserve a real executable path containing spaces or shell metacharacters.
  const executable = await resolveExecutable(command, options)
  if (executable) return { command: executable, args: [] }
  return (options.platform ?? process.platform) === 'win32'
    ? { command: options.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
    : { command: '/bin/sh', args: ['-c', command] }
}
