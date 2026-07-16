function normalizeLevel(level) {
  if (!Number.isFinite(level)) return 1
  return Math.max(1, Math.min(4, Math.trunc(level)))
}

export function buildTocNodes(chapters = []) {
  const nodes = []
  const stack = []

  for (const chapter of chapters) {
    const level = normalizeLevel(chapter?.level)
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    const parent = stack[stack.length - 1] || null
    const node = {
      ...chapter,
      level,
      depth: level - 1,
      parentId: parent?.id || null,
      ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [],
      hasChildren: false
    }

    if (parent) parent.hasChildren = true
    nodes.push(node)
    stack.push(node)
  }

  return nodes
}

export function getVisibleTocNodes(nodes = [], expandedIds = new Set()) {
  return nodes.filter((node) => node.ancestorIds.every((id) => expandedIds.has(id)))
}

export function findCurrentTocNodeId(chapters = [], offset = 0) {
  if (!Array.isArray(chapters) || offset < 0) return null
  let current = null
  for (const chapter of chapters) {
    if (chapter.charOffset <= offset) current = chapter
    else break
  }
  return current?.id || null
}

export function getAncestorIds(nodes = [], nodeId) {
  return nodes.find((node) => node.id === nodeId)?.ancestorIds || []
}
