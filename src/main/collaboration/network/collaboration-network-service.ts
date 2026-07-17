import { createHash, randomUUID } from 'node:crypto'
import type { InvitationBundle } from '@kun/collaboration-protocol'
import { z } from 'zod'
import {
  CollaborationNetworkCommandSchema,
  CollaborationNetworkStatusSchema,
  CollaborationRemoteInvocationPayloadSchema,
  HumanCollaborationCommandSchema,
  type CollaborationEncryptedCommand,
  type CollaborationNetworkCommand,
  type CollaborationNetworkStatus,
  type CollaborationRemoteInvocationPayload,
  type EmployeeInvocation,
  type HumanCollaborationCommand,
  type ReceptionEmployeePublication
} from '../../../shared/collaboration/contracts'
import type { DeviceIdentity } from '../identity-vault-file'
import type { CollaborationHttpClient, PendingJoinRequest } from './collaboration-transport'
import type {
  NetworkCredential,
  NetworkCredentialSummary,
  NetworkCredentialVault
} from './network-credential-vault'

type IdentityPort = { loadOrCreate(): Promise<Pick<DeviceIdentity, 'memberId' | 'deviceId'>> }
type CredentialVaultPort = Pick<NetworkCredentialVault, 'put' | 'get' | 'list'>
type HttpPort = Pick<
  CollaborationHttpClient,
  'connect' | 'enrollOperator' | 'createMeeting' | 'createInvitation' | 'consumeInvitation' |
  'listEvents' | 'listJoinRequests' | 'admitJoinRequest' | 'getAdmission' | 'removeMember' | 'submitCommand'
>
type SecurityPort = {
  createOwnerMeeting(meetingId: string, identity: Pick<DeviceIdentity, 'memberId' | 'deviceId'>): Promise<void>
  prepareJoin(meetingId: string, invitationId: string, memberId: string): Promise<{ keyPackage: string }>
  completeJoin(invitationId: string, welcome: string, ratchetTree: string): Promise<void>
  approveJoin(meetingId: string, keyPackage: string): Promise<{
    commit: string
    welcome: string
    ratchetTree: string
    epoch: number
  }>
  removeMember(meetingId: string, memberId: string): Promise<{ commit: string; epoch: number }>
  membershipStatus(): Promise<{
    meetingId: string
    invitationId?: string
    role: 'owner' | 'member'
    state: 'pending_membership' | 'ready'
  } | null>
  sealCommand(meetingId: string, command: HumanCollaborationCommand): Promise<{ ciphertext: string; epoch: number }>
  sealPayload(meetingId: string, payload: CollaborationEncryptedCommand): Promise<{ ciphertext: string; epoch: number }>
  acceptOwnFrame(input: {
    meetingId: string
    frame: { epoch: number; frameKind: 'mls_application' | 'mls_commit'; ciphertext: string; ciphertextSha256: string }
    receipt: unknown
    credential: NetworkCredential
  }): Promise<void>
  syncMeeting(input: {
    meetingId: string
    events: unknown[]
    credential: NetworkCredential
  }): Promise<{
    state: 'ready' | 'SECURITY_SYNC_REQUIRED'
    lastVerifiedSequence: number
    commands: CollaborationEncryptedCommand[]
  }>
}

const DISABLED: CollaborationNetworkStatus = {
  state: 'disabled',
  e2eeState: 'setup_required',
  protocol: 1,
  transport: 'tls13-spki',
  encryption: 'rfc9420-openmls'
}

export class CollaborationNetworkService {
  private status: CollaborationNetworkStatus = DISABLED

  constructor(private readonly options: {
    identity: IdentityPort
    vault: CredentialVaultPort
    http: HttpPort
    security: SecurityPort
    projection?: { apply(command: HumanCollaborationCommand): Promise<unknown> }
    remote?: {
      publicKey(): Promise<string>
      createRequest(publication: ReceptionEmployeePublication, invocation: EmployeeInvocation): Promise<CollaborationRemoteInvocationPayload>
      createControlRequest(
        publication: ReceptionEmployeePublication,
        invocation: EmployeeInvocation,
        action: 'inspect' | 'interrupt'
      ): Promise<CollaborationRemoteInvocationPayload>
      handle(payload: CollaborationRemoteInvocationPayload): Promise<CollaborationRemoteInvocationPayload | null>
    }
  }) {}

