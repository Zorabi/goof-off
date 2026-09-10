export function normalizeRangeProgress(value, min, max) {
  const lower = Number(min)
  const upper = Number(max)
  const current = Number(value)
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return 0
  if (!Number.isFinite(current)) return 0
  return Math.min(1, Math.max(0, (current - lower) / (upper - lower)))
}
