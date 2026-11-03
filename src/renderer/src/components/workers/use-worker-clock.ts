import { useEffect, useState } from 'react'

/** Wall clock that ticks once a second only while something is live. */
export function useWorkerClock(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!live) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [live])
  return now
}
