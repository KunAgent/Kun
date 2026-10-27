import { FIGMA_DEFAULT_DEPTH } from './ports.js'
import type { FigmaImageFormat } from './ports.js'
import { assertFigmaFileKey } from './figma-link.js'
import { FigmaRestTransport } from './figma-transport.js'

/** Wire shapes are intentionally loose: Figma adds fields between API revisions. */
export type FigmaFilePayload = {
  name?: unknown
  lastModified?: unknown
  version?: unknown
  role?: unknown
  document?: unknown
}

export type FigmaNodesPayload = {
  nodes?: unknown
}

export type FigmaImagesPayload = {
  err?: unknown
  images?: unknown
}

export type FigmaMePayload = {
  id?: unknown
  handle?: unknown
  email?: unknown
}

/** Thin endpoint layer over the fenced transport; one request per call. */
export class FigmaRestClient {
  constructor(private readonly transport: FigmaRestTransport) {}

  /** Identity check for the connection surface; never exposed as a model tool. */
  async getMe(options: { token: string }): Promise<FigmaMePayload> {
    return await this.transport.getJson({ path: '/v1/me', token: options.token }) as FigmaMePayload
  }

  async getFile(fileKey: string, options: { token: string; depth?: number }): Promise<FigmaFilePayload> {
    const params = new URLSearchParams({ depth: String(options.depth ?? FIGMA_DEFAULT_DEPTH) })
    return await this.transport.getJson({
      path: `/v1/files/${assertFigmaFileKey(fileKey)}`,
      params,
      token: options.token
    }) as FigmaFilePayload
  }

  /** Node subtree is bounded by the response byte budget, not by a depth cut. */
  async getNodes(fileKey: string, options: { token: string; nodeIds: readonly string[] }): Promise<FigmaNodesPayload> {
    const params = new URLSearchParams({ ids: options.nodeIds.join(',') })
    return await this.transport.getJson({
      path: `/v1/files/${assertFigmaFileKey(fileKey)}/nodes`,
      params,
      token: options.token
    }) as FigmaNodesPayload
  }

  async getImages(
    fileKey: string,
    options: { token: string; nodeIds: readonly string[]; format: FigmaImageFormat; scale: number }
  ): Promise<FigmaImagesPayload> {
    const params = new URLSearchParams({
      ids: options.nodeIds.join(','),
      format: options.format,
      scale: String(options.scale)
    })
    return await this.transport.getJson({
      path: `/v1/images/${assertFigmaFileKey(fileKey)}`,
      params,
      token: options.token
    }) as FigmaImagesPayload
  }
}
