export const CHROME_HOT_ZONE_HEIGHT = 44
export const CHROME_DRAG_BAND_HEIGHT = 6
export const CHROME_MINI_DRAG_RAIL_WIDTH = 14

export const CHROME_TOP_HEIGHT = Object.freeze({
  normal: 34,
  mini: 28
})

export const CHROME_BOTTOM_HEIGHT = Object.freeze({
  normal: 30,
  mini: 26
})

const VALID_FORMS = new Set(['normal', 'mini'])
const VALID_CONTENT = new Set(['home', 'history', 'web', 'file'])
const VALID_FILE_KINDS = new Set(['txt', 'epub', 'pdf'])
const VALID_EDGES = new Set(['top', 'bottom', 'left', 'right'])

function clampNumber(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.round(number))
}

function clampSize(size) {
  return {
    width: clampNumber(size?.width),
    height: clampNumber(size?.height)
  }
}

function normalizeForm(form) {
  return VALID_FORMS.has(form) ? form : 'normal'
}

function normalizeContent(content) {
  return VALID_CONTENT.has(content) ? content : 'home'
}

function normalizeFileKind(fileKind) {
  return VALID_FILE_KINDS.has(fileKind) ? fileKind : null
}

function normalizeChromeState(state = {}, defaults = {}) {
  const visible = state.visible ?? defaults.visible ?? true
  const interactive = state.interactive ?? visible
  return {
    visible: Boolean(visible),
    interactive: Boolean(interactive) && Boolean(visible),
    locked: Boolean(state.locked),
    inHotZone: Boolean(state.inHotZone),
    solid: Boolean(state.solid)
  }
}

function normalizePlatformSummary(platformPolicy = {}) {
  const windowPolicy = platformPolicy.window || {}
  return {
    platform: typeof platformPolicy.platform === 'string' ? platformPolicy.platform : 'unknown',
    family: typeof platformPolicy.family === 'string' ? platformPolicy.family : 'unknown',
    productPlatformLabel:
      typeof platformPolicy.productPlatformLabel === 'string'
        ? platformPolicy.productPlatformLabel
        : 'Unknown',
    reserveTrafficLightSpacer: Boolean(windowPolicy.reserveTrafficLightSpacer),
    showCustomWindowControls: Boolean(windowPolicy.showCustomWindowControls),
    supportsTrafficLights: Boolean(windowPolicy.supportsTrafficLights),
    supportsWindowButtonVisibility: Boolean(windowPolicy.supportsWindowButtonVisibility),
    shouldUseMacHiddenTitlebar: Boolean(windowPolicy.shouldUseMacHiddenTitlebar),
    leadingDragRegionWidth: clampNumber(windowPolicy.leadingDragRegionWidth)
  }
}

function rect(x, y, width, height) {
  return {
    x: clampNumber(x),
    y: clampNumber(y),
    width: clampNumber(width),
    height: clampNumber(height)
  }
}

function clampRectWithinWindow(input, windowSize) {
  const x = Math.min(clampNumber(input.x), windowSize.width)
  const y = Math.min(clampNumber(input.y), windowSize.height)
  const width = Math.min(clampNumber(input.width), Math.max(0, windowSize.width - x))
  const height = Math.min(clampNumber(input.height), Math.max(0, windowSize.height - y))
  return { x, y, width, height }
}

export function createChromeReserve({ kind, edge, side, size, ownerId } = {}) {
  const resolvedEdge = VALID_EDGES.has(edge) ? edge : side
  return {
    kind: typeof kind === 'string' && kind ? kind : 'reserved-area',
    edge: VALID_EDGES.has(resolvedEdge) ? resolvedEdge : 'bottom',
    size: clampNumber(size),
    ownerId: typeof ownerId === 'string' && ownerId ? ownerId : null
  }
}

export function createPopoverBottomReserve(size) {
  return createChromeReserve({
    kind: 'popover',
    edge: 'bottom',
    size,
    ownerId: 'browser.popover-zone'
  })
}

export function createMenuTopReserve(size, ownerId = 'top.more-menu') {
  return createChromeReserve({
    kind: 'menu',
    edge: 'top',
    size,
    ownerId
  })
}

function normalizeReserve(input) {
  if (!input || typeof input !== 'object') return null
  if (input.rect && typeof input.rect === 'object') {
    const edge = VALID_EDGES.has(input.edge) ? input.edge : input.side
    const size = edge === 'left' || edge === 'right' ? input.rect.width : input.rect.height
    return createChromeReserve({ ...input, edge, size })
  }
  return createChromeReserve(input)
}

