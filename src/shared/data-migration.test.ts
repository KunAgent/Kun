import { describe, expect, it } from 'vitest'
import fixtureReport from './__fixtures__/data-migration/v1/expected-report.json'
import fixtureManifest from './__fixtures__/data-migration/v1/manifest.json'
import {
  DATA_MIGRATION_BACKUP_RETENTION_DAYS,
  DATA_MIGRATION_REFERENCE_DESCRIPTORS_V1,
  DATA_MIGRATION_V1_DEFAULTS,
  DataMigrationImportPlanSchema,
  DataMigrationManifestV1Schema,
  DataMigrationPolicySchema,
  DataMigrationReportSchema,
  PackageRelativePathSchema,
  buildMigrationDestinationPath,
  classifyDataMigrationPath,
  migrateDataMigrationComponent,
  migrationPathRelativeToWorkspace,
  parseMigrationSourcePath,
  parsePackageRelativePath
} from './data-migration'

const SHA256 = 'a'.repeat(64)

describe('data migration v1 defaults', () => {
  it('encodes the approved security and conflict defaults', () => {
    expect(DATA_MIGRATION_V1_DEFAULTS).toMatchObject({
      encryption: 'optional',
      allowUnencryptedAfterAcknowledgement: true,
      completeIncludesGit: true,
      smallerIncludesGit: false,
      backupRetentionDays: 7,
      workflowsImportActive: false,
      schedulesImportEnabled: false,
      clearScheduleChannelBindings: true,
      enterprisePolicyGateReserved: true,
      defaultWorkspaceConflictStrategy: 'keep-both'
    })
    expect(DATA_MIGRATION_BACKUP_RETENTION_DAYS).toBe(7)
  })

  it('reserves enterprise controls without changing personal defaults', () => {
    expect(DataMigrationPolicySchema.parse({})).toEqual({
      exportEnabled: true,
      importEnabled: true,
      requireEncryption: false,
      allowedExportRoots: [],
      allowedImportRoots: []
    })
  })
})

describe('migration package schemas', () => {
  it('keeps the immutable v1 fixture valid', () => {
    expect(DataMigrationManifestV1Schema.parse(fixtureManifest).packageId).toBe('fixture_v1_empty')
    expect(DataMigrationReportSchema.parse(fixtureReport).outcome).toBe('success')
  })

  it('accepts a complete v1 manifest', () => {
    expect(DataMigrationManifestV1Schema.parse({
      formatVersion: 1,
      minimumReaderVersion: 1,
      packageId: 'pkg_1',
      sourceInstallationId: 'install_1',
      sourceAppVersion: '0.1.0',
      sourceRuntimeVersion: '0.1.0',
      sourcePlatform: 'windows',
      sourceArch: 'x64',
      createdAt: '2026-07-15T00:00:00.000Z',
      encryption: { mode: 'none' },
      componentVersions: {
        manifest: 1,
        workspace: 1,
        thread: 1,
        session: 1,
        event: 1,
        attachment: 1,
        artifact: 1,
        memory: 1,
        'portable-settings': 1,
        'renderer-state': 1,
        workflow: 1,
        schedule: 1
      },
      selection: {
        preset: 'complete',
        workspaceIds: ['workspace_1'],
        threadIds: ['thread_1'],
        categories: ['workspace-files', 'thread-history'],
        sensitiveContentAcknowledged: true,
        unencryptedPackageAcknowledged: true
      },
      counts: { workspaces: 1, threads: 1, entries: 3, attachments: 0, artifacts: 0, memories: 0 },
      expandedBytes: 100,
      catalogsSha256: SHA256,
      checksumsSha256: SHA256
    }).packageId).toBe('pkg_1')
  })

  it('rejects import plans with malformed IDs or negative byte counts', () => {
    const result = DataMigrationImportPlanSchema.safeParse({
      operationId: '../bad',
      packageId: 'pkg_1',
      inspectedAt: 'now',
      sourcePlatform: 'linux',
      encrypted: false,
      mappings: [],
      conflicts: [],
      estimatedPeakBytes: -1,
      fatalIssueCount: 0
    })
    expect(result.success).toBe(false)
  })
})

