import type SharpModule from 'sharp'

type Sharp = typeof SharpModule

let sharpModule: Promise<Sharp> | undefined

/**
 * sharp loads libvips (tens of MB of native code) on import. Only image
 * features need it, so the main process loads it on first use.
 */
export function loadSharp(): Promise<Sharp> {
  sharpModule ??= import('sharp').then(
    (module) => ((module as { default?: Sharp }).default ?? module) as Sharp,
    (error: unknown) => {
      sharpModule = undefined
      throw error
    }
  )
  return sharpModule
}
