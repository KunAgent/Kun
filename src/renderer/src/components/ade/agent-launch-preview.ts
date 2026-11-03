/**
 * The command line Kun will start for an Agent, as a user could type it. Values
 * that live in the credential store are shown as dots, never read back.
 */
export const SECRET_MASK = '•••••'

function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

export function launchPreview(input: {
  command?: string
  args: readonly string[]
  env: Readonly<Record<string, string>>
  secretNames: readonly string[]
}): string {
  const env = [
    ...Object.entries(input.env).filter(([name]) => !input.secretNames.includes(name)).map(([name, value]) => `${name}=${shellWord(value)}`),
    ...input.secretNames.map((name) => `${name}=${SECRET_MASK}`)
  ]
  return [...env, ...(input.command ? [shellWord(input.command)] : []), ...input.args.map(shellWord)].join(' ')
}
