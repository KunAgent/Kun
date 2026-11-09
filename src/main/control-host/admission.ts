let accepting = true
let active = 0
export function admitControlOperation(): () => void {
  if (!accepting) throw Error('CONTROL_UPDATING')
  active++
  let released = false
  return () => { if (!released) { released = true; active-- } }
}
export function pauseControlAdmission(): boolean {
  accepting = false
  if (active) { accepting = true; return false }
  return true
}
export function resumeControlAdmission() { accepting = true }
export function closeControlAdmission() { accepting = false }
