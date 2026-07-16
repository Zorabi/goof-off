import { useAutoTurn } from './useAutoTurn.js'

/**
 * EPUB 自动翻页适配器。保留 EPUB 专用 import 路径，实际语义由通用 useAutoTurn 提供。
 * @param {{ intervalSec: import('vue').Ref<number>, onTick: () => boolean }} options
 */
export function useEpubAutoTurn(options) {
  return useAutoTurn(options)
}
