function clampPage(page, pageCount) {
  if (!Number.isFinite(page) || pageCount <= 0) return null
  return Math.max(1, Math.min(Math.trunc(page), pageCount))
}

function normalizeTitle(title) {
  const value = String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
  return value || '未命名条目'
}

function hasExternalTarget(item) {
  return Boolean(item?.url || item?.unsafeUrl || item?.newWindow)
}

export async function resolvePdfDestinationPage(doc, dest, pageCount) {
  if (!dest || !doc) return null

  try {
    let resolvedDest = dest
    if (typeof dest === 'string') {
      if (typeof doc.getDestination !== 'function') return null
      resolvedDest = await doc.getDestination(dest)
    }

    if (!Array.isArray(resolvedDest) || resolvedDest.length === 0) return null

    const target = resolvedDest[0]
    let pageIndex = null
    if (typeof target === 'number') {
      pageIndex = target
    } else if (target && typeof doc.getPageIndex === 'function') {
      const index = await doc.getPageIndex(target)
      if (Number.isInteger(index) && index >= 0) pageIndex = index
    }

    if (pageIndex == null) return null
    return clampPage(pageIndex + 1, pageCount)
  } catch {
    return null
  }
}

export async function buildPdfOutlineTree(rawItems, doc, pageCount) {
  const source = Array.isArray(rawItems) ? rawItems : []

  async function buildNode(item, path, depth) {
    const childrenSource = Array.isArray(item?.items) ? item.items : []
    const children = []
    for (let index = 0; index < childrenSource.length; index += 1) {
      children.push(await buildNode(childrenSource[index], [...path, index], depth + 1))
    }

    const page = item?.dest ? await resolvePdfDestinationPage(doc, item.dest, pageCount) : null
    const external = hasExternalTarget(item)
    const disabled = !page && children.length === 0
    const disabledReason =
      disabled && external && !item?.dest ? '外部链接已禁用' : disabled ? '无法跳转' : ''

    return {
      id: path.join('-'),
      title: normalizeTitle(item?.title),
      depth,
      page,
      external,
      disabled,
      disabledReason,
      children
    }
  }

  const tree = []
  for (let index = 0; index < source.length; index += 1) {
    tree.push(await buildNode(source[index], [index], 0))
  }
  return tree
}

export function flattenPdfOutlineTree(items, expandedIds) {
  const output = []
  const expanded = expandedIds instanceof Set ? expandedIds : new Set()

  function visit(node) {
    output.push(node)
    if (!expanded.has(node.id)) return
    for (const child of node.children || []) visit(child)
  }

  for (const item of items || []) visit(item)
  return output
}

export function selectPdfOutlineCurrentItem(items, currentPage) {
  const page = Number(currentPage)
  if (!Number.isFinite(page) || page < 1 || !Array.isArray(items)) return null

  let selected = null

  function visit(node) {
    if (Number.isFinite(node?.page) && node.page <= page && !node.disabled) {
      if (!selected || node.page >= selected.page) selected = node
    }
    for (const child of node?.children || []) visit(child)
  }

  for (const item of items) visit(item)
  return selected
}

export function hasPdfOutlineEntries(items) {
  if (!Array.isArray(items)) return false
  return items.some(
    (item) =>
      (Number.isFinite(item?.page) && item.page > 0 && !item.disabled) ||
      hasPdfOutlineEntries(item?.children)
  )
}
