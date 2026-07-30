export const EPUB_HIDE_IMAGES_CLASS = 'goof-off-epub-images-hidden'
export const EPUB_IMAGE_VISIBILITY_STYLE_ATTRIBUTE = 'data-goof-off-image-visibility'

const EPUB_IMAGE_LAYOUT_QUIET_MS = 100
const EPUB_IMAGE_LAYOUT_TIMEOUT_MS = 1500
const hiddenDisplayStateByDocument = new WeakMap()

export const EPUB_HIDDEN_MEDIA_SELECTOR = [
  `html.${EPUB_HIDE_IMAGES_CLASS} img`,
  `html.${EPUB_HIDE_IMAGES_CLASS} picture`,
  `html.${EPUB_HIDE_IMAGES_CLASS} svg image`,
  `html.${EPUB_HIDE_IMAGES_CLASS} svg:has(> image:only-child)`
].join(',\n')

const EPUB_IMAGE_VISIBILITY_CSS = `
${EPUB_HIDDEN_MEDIA_SELECTOR} {
  display: none !important;
}

body,
body * {
  background-image: none !important;
}

html::before,
html::after,
body::before,
body::after,
body *::before,
body *::after {
  background: transparent !important;
  background-image: none !important;
}
`

function contentsDocument(contents) {
  const doc = contents?.document || contents
  return doc?.documentElement && typeof doc.createElement === 'function' ? doc : null
}

function hiddenMediaElements(doc) {
  try {
    return doc.querySelectorAll(EPUB_HIDDEN_MEDIA_SELECTOR)
  } catch {
    // 旧 XML 选择器引擎可能不支持 :has()；用基础选择器与子元素检查保留
    // 纯位图 SVG 包装器的折叠语义。
    const elements = []
    const seen = new Set()
    const add = (element) => {
      if (!seen.has(element)) {
        seen.add(element)
        elements.push(element)
      }
    }

    for (const selector of [
      `html.${EPUB_HIDE_IMAGES_CLASS} img`,
      `html.${EPUB_HIDE_IMAGES_CLASS} picture`,
      `html.${EPUB_HIDE_IMAGES_CLASS} svg image`
    ]) {
      for (const element of doc.querySelectorAll(selector)) add(element)
    }

    for (const svg of doc.querySelectorAll(`html.${EPUB_HIDE_IMAGES_CLASS} svg`)) {
      const children = Array.from(svg.children || [])
      if (children.length === 1 && children[0].localName?.toLowerCase() === 'image') add(svg)
    }
    return elements
  }
}

function rememberAndHideMedia(doc) {
  if (typeof doc.querySelectorAll !== 'function') return

  let displayStates = hiddenDisplayStateByDocument.get(doc)
  if (!displayStates) {
    displayStates = new Map()
    hiddenDisplayStateByDocument.set(doc, displayStates)
  }

  for (const element of hiddenMediaElements(doc)) {
    const style = element?.style
    if (!style?.setProperty) continue

    if (!displayStates.has(element)) {
      const value = style.getPropertyValue('display')
      displayStates.set(element, {
        hadDisplay: value !== '',
        hadStyleAttribute: element.hasAttribute?.('style') === true,
        priority: style.getPropertyPriority('display'),
        value
      })
    }

    // 注入的作者样式表无法压过出版方内联 !important；隐藏期间临时接管
    // 内联 display，确保开关稳定生效，并在显示时恢复原声明。
    style.setProperty('display', 'none', 'important')
  }
}

function restoreHiddenMedia(doc) {
  const displayStates = hiddenDisplayStateByDocument.get(doc)
  if (!displayStates) return

  for (const [element, state] of displayStates) {
    const style = element?.style
    if (!style?.setProperty) continue

    if (state.hadDisplay) {
      style.setProperty('display', state.value, state.priority)
    } else {
      style.removeProperty('display')
      if (!state.hadStyleAttribute && style.length === 0) element.removeAttribute?.('style')
    }
  }

  hiddenDisplayStateByDocument.delete(doc)
}

function contentsDocuments(contentsList) {
  const list = Array.isArray(contentsList) ? contentsList : [contentsList]
  return [...new Set(list.map(contentsDocument).filter(Boolean))]
}

