import { ref, computed, watch, shallowRef, triggerRef } from 'vue'

const DEFAULT_CHARS_PER_LINE = 30

export function estimateHeight(text, { fontSize, lineHeight, charsPerLine }) {
  const cpl = charsPerLine || DEFAULT_CHARS_PER_LINE
  const lines = Math.max(1, Math.ceil((text?.length || 0) / cpl))
  return lines * fontSize * lineHeight
}

export function buildPrefixSums(heights) {
  const sums = [0]
  for (let i = 0; i < heights.length; i++) {
    sums.push(sums[i] + heights[i])
  }
  return sums
}

export class FenwickTree {
  constructor(n) {
    this.n = n
    this.tree = new Float64Array(n + 1)
  }

  static fromArray(arr) {
    const n = arr.length
    const ft = new FenwickTree(n)
    for (let i = 0; i < n; i++) {
      ft.tree[i + 1] += arr[i]
      const parent = i + 1 + ((i + 1) & -(i + 1))
      if (parent <= n) ft.tree[parent] += ft.tree[i + 1]
    }
    return ft
  }

  update(i, delta) {
    for (let x = i + 1; x <= this.n; x += x & -x) {
      this.tree[x] += delta
    }
  }

  prefixSum(i) {
    let sum = 0
    for (let x = i; x > 0; x -= x & -x) {
      sum += this.tree[x]
    }
    return sum
  }

  total() {
    return this.prefixSum(this.n)
  }

  findPrefix(target) {
    let pos = 0
    let bitMask = 1
    while (bitMask <= this.n) bitMask <<= 1
    bitMask >>= 1
    while (bitMask > 0) {
      const next = pos + bitMask
      if (next <= this.n && this.tree[next] <= target) {
        pos = next
        target -= this.tree[next]
      }
      bitMask >>= 1
    }
    return pos
  }
}

export function findVisibleRange(tree, scrollTop, viewportHeight, bufferCount = 5) {
  const total = tree.n
  const start = tree.findPrefix(scrollTop)
  const bottom = scrollTop + viewportHeight
  const lastVisible = tree.findPrefix(bottom)
  // 如果段顶恰好等于 bottom，该段不可见（exclusive）
  const end = tree.prefixSum(lastVisible) >= bottom ? lastVisible : lastVisible + 1
  return {
    startIndex: Math.max(0, start - bufferCount),
    endIndex: Math.min(total, end + bufferCount)
  }
}

export function computeSpacers(tree, startIndex, endIndex) {
  const totalHeight = tree.total()
  return {
    topSpacer: tree.prefixSum(startIndex),
    bottomSpacer: totalHeight - tree.prefixSum(endIndex)
  }
}

export function findIndexAtOffset(paragraphs, charOffset) {
  let lo = 0,
    hi = paragraphs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (paragraphs[mid].charOffset <= charOffset) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function createVirtualScrollState({ paragraphs, fontSize, lineHeight, charsPerLine }) {
  const measuredHeights = new Map()
  const version = ref(0)
  const treeRef = shallowRef(null)
  const heightsRef = shallowRef([])

  const estimatedHeights = computed(() => {
    const ps = paragraphs.value
    const fs = fontSize.value
    const lh = lineHeight.value
    const cpl = charsPerLine.value
    return ps.map((p) =>
      estimateHeight(p.text, { fontSize: fs, lineHeight: lh, charsPerLine: cpl })
    )
  })

  const estimatedTotalHeight = computed(() =>
    estimatedHeights.value.reduce((sum, height) => sum + height, 0)
  )

  function rebuildTree() {
    measuredHeights.clear()
    const est = estimatedHeights.value
    heightsRef.value = [...est]
    treeRef.value = FenwickTree.fromArray(est)
    triggerRef(treeRef)
    version.value++
  }

  watch(
    estimatedHeights,
    () => {
      rebuildTree()
    },
    { immediate: true }
  )

  function updateMeasuredHeight(index, height) {
    if (measuredHeights.get(index) === height) return
    const oldH = heightsRef.value[index]
    if (oldH === undefined) return
    measuredHeights.set(index, height)
    heightsRef.value[index] = height
    const delta = height - oldH
    if (treeRef.value && delta !== 0) {
      treeRef.value.update(index, delta)
      triggerRef(treeRef)
    }
    version.value++
  }

  const prefixSums = computed(() => {
    version.value
    const t = treeRef.value
    if (!t) return [0]
    const sums = [0]
    for (let i = 1; i <= t.n; i++) {
      sums.push(t.prefixSum(i))
    }
    return sums
  })

  const effectiveHeights = computed(() => {
    version.value
    return [...heightsRef.value]
  })

  return {
    measuredHeights,
    estimatedHeights,
    effectiveHeights,
    prefixSums,
    estimatedTotalHeight,
    treeRef,
    updateMeasuredHeight
  }
}