  async getStatus(): Promise<CollaborationNetworkStatus> {
    if (this.status.state !== 'disabled') return CollaborationNetworkStatusSchema.parse(this.status)
    const first = (await this.options.vault.list())[0]
    if (!first) return DISABLED
    const membership = await this.options.security.membershipStatus()
    this.status = {
      ...statusFromCredential(first, membership?.state ?? 'setup_required'),
      ...(membership ? { activeMeetingId: membership.meetingId } : {}),
      ...(membership?.invitationId ? { pendingInvitationId: membership.invitationId } : {})
    }
    return CollaborationNetworkStatusSchema.parse(this.status)
  }

  async dispatch(input: CollaborationNetworkCommand): Promise<unknown> {
    const command = CollaborationNetworkCommandSchema.parse(input)
    this.status = { ...await this.getStatus(), state: 'connecting', error: undefined }
    try {
      switch (command.kind) {
        case 'network_local_server_start':
        case 'network_local_server_stop':
          throw new Error('Built-in Collaboration server commands must be handled by the Electron host')
        case 'network_operator_enroll':
          return await this.enrollOperator(command)
        case 'network_meeting_enable':
          return await this.enableMeeting(command.meetingId)
        case 'network_invitation_create':
          return await this.createInvitation(command)
        case 'network_invitation_join':
          return await this.joinInvitation(command.invitation, command.displayName)
        case 'network_join_requests':
          return await this.listJoinRequests(command.meetingId)
        case 'network_join_approve':
          return await this.approveJoin(command.meetingId, command.invitationId)
        case 'network_member_remove':
          return await this.removeMember(command.meetingId, command.memberId)
        case 'network_join_refresh':
          return await this.refreshJoin(command.meetingId, command.invitationId)
        case 'network_sync':
          return await this.sync(command.meetingId)
      }
    } catch (cause) {
      this.status = {
        ...this.status,
        state: 'error',
        error: cause instanceof Error ? cause.message : String(cause)
      }
      throw cause
    }
  }

  async publishLocalCommand(input: HumanCollaborationCommand): Promise<void> {
    const command = HumanCollaborationCommandSchema.parse(input)
    const meetingIds = commandMeetingIds(command)
    if (meetingIds.length === 0) return
    await this.getStatus()
    if (this.status.e2eeState !== 'ready') return
    const credential = await this.requireCredential()
    const networkCommand = command.kind === 'employee_publish'
      ? HumanCollaborationCommandSchema.parse({
          ...command,
          ownerDeviceId: credential.deviceId,
          ...(this.options.remote ? { ownerEncryptionPublicKey: await this.options.remote.publicKey() } : {})
        })
      : command
    for (const meetingId of meetingIds) {
      if (this.status.activeMeetingId !== meetingId) continue
      await this.sync(meetingId)
      if (this.status.state !== 'ready') throw new Error('Network Collaboration is not writable')
      const encrypted = await this.options.security.sealCommand(meetingId, networkCommand)
      await this.submitEncryptedFrame({
        credential,
        meetingId,
        commandId: command.commandId,
        epoch: encrypted.epoch,
        frameKind: 'mls_application',
        ciphertext: encrypted.ciphertext
      })
    }
  }

  async publishRemoteInvocation(
    publication: ReceptionEmployeePublication,
    invocation: EmployeeInvocation
  ): Promise<void> {
    if (!this.options.remote || !invocation.meetingId) throw new Error('Remote employee transport is unavailable')
    await this.getStatus()
    if (this.status.e2eeState !== 'ready' || this.status.activeMeetingId !== invocation.meetingId) {
      throw new Error('Remote employee meeting is not ready for E2EE')
    }
    const payload = await this.options.remote.createRequest(publication, invocation)
    await this.publishEncryptedPayload(invocation.meetingId, payload)
  }

