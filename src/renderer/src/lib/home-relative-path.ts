/** A file path for display with the user's home folder shown as `~` (macOS, Linux and Windows layouts). */
export function homeRelativePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/i, '~')
}
