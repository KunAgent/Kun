// Serialized by Playwright into the renderer: no module-scope dependencies.
// These read-only DOM diagnostics cannot establish native pixels or paint timing.
export function beginSettingsPaintProbe({ maxEvents = 200 } = {}) {
  const key = '__kunSettingsPaintProbe'
  window[key]?.disconnect?.()
  const selector = '[role="tab"][id^="model-routes-settings-tab-"]'
  const limit = Number.isFinite(maxEvents) ? Math.max(0, Math.min(2000, Math.floor(maxEvents))) : 200
  const identities = new WeakMap()
  const subtree = new WeakSet()
  const ancestors = new WeakSet()
  let nextIdentity = 0
  let batch = 0
  let stopped = false
  const events = []
  const counts = { document: 0, relevant: 0, ignored: 0, dropped: 0 }
  const byType = Object.create(null)
  const byAttribute = Object.create(null)
  const identity = node => {
    if (!node) return null
    if (!identities.has(node)) identities.set(node, `node-${++nextIdentity}`)
    return identities.get(node)
  }
  const timestamp = () => ({ performanceMs: performance.now(),
    timeOriginMs: performance.timeOrigin, epochMs: Date.now() })
  const rect = box => ({ x: box.x, y: box.y, top: box.top, left: box.left,
    right: box.right, bottom: box.bottom, width: box.width, height: box.height })
  const hiddenReasons = element => {
    const reasons = []
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (node.hasAttribute('hidden')) reasons.push({ nodeId: identity(node), reason: 'hidden' })
      if (node.getAttribute('aria-hidden') === 'true') reasons.push({ nodeId: identity(node), reason: 'aria-hidden' })
      if (node.hasAttribute('inert')) reasons.push({ nodeId: identity(node), reason: 'inert' })
      if (style.display === 'none') reasons.push({ nodeId: identity(node), reason: 'display:none' })
      if (['hidden', 'collapse'].includes(style.visibility)) {
        reasons.push({ nodeId: identity(node), reason: `visibility:${style.visibility}` })
      }
    }
    return reasons
  }
  const findTarget = (readStyles = true) => {
    const candidates = [...new Set([...document.querySelectorAll(selector)]
      .map(tab => tab.closest('[role="tablist"]')).filter(Boolean))]
    // Do not require nonzero rects or opacity: those are precisely evidence to
    // inspect. Prefer the active panel over retained hidden sibling panels.
    return candidates.find(candidate => readStyles ? hiddenReasons(candidate).length === 0
      : !candidate.closest('[hidden],[aria-hidden="true"],[inert]'))
      ?? candidates.find(candidate => candidate === initialTarget)
      ?? null
  }
  const rememberTree = node => {
    if (!node) return
    subtree.add(node)
    identity(node)
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ALL)
    while (walker.nextNode()) { subtree.add(walker.currentNode); identity(walker.currentNode) }
  }
  const remember = target => {
    rememberTree(target)
    for (let node = target?.parentElement; node; node = node.parentElement) {
      ancestors.add(node)
      identity(node)
    }
  }
  const describe = (node, includeText = true) => ({ nodeId: identity(node), nodeType: node.nodeType,
    nodeName: node.nodeName, id: node.nodeType === 1 ? node.id : null,
    connected: node.isConnected, ...(includeText ? { text: node.textContent } : {}) })
  const elementSnapshot = (element, includeText = true) => {
    const style = getComputedStyle(element)
    return { ...describe(element, includeText), role: element.getAttribute('role'),
      parentNodeId: identity(element.parentNode),
      childNodeIds: [...element.childNodes].map(identity),
      selected: element.getAttribute('aria-selected'), hidden: element.hasAttribute('hidden'),
      ariaHidden: element.getAttribute('aria-hidden'), inert: element.hasAttribute('inert'),
      hiddenReasons: hiddenReasons(element),
      display: style.display, visibility: style.visibility, opacity: style.opacity,
      color: style.color, background: style.background, backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage, transform: style.transform,
      position: style.position, zIndex: style.zIndex, contain: style.contain,
      fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
      whiteSpace: style.whiteSpace, textOverflow: style.textOverflow,
      contentVisibility: style.contentVisibility, clip: style.clip, clipPath: style.clipPath,
      overflow: style.overflow, overflowX: style.overflowX, overflowY: style.overflowY,
      rect: rect(element.getBoundingClientRect()),
      clientRects: [...element.getClientRects()].map(rect),
      scroll: { left: element.scrollLeft, top: element.scrollTop,
        width: element.scrollWidth, height: element.scrollHeight,
        clientWidth: element.clientWidth, clientHeight: element.clientHeight,
        clientLeft: element.clientLeft, clientTop: element.clientTop } }
  }
  const snapshotTarget = target => {
    if (!target) return null
    const chain = []
    for (let node = target.parentElement; node; node = node.parentElement) {
      const data = elementSnapshot(node, false)
      // Axis-aligned client boxes are approximate when transforms are involved.
      // Preserve raw rects/styles instead of claiming an exact painted clip.
      data.clipAxes = { x: /^(auto|scroll|hidden|clip|overlay)$/.test(data.overflowX || data.overflow),
        y: /^(auto|scroll|hidden|clip|overlay)$/.test(data.overflowY || data.overflow) }
      data.clientBox = { left: data.rect.left + node.clientLeft, top: data.rect.top + node.clientTop,
        right: data.rect.left + node.clientLeft + node.clientWidth,
        bottom: data.rect.top + node.clientTop + node.clientHeight }
      chain.push(data)
    }
    const textNodes = []
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) textNodes.push({ ...describe(walker.currentNode),
      parentNodeId: identity(walker.currentNode.parentNode) })
    return { ...elementSnapshot(target), children: [...target.childNodes].map(node => describe(node)),
      tabs: [...target.querySelectorAll('[role="tab"]')].map(node => elementSnapshot(node)),
      descendants: [...target.querySelectorAll('*')].map(node => elementSnapshot(node)), textNodes,
      ancestorChain: chain, ancestorClips: chain.filter(node => node.clipAxes.x || node.clipAxes.y
        || (node.clipPath && node.clipPath !== 'none') || (node.clip && node.clip !== 'auto')
        || /paint|strict|content/.test(node.contain)),
      scrollChain: [target, ...getParents(target)].map(node => ({ nodeId: identity(node),
        left: node.scrollLeft, top: node.scrollTop, width: node.scrollWidth,
        height: node.scrollHeight, clientWidth: node.clientWidth, clientHeight: node.clientHeight })) }
  }
  const getParents = target => {
    const chain = []
    for (let node = target.parentElement; node; node = node.parentElement) chain.push(node)
    return chain
  }
  // Set before findTarget's fallback is first consulted.
  let initialTarget = null
  initialTarget = findTarget()
  let latestTarget = initialTarget
  remember(initialTarget)
  const started = timestamp()
  const bounded = value => value == null ? null : String(value).slice(0, 1024)
  const brief = node => ({ nodeId: identity(node), nodeType: node.nodeType,
    nodeName: node.nodeName, id: node.nodeType === 1 ? bounded(node.id) : null,
    text: bounded(node.textContent), connected: node.isConnected })
  const containsTarget = node => [initialTarget, latestTarget].some(target => target
    && (node === target || node.contains(target)))
  const containsRouteTab = node => node.nodeType === 1
    && (node.matches(selector) || Boolean(node.querySelector(selector)))
  const recordMutations = (records, source) => {
    if (!records.length || stopped) return
    const observed = timestamp()
    const batchId = ++batch
    // Observer delivery does not read computed styles/rects or force layout.
    // Explicit snapshots collect those separately at their labeled sample time.
    const current = findTarget(false)
    if (current) { latestTarget = current; remember(current) }
    // Remember newly inserted descendants before classifying later mutations
    // in this batch, including labels removed again before observer delivery.
    for (const record of records) {
      if (record.type === 'childList' && subtree.has(record.target)) {
        for (const node of [...record.addedNodes, ...record.removedNodes]) rememberTree(node)
      }
    }
    for (const record of records) {
      counts.document++
      const changedNodes = [...record.addedNodes, ...record.removedNodes]
      const relevant = subtree.has(record.target)
        || (record.type === 'attributes' && ancestors.has(record.target))
        || (record.type === 'childList' && changedNodes.some(node => containsTarget(node)
          || containsRouteTab(node)))
      if (!relevant) { counts.ignored++; continue }
      counts.relevant++
      byType[record.type] = (byType[record.type] ?? 0) + 1
      if (record.attributeName) byAttribute[record.attributeName] = (byAttribute[record.attributeName] ?? 0) + 1
      if (events.length >= limit) { counts.dropped++; continue }
      events.push({ sequence: counts.relevant, batchId, observedAt: observed, source,
        type: record.type, target: brief(record.target), attributeName: record.attributeName,
        attributeNamespace: record.attributeNamespace, oldValue: bounded(record.oldValue),
        valueAtObservation: record.type === 'attributes'
          ? bounded(record.target.getAttributeNS(record.attributeNamespace, record.attributeName))
          : record.type === 'characterData' ? bounded(record.target.data) : null,
        addedCount: record.addedNodes.length, removedCount: record.removedNodes.length,
        addedNodes: [...record.addedNodes].slice(0, 20).map(brief),
        removedNodes: [...record.removedNodes].slice(0, 20).map(brief),
        nodeListsTruncated: record.addedNodes.length > 20 || record.removedNodes.length > 20 })
    }
  }
  const observer = new MutationObserver(records => recordMutations(records, 'observer-delivery'))
  observer.observe(document, { subtree: true, childList: true, characterData: true,
    characterDataOldValue: true, attributes: true, attributeOldValue: true })
  const sample = ({ label = null } = {}) => {
    recordMutations(observer.takeRecords(), 'take-records')
    const current = findTarget()
    if (current) { latestTarget = current; remember(current) }
    const state = !initialTarget ? (current ? 'appeared' : 'missing')
      : current === initialTarget ? 'same'
        : current ? 'replaced' : initialTarget.isConnected ? 'unmatched' : 'detached'
    return { schemaVersion: 1, label, started, sampledAt: timestamp(), stopped,
      document: { visibilityState: document.visibilityState, hidden: document.hidden,
        hasFocus: document.hasFocus(), activeElementNodeId: identity(document.activeElement) },
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio,
        scrollX, scrollY, visualViewport: window.visualViewport ? {
          width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale,
          offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop } : null },
      target: { state, initialNodeId: identity(initialTarget), currentNodeId: identity(current),
        initialConnected: initialTarget?.isConnected ?? false, currentConnected: current?.isConnected ?? false },
      tabstrip: snapshotTarget(current),
      originalTabstrip: initialTarget && initialTarget !== current ? snapshotTarget(initialTarget) : null,
      mutations: { ...counts, byType: { ...byType }, byAttribute: { ...byAttribute },
        maxEvents: limit, events: events.map(event => ({ ...event })),
        timestampMeaning: 'Observation/delivery time; MutationRecord has no occurrence timestamp.',
        scope: 'Tracked tabstrip subtrees, ancestor attributes, and route-tab insertion/removal. Scroll and CSSOM changes are not DOM mutations.',
        valuesMeaning: 'Old values come from MutationRecord; other values and connectivity are read at observation time. Event strings are capped at 1024 characters; node lists at 20.' } }
  }
  window[key] = { sample, disconnect() { observer.disconnect(); stopped = true } }
  return sample({ label: 'begin' })
}

export function sampleSettingsPaintProbe(options = {}) {
  const probe = window.__kunSettingsPaintProbe
  if (!probe) throw new Error('Settings paint probe has not been started')
  return probe.sample(options)
}

export function endSettingsPaintProbe(options = {}) {
  const probe = window.__kunSettingsPaintProbe
  if (!probe) return null
  try { return probe.sample({ label: 'end', ...options }) } finally {
    probe.disconnect()
    delete window.__kunSettingsPaintProbe
  }
}