  async publishRemoteControl(
    publication: ReceptionEmployeePublication,
    invocation: EmployeeInvocation,
    action: 'inspect' | 'interrupt'
  ): Promise<void> {
    if (!this.options.remote || !invocation.meetingId) throw new Error('Remote employee transport is unavailable')
    const payload = await this.options.remote.createControlRequest(publication, invocation, action)
    await this.publishEncryptedPayload(invocation.meetingId, payload)
  }

  private async enrollOperator(
    command: Extract<CollaborationNetworkCommand, { kind: 'network_operator_enroll' }>
  ): Promise<CollaborationNetworkStatus> {
    const identity = await this.options.identity.loadOrCreate()
    const server = await this.options.http.connect(command.serverUrl)
    const device = await this.options.http.enrollOperator({
      serverUrl: server.serverUrl,
      enrollmentToken: command.enrollmentToken,
      memberId: identity.memberId,
      deviceId: identity.deviceId,
      displayName: command.displayName
    })
    const credential: NetworkCredential = {
      ...server,
      memberId: device.memberId,
      deviceId: device.deviceId,
      displayName: command.displayName,
      accessToken: device.accessToken
    }
    await this.options.vault.put(credential)
    this.status = statusFromCredential(credential, 'setup_required')
    return CollaborationNetworkStatusSchema.parse(this.status)
  }

  private async enableMeeting(meetingId: string): Promise<CollaborationNetworkStatus> {
    const credential = await this.requireCredential()
    const identity = await this.options.identity.loadOrCreate()
    await this.options.http.createMeeting({
      serverUrl: credential.serverUrl,
      accessToken: credential.accessToken,
      meetingId
    })
    await this.options.security.createOwnerMeeting(meetingId, identity)
    this.status = {
      ...statusFromCredential(credential, 'ready'),
      activeMeetingId: meetingId,
      lastVerifiedSequence: 0
    }
    return CollaborationNetworkStatusSchema.parse(this.status)
  }

  private async createInvitation(
    command: Extract<CollaborationNetworkCommand, { kind: 'network_invitation_create' }>
  ): Promise<InvitationBundle> {
    const credential = await this.requireCredential()
    const invitation = await this.options.http.createInvitation({
      serverUrl: credential.serverUrl,
      accessToken: credential.accessToken,
      meetingId: command.meetingId,
      role: command.role,
      expiresInSeconds: command.expiresInSeconds
    })
    this.status = { ...statusFromCredential(credential, 'ready'), activeMeetingId: command.meetingId }
    return invitation
  }

  private async joinInvitation(invitation: InvitationBundle, displayName: string): Promise<CollaborationNetworkStatus> {
    const identity = await this.options.identity.loadOrCreate()
    const prepared = await this.options.security.prepareJoin(invitation.meetingId, invitation.invitationId, identity.memberId)
    const server = await this.options.http.connect(invitation.serverUrl, invitation)
    const device = await this.options.http.consumeInvitation({
      invitation,
      memberId: identity.memberId,
      deviceId: identity.deviceId,
      displayName,
      keyPackage: prepared.keyPackage
    })
    const credential: NetworkCredential = {
      ...server,
      memberId: device.memberId,
      deviceId: device.deviceId,
      displayName,
      accessToken: device.accessToken
    }
    await this.options.vault.put(credential)
    this.status = {
      ...statusFromCredential(credential, 'pending_membership'),
      activeMeetingId: invitation.meetingId,
      pendingInvitationId: invitation.invitationId
    }
    return CollaborationNetworkStatusSchema.parse(this.status)
  }

  private async listJoinRequests(meetingId: string): Promise<PendingJoinRequest[]> {
    const credential = await this.requireCredential()
    const requests = await this.options.http.listJoinRequests({
      serverUrl: credential.serverUrl,
      accessToken: credential.accessToken,
      meetingId
    })
    this.status = { ...statusFromCredential(credential, 'ready'), activeMeetingId: meetingId }
    return requests
  }