function subscribeToResize(emitter, eventName, handler) {
  const remove = emitter?.off || emitter?.removeListener
  if (typeof emitter?.on !== 'function' || typeof remove !== 'function') return null
  emitter.on(eventName, handler)
  return () => remove.call(emitter, eventName, handler)
}

/**
 * 等待已显示图片与 epub.js 当前视图停止改变布局。
 * 超时用于兜底坏图或长期延迟的懒加载图片。
 */
export function createEpubImageLayoutSettler(
  contentsList,
  {
    manager = null,
    timeoutMs = EPUB_IMAGE_LAYOUT_TIMEOUT_MS,
    view = null,
    waitForImages = true
  } = {}
) {
  let finishPromise
  let finished = false
  let ignorePendingImages = !waitForImages
  let quietTimer = null
  let timeoutTimer = null
  let quietGeneration = 0
  const cleanupCallbacks = []
  const pendingImages = new Set()
  const promise = new Promise((resolve) => {
    finishPromise = resolve
  })

  function cleanup() {
    clearTimeout(quietTimer)
    clearTimeout(timeoutTimer)
    for (const callback of cleanupCallbacks.splice(0)) callback()
  }

  function finish() {
    if (finished) return
    finished = true
    quietGeneration += 1
    cleanup()
    finishPromise()
  }

  function scheduleQuietCheck() {
    if (finished || (!ignorePendingImages && pendingImages.size > 0)) return
    const generation = ++quietGeneration
    clearTimeout(quietTimer)
    quietTimer = setTimeout(() => {
      quietTimer = null
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (finished || generation !== quietGeneration) return
          finish()
        })
      })
    }, EPUB_IMAGE_LAYOUT_QUIET_MS)
  }

  function handleImageSettled(event) {
    const image = event.currentTarget
    if (!pendingImages.delete(image)) return
    scheduleQuietCheck()
  }

  if (waitForImages) {
    for (const doc of contentsDocuments(contentsList)) {
      for (const image of doc.querySelectorAll?.('img') || []) {
        if (
          image.complete ||
          typeof image.addEventListener !== 'function' ||
          typeof image.removeEventListener !== 'function'
        ) {
          continue
        }
        pendingImages.add(image)
        image.addEventListener('load', handleImageSettled)
        image.addEventListener('error', handleImageSettled)
        cleanupCallbacks.push(() => {
          image.removeEventListener('load', handleImageSettled)
          image.removeEventListener('error', handleImageSettled)
        })
        if (image.complete) pendingImages.delete(image)
      }
    }
  }

  const handleResize = () => scheduleQuietCheck()
  const unsubscribeResize =
    subscribeToResize(view, 'resized', handleResize) ||
    subscribeToResize(manager, 'resize', handleResize)
  if (unsubscribeResize) cleanupCallbacks.push(unsubscribeResize)

  timeoutTimer = setTimeout(
    () => {
      ignorePendingImages = true
      scheduleQuietCheck()
    },
    Math.max(0, timeoutMs)
  )
  scheduleQuietCheck()

  return { cancel: finish, promise }
}

export function syncEpubImageVisibility(contents, hideImages) {
  const doc = contentsDocument(contents)
  const root = doc?.documentElement
  if (!root?.classList) return false

  const styleHost = doc.head || doc.querySelector?.('head') || root
  let style = styleHost?.querySelector?.(`style[${EPUB_IMAGE_VISIBILITY_STYLE_ATTRIBUTE}]`)
  if (!style && styleHost?.appendChild && doc.createElement) {
    style = doc.createElement('style')
    style.setAttribute(EPUB_IMAGE_VISIBILITY_STYLE_ATTRIBUTE, '')
    styleHost.appendChild(style)
  }
  if (style && style.textContent !== EPUB_IMAGE_VISIBILITY_CSS) {
    style.textContent = EPUB_IMAGE_VISIBILITY_CSS
  }

  if (hideImages !== false) {
    root.classList.add(EPUB_HIDE_IMAGES_CLASS)
    rememberAndHideMedia(doc)
  } else {
    restoreHiddenMedia(doc)
    root.classList.remove(EPUB_HIDE_IMAGES_CLASS)
  }
  return true
}