describe('package relative paths', () => {
  it.each([
    '/absolute/file.txt',
    'C:/drive/file.txt',
    '../escape',
    'safe/../escape',
    './file.txt',
    'double//slash',
    'back\\slash.txt',
    '~/home.txt',
    ''
  ])('rejects unsafe path %s', (value) => {
    expect(PackageRelativePathSchema.safeParse(value).success).toBe(false)
  })

  it('accepts a normalized POSIX relative path', () => {
    expect(parsePackageRelativePath('src/design/mockup.svg')).toBe('src/design/mockup.svg')
  })
})

describe('migration inclusion policy', () => {
  it('hard-excludes Kun-owned credentials under every preset', () => {
    expect(classifyDataMigrationPath({ path: 'credentials/credentials.enc.json', scope: 'runtime', preset: 'complete' })).toEqual({
      action: 'hard-exclude',
      ruleId: 'runtime-credentials'
    })
    expect(classifyDataMigrationPath({ path: 'mcp-oauth/provider.json', scope: 'runtime', preset: 'smaller' }).action).toBe('hard-exclude')
  })

  it('keeps git and dependencies in Complete but excludes them in Smaller', () => {
    expect(classifyDataMigrationPath({ path: '.git/config', scope: 'workspace', preset: 'complete' }).action).toBe('include')
    expect(classifyDataMigrationPath({ path: '.git/config', scope: 'workspace', preset: 'smaller' })).toEqual({
      action: 'preset-exclude',
      ruleId: 'git-metadata'
    })
    expect(classifyDataMigrationPath({ path: 'node_modules/zod/index.js', scope: 'workspace', preset: 'smaller' }).action).toBe('preset-exclude')
  })

  it('never drops Design and SDD artifacts as generic build output', () => {
    expect(classifyDataMigrationPath({ path: '.kun-design/screen/dist/index.html', scope: 'workspace', preset: 'smaller' })).toEqual({
      action: 'include',
      ruleId: 'portable-artifact'
    })
    expect(classifyDataMigrationPath({ path: '.kunsdd/draft/build/spec.md', scope: 'workspace', preset: 'smaller' }).action).toBe('include')
  })

  it.each(['.env', '.env.production', 'id_ed25519', 'client.pem', '.npmrc'])(
    'requires acknowledgement for %s',
    (path) => {
      expect(classifyDataMigrationPath({ path, scope: 'workspace', preset: 'complete' }).action).toBe('require-sensitive-acknowledgement')
    }
  )
})

