/** A rejected conditional write; this error proves no mutation was committed. */
export class ThreadRevisionConflict extends Error {
  constructor(readonly revision: number) {
    super('REVISION_CONFLICT')
  }
}
