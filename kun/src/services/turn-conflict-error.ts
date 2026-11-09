// Admission helpers are also imported before TurnService installs its mixins.
// Keep the shared conflict identity independent of that installation cycle.
export class TurnConflictError extends Error {}