describe('cross-platform source paths', () => {
  it('parses Windows drive and UNC roots using source semantics', () => {
    expect(parseMigrationSourcePath('d:\\Projects\\Atlas\\src', 'windows')).toEqual({
      platform: 'windows',
      kind: 'drive',
      root: 'D:',
      segments: ['Projects', 'Atlas', 'src']
    })
    expect(parseMigrationSourcePath('\\\\server\\share\\team\\project', 'windows')).toEqual({
      platform: 'windows',
      kind: 'unc',
      root: '\\\\server\\share',
      segments: ['team', 'project']
    })
  })

  it('parses POSIX and home paths', () => {
    expect(parseMigrationSourcePath('/Users/alice/project', 'macos')).toMatchObject({
      kind: 'absolute',
      root: '/',
      segments: ['Users', 'alice', 'project']
    })
    expect(parseMigrationSourcePath('~/.kun/write_workspace', 'linux')).toMatchObject({
      kind: 'home',
      root: '~',
      segments: ['.kun', 'write_workspace']
    })
  })

  it('derives a case-insensitive Windows workspace-relative package path', () => {
    const relative = migrationPathRelativeToWorkspace({
      path: 'd:\\PROJECTS\\Atlas\\src\\main.ts',
      workspaceRoot: 'D:\\Projects\\atlas',
      sourcePlatform: 'windows'
    })
    expect(relative).toBe('src/main.ts')
    expect(buildMigrationDestinationPath({
      destinationRoot: '/Users/alice/Atlas',
      relativePath: relative!,
      destinationPlatform: 'macos'
    })).toBe('/Users/alice/Atlas/src/main.ts')
  })

  it('does not claim a path outside the selected workspace', () => {
    expect(migrationPathRelativeToWorkspace({
      path: '/home/alice/other/file.txt',
      workspaceRoot: '/home/alice/project',
      sourcePlatform: 'linux'
    })).toBeNull()
  })

  it.each([
    ['windows', 'C:\\Work\\Atlas', 'C:\\Work\\Atlas\\src\\main.ts', 'windows', 'D:\\Imports\\Atlas', 'D:\\Imports\\Atlas\\src\\main.ts'],
    ['windows', 'C:\\Work\\Atlas', 'C:\\Work\\Atlas\\src\\main.ts', 'macos', '/Users/test/Atlas', '/Users/test/Atlas/src/main.ts'],
    ['windows', 'C:\\Work\\Atlas', 'C:\\Work\\Atlas\\src\\main.ts', 'linux', '/home/test/Atlas', '/home/test/Atlas/src/main.ts'],
    ['macos', '/Users/a/Atlas', '/Users/a/Atlas/src/main.ts', 'windows', 'D:\\Imports\\Atlas', 'D:\\Imports\\Atlas\\src\\main.ts'],
    ['macos', '/Users/a/Atlas', '/Users/a/Atlas/src/main.ts', 'macos', '/Users/test/Atlas', '/Users/test/Atlas/src/main.ts'],
    ['macos', '/Users/a/Atlas', '/Users/a/Atlas/src/main.ts', 'linux', '/home/test/Atlas', '/home/test/Atlas/src/main.ts'],
    ['linux', '/home/a/Atlas', '/home/a/Atlas/src/main.ts', 'windows', 'D:\\Imports\\Atlas', 'D:\\Imports\\Atlas\\src\\main.ts'],
    ['linux', '/home/a/Atlas', '/home/a/Atlas/src/main.ts', 'macos', '/Users/test/Atlas', '/Users/test/Atlas/src/main.ts'],
    ['linux', '/home/a/Atlas', '/home/a/Atlas/src/main.ts', 'linux', '/home/test/Atlas', '/home/test/Atlas/src/main.ts']
  ] as const)('maps %s source paths to %s destinations', (sourcePlatform, sourceRoot, sourcePath, destinationPlatform, destinationRoot, expected) => {
    const relativePath = migrationPathRelativeToWorkspace({ path: sourcePath, workspaceRoot: sourceRoot, sourcePlatform })
    expect(relativePath).toBe('src/main.ts')
    expect(buildMigrationDestinationPath({ destinationRoot, relativePath: relativePath!, destinationPlatform })).toBe(expected)
  })
})

describe('typed reference registry and component migrators', () => {
  it('covers every v1 component that owns operational paths or IDs', () => {
    const components = new Set(DATA_MIGRATION_REFERENCE_DESCRIPTORS_V1.map((descriptor) => descriptor.component))
    expect(components).toEqual(new Set([
      'thread',
      'session',
      'event',
      'attachment',
      'memory',
      'renderer-state',
      'portable-settings',
      'workflow',
      'schedule',
      'artifact'
    ]))
  })

  it('applies a deterministic contiguous migrator chain', () => {
    expect(migrateDataMigrationComponent(
      { component: 'thread', schemaVersion: 1, data: { title: 'A' } },
      3,
      [
        { component: 'thread', fromVersion: 1, toVersion: 2, migrate: (data) => ({ ...(data as object), status: 'idle' }) },
        { component: 'thread', fromVersion: 2, toVersion: 3, migrate: (data) => ({ ...(data as object), relation: 'primary' }) }
      ]
    )).toEqual({
      component: 'thread',
      schemaVersion: 3,
      data: { title: 'A', status: 'idle', relation: 'primary' }
    })
  })

  it('rejects missing, ambiguous, invalid, and downgrade migrators', () => {
    expect(() => migrateDataMigrationComponent(
      { component: 'thread', schemaVersion: 1, data: {} },
      2,
      []
    )).toThrow('missing component migrator')

    const duplicate = [
      { component: 'thread' as const, fromVersion: 1, toVersion: 2, migrate: (data: unknown) => data },
      { component: 'thread' as const, fromVersion: 1, toVersion: 2, migrate: (data: unknown) => data }
    ]
    expect(() => migrateDataMigrationComponent(
      { component: 'thread', schemaVersion: 1, data: {} },
      2,
      duplicate
    )).toThrow('ambiguous component migrator')
    expect(() => migrateDataMigrationComponent(
      { component: 'thread', schemaVersion: 2, data: {} },
      1,
      []
    )).toThrow('downgrade')
  })
})