  private async approveJoin(meetingId: string, invitationId: string): Promise<CollaborationNetworkStatus> {
    const credential = await this.requireCredential()
    const requests = await this.options.http.listJoinRequests({
      serverUrl: credential.serverUrl,
      accessToken: credential.accessToken,
      meetingId
    })
    const request = requests.find((item) => item.invitationId === invitationId)
    if (!request) throw new Error('Pending MLS join request was not found')
    await this.sync(meetingId)
    if (this.status.state !== 'ready') throw new Error('Network Collaboration is not writable')
    const admission = await this.options.security.approveJoin(meetingId, request.keyPackage)
    const receipt = await this.submitEncryptedFrame({
      credential,
      meetingId,
      commandId: randomUUID(),
      epoch: admission.epoch,
      frameKind: 'mls_commit',
      ciphertext: admission.commit
    })
    await this.options.http.admitJoinRequest({
      serverUrl: credential.serverUrl,
      accessToken: credential.accessToken,
      meetingId,
      invitationId,
      welcome: admission.welcome,
      ratchetTree: admission.ratchetTree,
      throughSequence: receipt.sequence
    })
    const memberCommand = HumanCollaborationCommandSchema.parse({
      kind: 'meeting_member_upsert',
      commandId: randomUUID(),
      meetingId,
      memberId: request.memberId,
      displayName: request.displayName,
      role: request.role,
      status: 'online'
    })
    await this.options.projection?.apply(memberCommand)
    await this.publishEncryptedPayload(meetingId, memberCommand)
    this.status = { ...statusFromCredential(credential, 'ready'), activeMeetingId: meetingId }
    return CollaborationNetworkStatusSchema.parse(this.status)
  }

  private async refreshJoin(meetingId: string, invitationId: string): Promise<CollaborationNetworkStatus> {
    const credential = await this.requireCredential()
    const admission = await this.options.http.getAdmission({
      serverUrl: credential.serverUrl,
      accessToken: credential.accessToken,
      invitationId
    })
    if (admission.status === 'pending' || !admission.welcome || !admission.ratchetTree) {
      this.status = {
        ...statusFromCredential(credential, 'pending_membership'),
        activeMeetingId: meetingId,
        pendingInvitationId: invitationId
      }
      return CollaborationNetworkStatusSchema.parse(this.status)
    }
    await this.options.security.completeJoin(invitationId, admission.welcome, admission.ratchetTree)
    this.status = {
      ...statusFromCredential(credential, 'ready'),
      activeMeetingId: meetingId,
      lastVerifiedSequence: admission.throughSequence
    }
    return CollaborationNetworkStatusSchema.parse(this.status)
  }

  private async removeMember(meetingId: string, memberId: string): Promise<CollaborationNetworkStatus> {
    const credential = await this.requireCredential()
    if (credential.memberId === memberId) throw new Error('A member cannot remove its own active identity')
    await this.sync(meetingId)
    if (this.status.state !== 'ready') throw new Error('Network Collaboration is not writable')
    const removal = await this.options.security.removeMember(meetingId, memberId)
    await this.submitEncryptedFrame({
      credential,
      meetingId,
      commandId: randomUUID(),
      epoch: removal.epoch,
      frameKind: 'mls_commit',
      ciphertext: removal.commit
    })
    await this.options.http.removeMember({
      serverUrl: credential.serverUrl,
      accessToken: credential.accessToken,
      meetingId,
      memberId
    })
    const projectionCommand = HumanCollaborationCommandSchema.parse({
      kind: 'meeting_member_remove', commandId: randomUUID(), meetingId, memberId
    })
    await this.options.projection?.apply(projectionCommand)
    await this.publishEncryptedPayload(meetingId, projectionCommand)
    this.status = { ...statusFromCredential(credential, 'ready'), activeMeetingId: meetingId }
    return CollaborationNetworkStatusSchema.parse(this.status)
  }

