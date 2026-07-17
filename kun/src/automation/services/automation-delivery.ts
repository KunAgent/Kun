import type { AutomationTask, DigitalEmployee } from '../contracts/automation-types.js'

/**
 * Automation Delivery Adapter
 *
 * Encapsulates the side-effect of "sending" a completed task's output through
 * the employee's channel (mail, social). The default implementation is a safe
 * no-op that records intent; real channel integrations (SMTP, IM webhooks)
 * register concrete senders per employee type.
 *
 * The policy engine decides *whether* to send (decision.kind === 'send'); this
 * adapter performs the send and returns a delivery receipt so the runtime can
 * record it on the task.
 */

export type DeliveryReceipt = {
  delivered: boolean
  channel: string
  detail?: string
}

export interface ChannelSender {
  /** Channel identifier, e.g. 'mail' | 'social'. */
  readonly channel: string
  send(input: {
    employee: DigitalEmployee
    task: AutomationTask
    output: string
  }): Promise<DeliveryReceipt>
}

export class AutomationDeliveryAdapter {
  private readonly senders = new Map<string, ChannelSender>()

  constructor(senders: ChannelSender[] = []) {
    for (const sender of senders) {
      this.senders.set(sender.channel, sender)
    }
  }

  register(sender: ChannelSender): void {
    this.senders.set(sender.channel, sender)
  }

  hasSender(channel: string): boolean {
    return this.senders.has(channel)
  }

  /**
   * Deliver a task's output through the employee's channel. When no sender is
   * registered for the employee type, returns a non-delivered receipt instead
   * of throwing — the caller decides whether that downgrades to a draft.
   */
  async deliver(input: {
    employee: DigitalEmployee
    task: AutomationTask
    output: string
  }): Promise<DeliveryReceipt> {
    const channel = input.employee.type
    const sender = this.senders.get(channel)
    if (!sender) {
      return { delivered: false, channel, detail: `no sender registered for channel '${channel}'` }
    }
    // Hard safety rail: external send must be explicitly allowed on the employee.
    if (!input.employee.autoReplyPolicy.allowExternalSend && input.task.actionLevel === 'external_send') {
      return { delivered: false, channel, detail: 'external send not permitted by employee policy' }
    }
    return sender.send(input)
  }
}
