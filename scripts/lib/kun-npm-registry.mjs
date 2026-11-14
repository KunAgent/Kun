import assert from 'node:assert/strict'
import { runProcess, locateNpm } from './kun-npm-smoke-process.mjs'

export const NPM_REGISTRY = 'https://registry.npmjs.org/'

export async function publicPackage(name, fetchImpl = fetch) {
  assert(/^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/.test(name), 'Invalid scoped package name')
  const response = await fetchImpl(NPM_REGISTRY + encodeURIComponent(name),
    { signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json' } })
  if (response.status === 404) return { name, status: 'not-publicly-visible', httpStatus: 404, distTags: {}, versions: {} }
  assert(response.ok, 'Registry metadata request failed: ' + response.status)
  const document = await response.json()
  assert.equal(document.name, name)
  return { name, status: 'public', httpStatus: response.status,
    maintainers: (document.maintainers ?? []).map(user => user.name),
    distTags: document['dist-tags'] ?? {}, versions: document.versions ?? {} }
}

async function npmRead(args) {
  const result = await runProcess(process.execPath, [locateNpm(process.execPath), ...args,
    '--registry=' + NPM_REGISTRY, '--json'], { allowFailure: true, timeout: 30_000 })
  let value
  try { value = JSON.parse(result.stdout) } catch { value = null }
  return { code: result.code, value, errorCode: value?.error?.code ?? (result.code ? 'registry-auth-or-request-error' : null) }
}

export async function auditNamespace(release, { read = npmRead, metadata = publicPackage, now = new Date() } = {}) {
  const who = await read(['whoami'])
  const username = who.code === 0 && typeof who.value === 'string' ? who.value : null
  const scope = release.name.split('/')[0].slice(1)
  assert.equal(release.windowsPackage.split('/')[0], '@' + scope)
  const members = await read(['org', 'ls', scope])
  const role = username && members.code === 0 ? members.value?.[username] : null
  const scopeAuthority = Boolean(username && (username === scope || ['owner', 'admin'].includes(role)))
  const packages = []
  for (const name of [release.name, release.windowsPackage]) {
    const remote = await metadata(name)
    const access = username ? await read(['access', 'list', 'packages', username, name]) : null
    const permission = access?.code === 0 ? access.value?.[name] : null
    const canPublish = Boolean(username && (remote.status === 'public'
      ? permission === 'read-write' || remote.maintainers?.includes(username)
      : scopeAuthority))
    packages.push({ name, publicStatus: remote.status, httpStatus: remote.httpStatus,
      maintainers: remote.maintainers ?? [], observedDistTags: remote.distTags,
      accountPublishAuthorityVerified: canPublish,
      authorityBasis: remote.status === 'public' ? permission ?? 'maintainer-list-or-unverified' : 'scope-creation-authority',
      nameAvailability: remote.status === 'public' ? 'existing-package' : 'not-established-by-public-404' })
  }
  return { schemaVersion: 1, kind: 'kun-npm-namespace-audit', checkedAt: now.toISOString(), registry: NPM_REGISTRY,
    readOnly: true, registryWrites: false, distTagsChanged: false,
    identity: { authenticated: Boolean(username), username, errorCode: who.errorCode },
    scope: { name: scope, currentAccountRole: role ?? null, creationAuthorityVerified: scopeAuthority,
      publicOwnerNames: members.code === 0 && members.value
        ? Object.entries(members.value).filter(([, role]) => role === 'owner').map(([name]) => name) : [] },
    packages, rightsVerified: packages.every(item => item.accountPublishAuthorityVerified),
    limitations: ['Public 404 does not reserve a name or prove availability.',
      'Public org membership is not authentication of the caller.',
      'Account authority does not prove token, 2FA or OIDC publishing configuration.',
      'No package, account, organization, access or trusted-publisher setting was created or changed.'] }
}
