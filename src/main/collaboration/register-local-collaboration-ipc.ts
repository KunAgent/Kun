import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { app, ipcMain, safeStorage } from 'electron'
import type {
  CollaborationNetworkCommand,
  CollaborationNetworkStatus,
  HumanCollaborationCommand,
  LocalCollaborationSnapshot
} from '../../shared/collaboration/contracts'
import { IdentityVault } from './identity-vault'
import { MlsAdapter } from './crypto/mls-adapter'
import { MlsMembershipDriver } from './crypto/mls-membership-driver'
import { MlsNetworkSecurity } from './crypto/mls-network-security'
import { TaskKeyService } from './crypto/task-key-service'
import { LocalCollaborationStore } from './local-collaboration-store'
import { LocalCollaborationService } from './local-collaboration-service'
import { CollaborationNetworkService } from './network/collaboration-network-service'
import { CollaborationBackgroundSync } from './network/collaboration-background-sync'
import { CollaborationHttpClient, ServerPinStore } from './network/collaboration-transport'
import { NetworkCredentialVault } from './network/network-credential-vault'
import { RemoteInvocationCoordinator } from './network/remote-invocation-coordinator'
import { LocalCollaborationServer } from './network/local-collaboration-server'
import {
  ReceptionInvocationGateway,
  type CollaborationRuntimeRequest
} from './reception-invocation-gateway'

const LOCAL_RECEPTION_ALLOWED_TOOLS = ['read', 'grep', 'find', 'ls'] as const
let activeBackgroundSync: CollaborationBackgroundSync | null = null

export function registerLocalCollaborationIpc(options: {
  runtimeRequest: CollaborationRuntimeRequest
  getWorkspaceRoot: () => Promise<string>
}): void {
  const userData = app.getPath('userData')
  const localServer = new LocalCollaborationServer({
    binaryPath: resolveCollaborationServerPath(),
    dataDir: join(userData, 'collaboration-server')
  })
  const gateway = new ReceptionInvocationGateway({
    runtimeRequest: options.runtimeRequest,
    workspaceRoot: options.getWorkspaceRoot,
    localAllowedToolNames: LOCAL_RECEPTION_ALLOWED_TOOLS
  })
  const service = new LocalCollaborationService(
    new LocalCollaborationStore(userData),
    gateway
  )
  let networkService: Promise<CollaborationNetworkService> | null = null
  const getNetworkService = (): Promise<CollaborationNetworkService> => {
    networkService ??= createNetworkService(userData, service, gateway).then((network) => {
      activeBackgroundSync?.stop()
      activeBackgroundSync = new CollaborationBackgroundSync({
        status: () => network.getStatus(),
        dispatch: (command) => network.dispatch(command),
        afterSync: (meetingId) => inspectRemoteInvocations(network, service, meetingId)
      })
      activeBackgroundSync.start()
      return network
    })
    return networkService
  }
  ipcMain.removeHandler('collaboration:snapshot')
  ipcMain.removeHandler('collaboration:dispatch')
  ipcMain.removeHandler('collaboration:network-status')
  ipcMain.removeHandler('collaboration:network-dispatch')
  ipcMain.handle('collaboration:snapshot', () => service.getSnapshot())
  ipcMain.handle('collaboration:dispatch', async (_event, command: HumanCollaborationCommand) => {
    const before = command.kind === 'employee_interrupt' ? await service.getSnapshot() : null
    const interrupted = command.kind === 'employee_interrupt'
      ? before?.invocations.find((item) => item.id === command.invocationId)
      : undefined
    const interruptedPublication = interrupted
      ? before?.employees.find((item) => item.employeeId === interrupted.employeeId)
      : undefined
    const result = await service.dispatch(command)
    try {
      const network = await getNetworkService()
      if (command.kind === 'employee_invoke') {
        const snapshot = await service.getSnapshot()
        const publication = snapshot.employees.find((item) => item.employeeId === command.employeeId)
        if (publication && publication.ownerDeviceId !== 'local') {
          await network.publishRemoteInvocation(
            publication,
            result as LocalCollaborationSnapshot['invocations'][number]
          )
        }
      } else if (command.kind === 'employee_interrupt' && interrupted && interruptedPublication && interruptedPublication.ownerDeviceId !== 'local') {
        await network.publishRemoteControl(interruptedPublication, interrupted, 'interrupt')
      } else {
        await network.publishLocalCommand(command)
      }
    } catch (cause) {
      const status = await getNetworkService().then((network) => network.getStatus()).catch(() => null)
      if (status?.state !== 'disabled') throw cause
    }
    return result
  })
  ipcMain.handle('collaboration:network-status', async (): Promise<CollaborationNetworkStatus> => {
    try {
      return await (await getNetworkService()).getStatus()
    } catch (cause) {
      return {
        state: 'error',
        e2eeState: 'blocked',
        protocol: 1,
        transport: 'tls13-spki',
        encryption: 'rfc9420-openmls',
        error: cause instanceof Error ? cause.message : String(cause)
      }
    }
  })
  ipcMain.handle('collaboration:network-dispatch', async (_event, command: CollaborationNetworkCommand) => {
    if (command.kind === 'network_local_server_start') return localServer.start()
    if (command.kind === 'network_local_server_stop') return localServer.stop()
    const network = await getNetworkService()
    const result = await network.dispatch(command)
    if (command.kind === 'network_sync') {
      await inspectRemoteInvocations(network, service, command.meetingId)
    }
    return result
  })
  app.once('before-quit', () => { void localServer.stop() })
}

