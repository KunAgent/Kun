/** The same gate protects remote human input and the GUI computer-use bridge. */
export class DesktopInputArbiter {
  private human?: string
  private ai = 0
  acquire(session: string) {
    if (this.ai || this.human && this.human !== session) throw new Error('DESKTOP_BUSY')
    this.human = session
  }
  release(session: string) { if (this.human === session) this.human = undefined }
  owns(session: string) { return this.human === session }
  beginAi() {
    if (this.human) throw new Error('HUMAN_CONTROL_ACTIVE')
    this.ai++
    let active = true
    return () => { if (active) { active = false; this.ai-- } }
  }
}
export const desktopInputArbiter = new DesktopInputArbiter()
