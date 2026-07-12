import { isAbsolute, relative, sep } from 'node:path'

type PathOperations = {
  readonly sep: string
  relative(from: string, to: string): string
  isAbsolute(path: string): boolean
}

const nativePath: PathOperations = { sep, relative, isAbsolute }

/** Return true only when `candidate` is a strict descendant of `root`. */
export function isPathBelowDirectory(
  root: string,
  candidate: string,
  path: PathOperations = nativePath
): boolean {
  const child = path.relative(root, candidate)
  return child !== '' &&
    child !== '..' &&
    !child.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(child)
}
