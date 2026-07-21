export function scheduleAfterNextPaint(callback) {
  let cancelled = false
  let firstFrame = null
  let secondFrame = null
  let postPaintTask = null

  const cancel = () => {
    cancelled = true
    if (firstFrame !== null) cancelAnimationFrame(firstFrame)
    if (secondFrame !== null) cancelAnimationFrame(secondFrame)
    if (postPaintTask !== null) clearTimeout(postPaintTask)
  }

  firstFrame = requestAnimationFrame(() => {
    if (cancelled) return
    secondFrame = requestAnimationFrame(() => {
      if (cancelled) return
      postPaintTask = setTimeout(() => {
        if (!cancelled) callback()
      }, 0)
    })
  })

  return cancel
}
