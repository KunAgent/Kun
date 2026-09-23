/*
 * Clipboard image helpers for the Kun Remote bridge. Served ahead of
 * remote-bridge.js by the Remote gateway and exposed on
 * window.__kunRemoteBridgeClipboard so the bridge file stays under the
 * tracked-file line limit. Inside the Electron app the real preload already
 * installed window.kunGui, so nothing here is invoked.
 */
(function installKunRemoteBridgeClipboard() {
  if (typeof window === 'undefined') return

  function base64ToUint8Array(dataBase64) {
    var binary = atob(dataBase64)
    var bytes = new Uint8Array(binary.length)
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  }

  function parseImageDataUrl(dataUrl) {
    var match = String(dataUrl || '').match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/)
    if (!match || !match[2]) return null
    return { dataBase64: match[2], mimeType: match[1] || 'image/png' }
  }

  function writeLocalClipboardPng(dataBase64, mimeType) {
    var type = mimeType && mimeType.indexOf('image/') === 0 ? mimeType : 'image/png'
    if (type === 'image/svg+xml') {
      return Promise.resolve({ ok: false, message: 'This image could not be copied as a bitmap.' })
    }
    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem !== 'function') {
      return Promise.resolve({ ok: false, message: 'Clipboard image copy is not available.' })
    }
    if (type === 'image/png') {
      var pngItem = { 'image/png': new Blob([base64ToUint8Array(dataBase64)], { type: 'image/png' }) }
      return navigator.clipboard.write([new ClipboardItem(pngItem)]).then(function () {
        return { ok: true }
      }).catch(function (error) {
        return { ok: false, message: error && error.message ? error.message : 'Copy failed.' }
      })
    }
    return new Promise(function (resolve) {
      var image = new Image()
      image.onload = function () {
        var canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        var context = canvas.getContext('2d')
        if (!context) {
          resolve({ ok: false, message: 'This image could not be copied as a bitmap.' })
          return
        }
        context.drawImage(image, 0, 0)
        canvas.toBlob(function (blob) {
          if (!blob) {
            resolve({ ok: false, message: 'This image could not be copied as a bitmap.' })
            return
          }
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () {
            resolve({ ok: true })
          }).catch(function (error) {
            resolve({ ok: false, message: error && error.message ? error.message : 'Copy failed.' })
          })
        }, 'image/png')
      }
      image.onerror = function () {
        resolve({ ok: false, message: 'This image could not be copied as a bitmap.' })
      }
      image.src = 'data:' + type + ';base64,' + dataBase64
    })
  }

  window.__kunRemoteBridgeClipboard = {
    writeClipboardImage: function (invoke, payload) {
      var request = payload || {}
      if (request.dataBase64) {
        return writeLocalClipboardPng(request.dataBase64, request.mimeType)
      }
      if (request.path) {
        return invoke('file:read-workspace-image', [{
          path: request.path,
          workspaceRoot: request.workspaceRoot
        }]).then(function (result) {
          if (!result || !result.ok) {
            return { ok: false, message: (result && result.message) || 'Image could not be read.' }
          }
          var parsed = parseImageDataUrl(result.dataUrl)
          if (!parsed) return { ok: false, message: 'Image data is not available to copy.' }
          return writeLocalClipboardPng(parsed.dataBase64, parsed.mimeType || result.mimeType)
        })
      }
      return Promise.resolve({ ok: false, message: 'Either path or dataBase64 is required.' })
    }
  }
})()
