/**
 * Ask the user to look at Kun while it is in the background: a system
 * notification (once per key), a Dock bounce / taskbar flash, and a count
 * added on top of the renderer's app badge. Sending `badge: 0` clears it.
 */
export type UserAttentionRequest = {
  /** Stable id of the thing waiting; a notification is shown once per key. */
  key: string
  title: string
  body: string
  /** Items waiting for the user, added to the app badge. */
  badge: number
}

export const USER_ATTENTION_CHANNEL = 'app:user-attention'
