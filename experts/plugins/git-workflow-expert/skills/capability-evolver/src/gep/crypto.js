// AES-256-GCM symmetric encryption for sealed / privacy computing blobs.
// Keys are generated locally and never leave the client.

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Generate a random 256-bit key.
 * @returns {Buffer}
 */
function generateKey() {
  return crypto.randomBytes(KEY_BYTES);
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * @param {Buffer|string} plaintext
 * @param {Buffer} key - 32-byte key
 * @returns {{ ciphertext: Buffer, iv: Buffer, authTag: Buffer }}
 */
function encrypt(plaintext, key) {
  if (!key || key.length !== KEY_BYTES) {
    throw new Error('crypto: key must be exactly 32 bytes');
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const input = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: encrypted, iv, authTag };
}

/**
 * Decrypt ciphertext with AES-256-GCM.
 * @param {Buffer} ciphertext
 * @param {Buffer} key - 32-byte key
 * @param {Buffer} iv - 12-byte IV
 * @param {Buffer} authTag - 16-byte auth tag
 * @returns {Buffer} plaintext
 */
function decrypt(ciphertext, key, iv, authTag) {
  if (!key || key.length !== KEY_BYTES) {
    throw new Error('crypto: key must be exactly 32 bytes');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Pack ciphertext + iv + authTag into a single buffer for transport.
 * Layout: [iv (12)] [authTag (16)] [ciphertext (...)]
 * @param {{ ciphertext: Buffer, iv: Buffer, authTag: Buffer }} parts
 * @returns {Buffer}
 */
function pack(parts) {
  return Buffer.concat([parts.iv, parts.authTag, parts.ciphertext]);
}

/**
 * Unpack a buffer produced by pack().
 * @param {Buffer} packed
 * @returns {{ ciphertext: Buffer, iv: Buffer, authTag: Buffer }}
 */
function unpack(packed) {
  if (!Buffer.isBuffer(packed) || packed.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('crypto: packed buffer too short');
  }
  const iv = packed.subarray(0, IV_BYTES);
  const authTag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES);
  return { ciphertext, iv, authTag };
}

module.exports = {
  ALGORITHM,
  KEY_BYTES,
  IV_BYTES,
  TAG_BYTES,
  generateKey,
  encrypt,
  decrypt,
  pack,
  unpack,
};
