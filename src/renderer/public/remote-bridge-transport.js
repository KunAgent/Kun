/*
 * Kun Remote transport. Client identity, the browser EventSource stream, the
 * invoke RPC, and event subscriptions shared by the bridge API. The Remote
 * gateway serves this file concatenated ahead of remote-bridge.js.
 */
window.__kunRemoteCreateTransport = function createKunRemoteTransport() {
  var CLIENT_ID_KEY = 'kun-remote-client-id'

  function remoteClientId() {
    try {
      var existing = window.sessionStorage.getItem(CLIENT_ID_KEY)
      if (existing) return existing
      var generated = window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : 'client-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
      window.sessionStorage.setItem(CLIENT_ID_KEY, generated)
      return generated
    } catch {
      return 'client-' + Date.now().toString(36)
    }
  }

  var clientId = remoteClientId()
  var eventHandlers = new Map()
  var eventSource = null
  var streamWasOpen = false
  var streamDropped = false
  var authProbeAt = 0
  var authFailed = false
  var attachCount = 0
  var reconnectTimer = null
  var reconnectDelayMs = 1000
  var MAX_RECONNECT_DELAY_MS = 30000

  function probeRemoteAuth() {
    // EventSource surfaces a 401 only as a generic error; probe the auth
    // endpoint so an expired session lands on the login page instead of
    // retrying the stream forever.
    var now = Date.now()
    if (now - authProbeAt < 5000) return
    authProbeAt = now
    fetch('/remote/auth/status', { credentials: 'same-origin' }).then(function (response) {
      return response.json()
    }).then(function (body) {
      if (body && body.authed === false) {
        authFailed = true
        window.location.href = '/remote/login'
      }
    }).catch(function () {})
  }

  function dispatchEvent(channel, payload) {
    var handlers = eventHandlers.get(channel)
    if (!handlers) return
    handlers.slice().forEach(function (handler) {
      try {
        handler(payload)
      } catch (error) {
        setTimeout(function () { throw error }, 0)
      }
    })
  }

  function scheduleEventSourceRecreate() {
    // EventSource retries while CONNECTING but gives up in CLOSED (e.g. after
    // a non-2xx response or a killed connection on some mobile browsers).
    // CLOSED never recovers by itself — rebuild with backoff instead.
    if (authFailed || reconnectTimer) return
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null
      // The auth probe resolves after this timer was armed; an expired
      // session is on its way to the login page and must not reconnect.
      if (authFailed || eventSource) return
      ensureEventStream()
    }, reconnectDelayMs)
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS)
  }

  function reconnectEventStreamNow() {
    if (authFailed) return
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    reconnectDelayMs = 1000
    if (eventSource) {
      if (eventSource.readyState !== EventSource.CLOSED) return
      try { eventSource.close() } catch (error) { void error }
      eventSource = null
    }
    ensureEventStream()
  }

  function ensureEventStream() {
    if (eventSource) return
    // resume=1 marks every attach after the first: when the hub no longer
    // knows this client it answers with remote:sender-reset so the renderer
    // can resubscribe everything instead of waiting on dead registrations.
    var url = '/remote/events?client=' + encodeURIComponent(clientId)
    if (attachCount > 0) url += '&resume=1'
    attachCount += 1
    var source = new EventSource(url)
    eventSource = source
    source.addEventListener('kun-ipc', function (event) {
      try {
        var frame = JSON.parse(event.data)
        if (frame && typeof frame.channel === 'string') dispatchEvent(frame.channel, frame.payload)
      } catch { /* best-effort */ }
    })
    source.onopen = function () {
      if (source !== eventSource) return
      reconnectDelayMs = 1000
      // A re-open after a drop can leave gaps in the buffered frames; ask the
      // renderer to reconcile its thread inventory and active streams.
      if (streamWasOpen && streamDropped) dispatchEvent('remote:stream-reconnected', {})
      streamWasOpen = true
      streamDropped = false
    }
    source.onerror = function () {
      if (source !== eventSource) return
      streamDropped = true
      probeRemoteAuth()
      if (source.readyState === EventSource.CLOSED) {
        try { source.close() } catch (error) { void error }
        if (eventSource === source) eventSource = null
        scheduleEventSourceRecreate()
      }
    }
  }

  document.addEventListener('visibilitychange', function () {
    // Returning to the foreground is the natural moment to repair a dead
    // event stream instead of waiting out the remaining backoff.
    if (document.visibilityState !== 'visible') return
    if (!eventSource || eventSource.readyState === EventSource.CLOSED) reconnectEventStreamNow()
  })
  window.addEventListener('online', function () {
    if (!eventSource || eventSource.readyState === EventSource.CLOSED) reconnectEventStreamNow()
  })

  function on(channel) {
    return function (handler) {
      if (typeof handler !== 'function') return function () {}
      ensureEventStream()
      var handlers = eventHandlers.get(channel)
      if (!handlers) {
        handlers = []
        eventHandlers.set(channel, handlers)
      }
      handlers.push(handler)
      return function () {
        var index = handlers.indexOf(handler)
        if (index >= 0) handlers.splice(index, 1)
      }
    }
  }

  function invoke(channel, args) {
    return fetch('/remote/invoke', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-kun-remote-request': '1',
        'x-kun-remote-client': clientId
      },
      body: JSON.stringify({ channel: channel, args: args || [] })
    }).then(function (response) {
      if (response.status === 401) {
        window.location.href = '/remote/login'
        return new Promise(function () {})
      }
      return response.json().then(function (body) {
        if (!body || body.ok !== true) {
          throw new Error(body && body.error ? body.error : 'Remote invoke failed: ' + channel)
        }
        return body.result
      })
    })
  }

  function invokeRaw(channel) {
    return function () {
      return invoke(channel, Array.prototype.slice.call(arguments))
    }
  }

  function invokePayload(channel) {
    return function (payload) {
      return invoke(channel, [payload])
    }
  }

  return {
    clientId: clientId,
    ensureEventStream: ensureEventStream,
    invoke: invoke,
    invokeRaw: invokeRaw,
    invokePayload: invokePayload,
    on: on
  }
}