function aggregateReserves(reserves = [], windowSize) {
  const normalized = reserves.map(normalizeReserve).filter(Boolean)
  const bounds = {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    countsByKind: {},
    items: []
  }

  for (const reserve of normalized) {
    const edgeLimit =
      reserve.edge === 'left' || reserve.edge === 'right' ? windowSize.width : windowSize.height
    const size = Math.min(reserve.size, edgeLimit)
    bounds[reserve.edge] += size
    bounds.countsByKind[reserve.kind] = (bounds.countsByKind[reserve.kind] || 0) + 1
    bounds.items.push({
      kind: reserve.kind,
      edge: reserve.edge,
      size,
      ownerId: reserve.ownerId
    })
  }

  bounds.left = Math.min(bounds.left, windowSize.width)
  bounds.right = Math.min(bounds.right, Math.max(0, windowSize.width - bounds.left))
  bounds.top = Math.min(bounds.top, windowSize.height)
  bounds.bottom = Math.min(bounds.bottom, Math.max(0, windowSize.height - bounds.top))
  return bounds
}

function createContentRect({
  windowSize,
  topHeight,
  bottomHeight,
  topChrome,
  bottomChrome,
  reservedBounds
}) {
  const x = reservedBounds.left
  const y = (topChrome.visible ? topHeight : 0) + reservedBounds.top
  const right = reservedBounds.right
  const bottom = (bottomChrome.visible ? bottomHeight : 0) + reservedBounds.bottom
  return clampRectWithinWindow(
    {
      x,
      y,
      width: windowSize.width - x - right,
      height: windowSize.height - y - bottom
    },
    windowSize
  )
}

function createWebContentsRect({ windowSize, topHeight, bottomHeight, reservedBounds }) {
  const x = reservedBounds.left
  const y = Math.min(windowSize.height, topHeight + reservedBounds.top)
  const right = reservedBounds.right
  const bottom = bottomHeight + reservedBounds.bottom
  return clampRectWithinWindow(
    {
      x,
      y,
      width: windowSize.width - x - right,
      height: windowSize.height - y - bottom
    },
    windowSize
  )
}

export function createChromeLayout(input = {}) {
  const windowSize = clampSize(input.windowSize)
  const form = normalizeForm(input.form)
  const content = normalizeContent(input.content)
  const fileKind = normalizeFileKind(input.fileKind)
  const topHeight = CHROME_TOP_HEIGHT[form]
  const bottomHeight = CHROME_BOTTOM_HEIGHT[form]
  const topChrome = normalizeChromeState(input.topChrome, { visible: true })
  const bottomChrome = normalizeChromeState(input.bottomChrome, { visible: true })
  const platformSummary = normalizePlatformSummary(input.platformPolicy)
  const reservedBounds = aggregateReserves(input.reserves || [], windowSize)

  const topBar = {
    height: topHeight,
    rect: rect(0, 0, windowSize.width, topHeight),
    visible: topChrome.visible,
    interactive: topChrome.interactive,
    locked: topChrome.locked,
    inHotZone: topChrome.inHotZone,
    platformSummary
  }

  const bottomBar = {
    height: bottomHeight,
    rect: rect(0, Math.max(0, windowSize.height - bottomHeight), windowSize.width, bottomHeight),
    visible: bottomChrome.visible,
    interactive: bottomChrome.interactive,
    locked: bottomChrome.locked,
    inHotZone: bottomChrome.inHotZone,
    solid: bottomChrome.solid
  }

  const dragBand = {
    height: CHROME_DRAG_BAND_HEIGHT,
    rect: rect(0, 0, windowSize.width, CHROME_DRAG_BAND_HEIGHT),
    zIndexToken: '--z-drag-band'
  }

  const hotZones = {
    height: CHROME_HOT_ZONE_HEIGHT,
    top: {
      height: CHROME_HOT_ZONE_HEIGHT,
      rect: rect(0, 0, windowSize.width, Math.min(CHROME_HOT_ZONE_HEIGHT, windowSize.height))
    },
    bottom: {
      height: CHROME_HOT_ZONE_HEIGHT,
      rect: rect(
        0,
        Math.max(0, windowSize.height - CHROME_HOT_ZONE_HEIGHT),
        windowSize.width,
        Math.min(CHROME_HOT_ZONE_HEIGHT, windowSize.height)
      )
    }
  }

  const contentRect = createContentRect({
    windowSize,
    topHeight,
    bottomHeight,
    topChrome,
    bottomChrome,
    reservedBounds
  })
  const webContentsRect = createWebContentsRect({
    windowSize,
    topHeight,
    bottomHeight,
    reservedBounds
  })

  return {
    form,
    content,
    fileKind,
    windowSize,
    topBar,
    bottomBar,
    dragBand,
    hotZones,
    platformSummary,
    contentRect,
    webContentsRect,
    reservedBounds,
    diagnosticSummary: {
      form,
      content,
      fileKind,
      windowSize,
      webContentsRect,
      platformSummary,
      reserveEdges: {
        top: reservedBounds.top,
        bottom: reservedBounds.bottom,
        left: reservedBounds.left,
        right: reservedBounds.right
      },
      reserveKinds: { ...reservedBounds.countsByKind },
      reserveCount: reservedBounds.items.length
    }
  }
}
