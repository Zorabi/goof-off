import { ref } from 'vue'

export function resolveDropDecision(dataTransfer) {
  const items = [...(dataTransfer?.items || [])]
  const files = [...(dataTransfer?.files || [])]

  if (items.length > 0) {
    if (items.length !== 1 || items[0].kind !== 'file' || files.length !== 1) {
      return { ok: false, reason: 'not-file', message: '请拖入单个文件' }
    }

    const entry = items[0].webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      return { ok: false, reason: 'not-file', message: '请拖入单个文件' }
    }
  } else if (files.length !== 1) {
    return { ok: false, reason: 'not-file', message: '请拖入单个文件' }
  }

  const file = files[0]
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'txt') return { ok: true, kind: 'txt', file }
  if (ext === 'epub') return { ok: true, kind: 'epub', file }
  if (ext === 'pdf') return { ok: true, kind: 'pdf', file }
  return { ok: false, reason: 'unsupported', message: '不支持的文件格式' }
}

export function createDragRoute() {
  const dragActive = ref(false)
  const overlayVisible = ref(false)
  const dropArmed = ref(false)
  let dragDepth = 0
  let timer = null

  function clearOverlay() {
    if (timer) clearTimeout(timer)
    timer = null
    overlayVisible.value = false
    dropArmed.value = false
  }

  function handleDragEnter(e) {
    if (!e.dataTransfer?.types?.includes('Files')) return
    dragDepth += 1
    dragActive.value = true
    if (!timer) {
      timer = setTimeout(() => {
        overlayVisible.value = true
        dropArmed.value = true
      }, 300)
    }
  }

  function handleDragLeave(e) {
    if (!e.dataTransfer?.types?.includes('Files')) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) {
      clearOverlay()
      dragActive.value = false
    }
  }

  function handleDrop() {
    const armed = dropArmed.value
    dragDepth = 0
    clearOverlay()
    dragActive.value = false
    return armed
  }

  function cancel() {
    dragDepth = 0
    clearOverlay()
    dragActive.value = false
  }

  function handleDragOver(e) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  return {
    dragActive,
    overlayVisible,
    dropArmed,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    cancel
  }
}