  private async sync(meetingId: string): Promise<CollaborationNetworkStatus> {
    const credential = await this.requireCredential()
    const after = this.status.activeMeetingId === meetingId ? this.status.lastVerifiedSequence ?? 0 : 0
    const events = await this.options.http.listEvents({
      serverUrl: credential.serverUrl,
      accessToken: credential.accessToken,
      meetingId,
      after
    })
    const result = await this.options.security.syncMeeting({ meetingId, events, credential })
    this.status = {
      ...statusFromCredential(credential, result.state === 'ready' ? 'ready' : 'blocked'),
      state: result.state,
      activeMeetingId: meetingId,
      lastVerifiedSequence: result.lastVerifiedSequence
    }
    for (const command of result.commands) {
      if (command.kind === 'remote_employee_request' || command.kind === 'remote_employee_response') {
        const response = await this.options.remote?.handle(CollaborationRemoteInvocationPayloadSchema.parse(command))
        if (response) await this.publishEncryptedPayload(meetingId, response)
      } else {
        await this.options.projection?.apply(HumanCollaborationCommandSchema.parse(command))
      }
    }
    return CollaborationNetworkStatusSchema.parse(this.status)
  }

  private async publishEncryptedPayload(meetingId: string, payload: CollaborationEncryptedCommand): Promise<void> {
    const credential = await this.requireCredential()
    const encrypted = await this.options.security.sealPayload(meetingId, payload)
    await this.submitEncryptedFrame({
      credential,
      meetingId,
      commandId: payload.commandId,
      epoch: encrypted.epoch,
      frameKind: 'mls_application',
      ciphertext: encrypted.ciphertext
    })
  }

  private async submitEncryptedFrame(input: {
    credential: NetworkCredential
    meetingId: string
    commandId: string
    epoch: number
    frameKind: 'mls_application' | 'mls_commit'
    ciphertext: string
  }): Promise<{ sequence: number }> {
    const ciphertextSha256 = createHash('sha256').update(Buffer.from(input.ciphertext, 'base64')).digest('hex')
    const command = {
      meetingId: input.meetingId,
      commandId: input.commandId,
      memberId: input.credential.memberId,
      expectedVersion: this.status.lastVerifiedSequence ?? 0,
      epoch: input.epoch,
      frameKind: input.frameKind,
      ciphertext: input.ciphertext,
      ciphertextSha256
    }
    const rawReceipt = await this.options.http.submitCommand({
      serverUrl: input.credential.serverUrl,
      accessToken: input.credential.accessToken,
      meetingId: input.meetingId,
      command
    })
    const receipt = z.object({ sequence: z.number().int().positive() }).passthrough().parse(
      rawReceipt
    )
    await this.options.security.acceptOwnFrame({
      meetingId: input.meetingId,
      frame: {
        epoch: input.epoch,
        frameKind: input.frameKind,
        ciphertext: input.ciphertext,
        ciphertextSha256
      },
      receipt: rawReceipt,
      credential: input.credential
    })
    this.status = { ...this.status, lastVerifiedSequence: receipt.sequence }
    return receipt
  }

  private async requireCredential(): Promise<NetworkCredential> {
    const currentUrl = this.status.serverUrl
    const summary = currentUrl
      ? { serverUrl: currentUrl }
      : (await this.options.vault.list())[0]
    if (!summary) throw new Error('Network Collaboration server is not configured')
    const credential = await this.options.vault.get(summary.serverUrl)
    if (!credential) throw new Error('Network Collaboration credentials are unavailable')
    return credential
  }
}

function commandMeetingIds(command: HumanCollaborationCommand): string[] {
  if (command.kind === 'employee_publish') return command.meetingIds
  if ('meetingId' in command && command.meetingId) return [command.meetingId]
  return []
}

function statusFromCredential(
  credential: NetworkCredentialSummary,
  e2eeState: CollaborationNetworkStatus['e2eeState']
): CollaborationNetworkStatus {
  return {
    state: 'ready',
    e2eeState,
    serverUrl: credential.serverUrl,
    serverInstanceId: credential.serverInstanceId,
    memberId: credential.memberId,
    deviceId: credential.deviceId,
    protocol: 1,
    transport: 'tls13-spki',
    encryption: 'rfc9420-openmls'
  }
}
