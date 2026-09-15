/*
 * Kun Remote insecure-context polyfills. Plain HTTP on a LAN is not a "secure
 * context", so browsers disable crypto.randomUUID, crypto.subtle, the async
 * clipboard and getUserMedia there. Install safe fallbacks before app code
 * runs. Inside a secure context (Electron, HTTPS, localhost) everything here
 * is a no-op because the real APIs already exist.
 */
(function installKunRemotePolyfills() {
  if (typeof window === 'undefined') return

  installPolyfills()

  function installPolyfills() {
  try { installCryptoPolyfills() } catch { /* best-effort */ }
  try { installClipboardPolyfill() } catch { /* best-effort */ }
  try {
    // Microphone capture needs a secure context; fail with a readable error.
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      var unavailable = function () {
        return Promise.reject(new Error('Microphone requires HTTPS or the desktop app'))
      }
      navigator.mediaDevices = navigator.mediaDevices || {}
      navigator.mediaDevices.getUserMedia = unavailable
      navigator.mediaDevices.enumerateDevices =
        navigator.mediaDevices.enumerateDevices || function () { return Promise.resolve([]) }
    }
  } catch { /* best-effort */ }
}

function installCryptoPolyfills() {
  var cryptoObject = window.crypto
  if (!cryptoObject) return
  if (typeof cryptoObject.randomUUID !== 'function') {
    cryptoObject.randomUUID = function randomUUID() {
      var bytes = new Uint8Array(16)
      if (typeof cryptoObject.getRandomValues === 'function') {
        cryptoObject.getRandomValues(bytes)
      } else {
        for (var i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
      }
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      var hex = []
      for (var j = 0; j < 16; j += 1) hex.push((bytes[j] + 0x100).toString(16).slice(1))
      return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
        hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10).join('')
    }
  }
  if (cryptoObject.subtle && typeof cryptoObject.subtle.digest === 'function') return
  cryptoObject.subtle = {
    digest: function (algorithm, data) {
      var name = typeof algorithm === 'string' ? algorithm : (algorithm && algorithm.name) || ''
      if (name.toUpperCase() !== 'SHA-256') {
        return Promise.reject(new Error('Only SHA-256 digests are supported in Remote web mode'))
      }
      var bytes = null
      if (data instanceof ArrayBuffer) bytes = new Uint8Array(data)
      else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      if (!bytes) return Promise.reject(new TypeError('Unsupported digest input'))
      return Promise.resolve(sha256ArrayBuffer(bytes))
    },
    importKey: unavailableCrypto('importKey'),
    exportKey: unavailableCrypto('exportKey'),
    sign: unavailableCrypto('sign'),
    verify: unavailableCrypto('verify'),
    encrypt: unavailableCrypto('encrypt'),
    decrypt: unavailableCrypto('decrypt'),
    deriveKey: unavailableCrypto('deriveKey'),
    deriveBits: unavailableCrypto('deriveBits'),
    generateKey: unavailableCrypto('generateKey'),
    unwrapKey: unavailableCrypto('unwrapKey'),
    wrapKey: unavailableCrypto('wrapKey')
  }
}

function unavailableCrypto(name) {
  return function () {
    return Promise.reject(new Error('crypto.subtle.' + name + ' is unavailable over HTTP'))
  }
}

function rotateRight(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0
}

/** FIPS 180-4 SHA-256; used only when crypto.subtle is missing (plain HTTP). */
function sha256ArrayBuffer(bytes) {
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  var length = bytes.length
  var total = Math.ceil((length + 9) / 64) * 64
  var msg = new Uint8Array(total)
  msg.set(bytes)
  msg[length] = 0x80
  var view = new DataView(msg.buffer)
  view.setUint32(total - 8, Math.floor((length * 8) / 4294967296), false)
  view.setUint32(total - 4, (length * 8) >>> 0, false)
  var w = new Uint32Array(64)
  for (var offset = 0; offset < total; offset += 64) {
    for (var i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false)
    for (var t = 16; t < 64; t += 1) {
      var s0 = rotateRight(w[t - 15], 7) ^ rotateRight(w[t - 15], 18) ^ (w[t - 15] >>> 3)
      var s1 = rotateRight(w[t - 2], 17) ^ rotateRight(w[t - 2], 19) ^ (w[t - 2] >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (t = 0; t < 64; t += 1) {
      var S1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      var ch = (e & f) ^ ((~e) & g)
      var temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0
      var S0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      var maj = (a & b) ^ (a & c) ^ (b & c)
      var temp2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  var out = new Uint8Array(32)
  var outView = new DataView(out.buffer)
  for (var i2 = 0; i2 < 8; i2 += 1) outView.setUint32(i2 * 4, H[i2], false)
  return out.buffer
}

function installClipboardPolyfill() {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') return
  var clipboard = {
    writeText: function (text) {
      return new Promise(function (resolve, reject) {
        var area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
        document.body.appendChild(area)
        area.select()
        try {
          if (document.execCommand('copy')) resolve()
          else reject(new Error('Copy is unavailable in this browser context'))
        } catch (error) {
          reject(error)
        } finally {
          area.remove()
        }
      })
    },
    readText: function () {
      return Promise.reject(new Error('Clipboard read is unavailable over HTTP'))
    }
  }
  try {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
  } catch {
    navigator.clipboard = clipboard
  }
}
})()
