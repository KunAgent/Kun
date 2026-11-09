/** Installation-wide, across cloud/direct hosts and the local outgoing viewer. */
export class DesktopActivityGate {
  private owner?: { key: string; direction: 'incoming' | 'outgoing' }
  claim(key: string, direction: 'incoming' | 'outgoing') {
    if (this.owner && this.owner.key !== key) throw Error('DESKTOP_BUSY')
    this.owner = { key, direction }
  }
  release(key: string) { if (this.owner?.key === key) this.owner = undefined }
  busy() { return Boolean(this.owner) }
  outgoing() { return this.owner?.direction === 'outgoing' }
}
export const desktopActivityGate = new DesktopActivityGate()