async function inspectRemoteInvocations(
  network: CollaborationNetworkService,
  service: LocalCollaborationService,
  meetingId: string
): Promise<void> {
  const snapshot = await service.getSnapshot()
  for (const invocation of snapshot.invocations) {
    if (invocation.meetingId !== meetingId || invocation.status !== 'running') continue
    const publication = snapshot.employees.find((item) => item.employeeId === invocation.employeeId)
    if (publication && publication.ownerDeviceId !== 'local') {
      await network.publishRemoteControl(publication, invocation, 'inspect')
    }
  }
}

async function createNetworkService(
  userData: string,
  projection: LocalCollaborationService,
  gateway: ReceptionInvocationGateway
): Promise<CollaborationNetworkService> {
  const directory = join(userData, 'collaboration-network')
  const identity = new IdentityVault({
    path: join(directory, 'identity.json'),
    safeStorage
  })
  const device = await identity.loadOrCreate()
  const stateKey = createHash('sha256')
    .update(Buffer.from(device.signingPrivateKey, 'base64'))
    .digest()
  const membership = new MlsMembershipDriver({
    path: join(directory, 'mls-membership.json'),
    adapter: MlsAdapter.load(resolveCollaborationCryptoPath()),
    stateKey
  })
  const taskKeys = await TaskKeyService.open(join(directory, 'task-keys.json'), stateKey)
  const remote = new RemoteInvocationCoordinator({
    deviceId: device.deviceId,
    memberId: device.memberId,
    crypto: taskKeys,
    snapshot: () => projection.getSnapshot(),
    gateway,
    applyResponse: (response) => projection.applyRemoteInvocationResponse(response)
  })
  return new CollaborationNetworkService({
    identity,
    vault: new NetworkCredentialVault({
      path: join(directory, 'credentials.json'),
      safeStorage
    }),
    http: new CollaborationHttpClient({
      pins: new ServerPinStore(join(directory, 'server-pins.json'))
    }),
    security: new MlsNetworkSecurity({
      membership,
      syncPath: join(directory, 'sync-state.json')
    }),
    projection: { apply: (command) => projection.dispatch(command) },
    remote
  })
}

function resolveCollaborationCryptoPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'collaboration', 'kun-collab-crypto.node')
  }
  return join(
    process.cwd(),
    'native',
    'kun-collab-crypto',
    'prebuilds',
    `${process.platform}-${process.arch}`,
    'kun-collab-crypto.node'
  )
}

function resolveCollaborationServerPath(): string {
  const executable = `kun-collab-server${process.platform === 'win32' ? '.exe' : ''}`
  if (app.isPackaged) return join(process.resourcesPath, 'collaboration', executable)
  return join(
    process.cwd(),
    'native',
    'kun-collab-server',
    'prebuilds',
    `${process.platform}-${process.arch}`,
    executable
  )
}
