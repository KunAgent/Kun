import { it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => fixture.root } }))
import { desktopProcessBirth } from './native-input'

it.skipIf(process.platform === 'win32')('allows bounded first-launch trust evaluation without changing the input lease', async () => {
  fixture.root = await mkdtemp(join(tmpdir(), 'kun-native-identity-'))
  const directory = join(fixture.root, 'resources/native'), helper = join(directory, 'remote-desktop-input')
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(helper, '#!/bin/sh\nsleep 2\nprintf "123:456\\n"\n')
    await chmod(helper, 0o700)
    expect(await desktopProcessBirth(process.pid)).toBe('123:456')
  } finally { await rm(fixture.root, { recursive: true, force: true }) }
}, 8000)
