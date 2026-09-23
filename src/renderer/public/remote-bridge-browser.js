/*
 * Kun Remote browser-local helpers. Base64/image conversion, clipboard image
 * writes, and <input type=file> picking used by the bridge API. The Remote
 * gateway serves this file concatenated ahead of remote-bridge.js.
 */
window.__kunRemoteBrowser = (function installKunRemoteBrowserHelpers() {
  function bufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer)
    var out = ''
    var chunk = 0x8000
    for (var offset = 0; offset < bytes.length; offset += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunk))
    }
    return btoa(out)
  }

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

  function pickFilesWithBrowser(multiple) {
    return new Promise(function (resolve) {
      var input = document.createElement('input')
      input.type = 'file'
      input.multiple = multiple !== false
      input.style.display = 'none'
      var settled = false
      function finish(files) {
        if (settled) return
        settled = true
        input.remove()
        resolve(files)
      }
      input.addEventListener('change', function () {
        finish(Array.prototype.slice.call(input.files || []))
      })
      // No reliable cancel event across browsers; blur+focus fallback.
      window.addEventListener('focus', function onFocus() {
        window.removeEventListener('focus', onFocus)
        setTimeout(function () {
          if (!settled && !(input.files && input.files.length)) finish([])
        }, 300)
      })
      document.body.appendChild(input)
      input.click()
    })
  }

  return {
    bufferToBase64: bufferToBase64,
    parseImageDataUrl: parseImageDataUrl,
    pickFilesWithBrowser: pickFilesWithBrowser,
    writeLocalClipboardPng: writeLocalClipboardPng
  }
})()
