import { canonicalProjectIdentity } from '../../kun/src/shared/project-identity.js'
import type { AdeProjectIdentity } from '../shared/ade-project-defaults'

export const canonicalAdeProjectIdentity: (projectPath: string) => Promise<AdeProjectIdentity> =
  canonicalProjectIdentity
