import { useEffect, useState, type RefObject } from 'react'
import type { PetSurfaceSize } from './pet-layout'

export function usePetSurfaceSize(ref: RefObject<HTMLDivElement | null>, enabled: boolean, initial: PetSurfaceSize): PetSurfaceSize {
  const [size, setSize] = useState(initial)
  useEffect(() => {
    const element = ref.current
    if (!enabled || !element) return
    const read = (): void => {
      const rect = element.getBoundingClientRect()
      const width = Math.ceil(rect.width), height = Math.ceil(rect.height)
      setSize((current) => current.width === width && current.height === height ? current : { width, height })
    }
    const observer = new ResizeObserver(read)
    observer.observe(element)
    read()
    return () => observer.disconnect()
  }, [ref, enabled])
  return size
}
