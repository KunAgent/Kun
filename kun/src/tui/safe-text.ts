import { redactSecretText } from '../config/secret-redaction.js'
import { sanitizeTerminalText as stripTerminalControls } from './layout.js'

// Runtime/model/tool strings are untrusted terminal input. Apply both secret
// redaction and control-sequence stripping at the display boundary so every
// component, page, notification, and clipboard path gets the same policy.
export const sanitizeTerminalText = (value: string): string =>
  stripTerminalControls(redactSecretText(value))
