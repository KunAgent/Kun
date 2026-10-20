/**
 * Fence high-water maps keep only resources and threads that still hold a
 * lease. Retired entries collapse into one floor stored under this key, so a
 * re-acquired name still receives a token above any token it ever issued.
 * The key cannot be a resource name or thread id, and an older Manager that
 * reads it treats it as an idle resource, so the file stays readable both ways.
 */
export const FENCE_FLOOR_KEY = '\u0000fence-floor'
