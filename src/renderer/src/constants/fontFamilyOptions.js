export const FONT_FAMILY_OPTIONS = Object.freeze([
  { value: 'default', label: '默认', css: null },
  { value: 'serif', label: '衬线（宋体）', css: "Georgia, 'Songti SC', STSong, serif" },
  {
    value: 'sans',
    label: '无衬线（黑体）',
    css: "-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif"
  },
  { value: 'kaiti', label: '楷体', css: "'Kaiti SC', STKaiti, serif" },
  { value: 'mono', label: '等宽', css: "'SF Mono', Menlo, 'PingFang SC', monospace" }
])

export function fontFamilyCss(value) {
  return FONT_FAMILY_OPTIONS.find((option) => option.value === value)?.css || null
}
