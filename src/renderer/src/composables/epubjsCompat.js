// epub.js 0.3.93 运行时兼容补丁（仅修复缺陷路径，标准书籍行为逐字节不变）：
//
// 1) Book.load 对压缩包内文件丢弃调用方声明的 type——loadNavigation 明确传了
//    "xml"，但 archived 分支只调 this.archive.request(resolved)，类型退化为按
//    扩展名推断。目录文件扩展名非标准时（如 Kmoe 漫画书的 xml/vol.nav），
//    Archive.handleResponse 原样返回字符串，new Navigation(字符串) 误走 JSON
//    分支抛 "json.map is not a function"；连锁导致 book.pageList 永不赋值，
//    此后每次位置汇报都在 Rendition.located 的 pageFromCfi 处崩溃。
//    补丁仅在「扩展名不被 Archive.handleResponse 识别」时才透传 type 兜底。
//
// 2) 部分转制书的 OPF 清单缺失正文图片声明（如仅声明封面），而 epub.js 只为
//    manifest 里的资源生成 blob URL 并替换正文引用，未声明图片在 iframe 内保持
//    相对路径全部裂图。补丁包装 Book.unpack，在 Resources 构造前把「包内存在
//    但清单未声明」的图片补进 manifest；清单完整的书籍走零改动快路径。
//
// 3) Section.destroy 将 this.hooks 置为 undefined，而在途章节请求的回调会访问
//    this.hooks.content.trigger（快速关书/换书时 locations.generate 或渲染
//    预取仍在途），抛 "reading 'content'"。destroy 后改留惰性空 Hook 集，
//    使在途回调安全落地；被销毁书籍的 Section 随整个对象图一起回收。
//
// 4) Archive.createUrl 有两条缺陷路径，均由清单 href 与包内真实文件名的编码口径
//    不一致触发（getBlob/getBase64 内是 decodeURIComponent(href)）：
//    - 文件名含非法百分号序列（如 "100%.jpg"）时 decodeURIComponent 同步抛
//      URIError，穿透 Resources.replacements() 与 Book.unpack 第 508 行，
//      使 opening deferred 永不落定 —— 表现为开书卡在无限 loading。
//    - 解析失败的资源在 Resources.replacements() 被 filter 丢弃，replacementUrls
//      整体前移，而 get()/substitute() 仍按 urls.indexOf 取下标，后续图片全部
//      错配（显示成另一张图）。
//    补丁让失败一律「解析为空串」：既不再抛/悬挂，又因空串是字符串而保住 filter
//    后的下标对齐，且空串在 substitute 的 `url && replacements[i]` 处被跳过，
//    未命中的引用保持原相对路径（与修复前的裂图一致，不会替换成错图）。

// Archive.handleResponse 能识别的类型集合（含 request 的 blob 分支）；
// 与 epub.js 一致按原样大小写匹配，命中则完全交回原实现。
const ARCHIVE_HANDLED_EXTENSIONS = new Set([
  'json',
  'xml',
  'opf',
  'ncx',
  'xhtml',
  'html',
  'htm',
  'blob'
])

function archiveExtensionOf(path) {
  const clean = String(path || '')
    .split('?')[0]
    .split('#')[0]
  const segment = clean.slice(clean.lastIndexOf('/') + 1)
  const dot = segment.lastIndexOf('.')
  return dot > 0 ? segment.slice(dot + 1) : ''
}

let bookLoadPatched = false

export function ensureEpubjsBookLoadPatch(Book) {
  if (bookLoadPatched) return
  const originalLoad = Book?.prototype?.load
  if (typeof originalLoad !== 'function') return
  Book.prototype.load = function patchedBookLoad(path, type) {
    try {
      if (type && this.archived && this.archive?.request) {
        const resolved = this.resolve(path)
        if (!ARCHIVE_HANDLED_EXTENSIONS.has(archiveExtensionOf(resolved))) {
          return this.archive.request(resolved, type)
        }
      }
    } catch {
      // 兜底判定失败时退回原实现，不得比未打补丁更糟
    }
    return originalLoad.call(this, path)
  }
  bookLoadPatched = true
}

const IMAGE_MEDIA_TYPES = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jfif: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp'
}

// 归一化压缩包内路径：去掉开头的 './'、'/'，折叠 '..' 段，统一比较口径
function normalizeArchivePath(path) {
  const parts = []
  for (const segment of String(path || '').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

function relativeFromDirectory(dirParts, targetPath) {
  const targetParts = targetPath.split('/')
  let common = 0
  while (common < dirParts.length && dirParts[common] === targetParts[common]) common += 1
  return [...Array(dirParts.length - common).fill('..'), ...targetParts.slice(common)].join('/')
}

// epub.js 用 decodeURIComponent(href) 反查压缩包内文件名（Archive.getBlob 等），
// 因此清单 href 与包内真实名的编码口径必须对齐：
// - 比对「是否已声明」时把 href 解码后再比（否则 "my%20pic.jpg" 与包内
//   "my pic.jpg" 被判为两个文件，同图重复补一条）；
// - 补进清单的 href 反过来要逐段编码，使 epub.js 解码后正好等于真实名
//   （否则 "100%.jpg" 之类会让 decodeURIComponent 抛 URIError）。
function decodeArchiveHref(href) {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

function encodeArchiveHref(relativePath) {
  return relativePath
    .split('/')
    .map((segment) => (segment === '..' || segment === '' ? segment : encodeURIComponent(segment)))
    .join('/')
}

function augmentManifestWithArchiveImages(book, packaging) {
  const manifest = packaging?.manifest
  const zipFiles = book?.archived ? book.archive?.zip?.files : null
  if (!manifest || !zipFiles) return

  const opfDirParts = normalizeArchivePath(book.path?.directory || '')
    .split('/')
    .filter(Boolean)
  const opfDirPrefix = opfDirParts.length ? opfDirParts.join('/') + '/' : ''

  const declared = new Set()
  for (const item of Object.values(manifest)) {
    if (!item?.href) continue
    // 原样与解码后两种口径都登记：清单可能已编码，也可能直接写了裸名
    const resolved = opfDirPrefix + item.href
    declared.add(normalizeArchivePath(resolved))
    declared.add(normalizeArchivePath(decodeArchiveHref(resolved)))
  }

  let extraSeq = 0
  for (const [name, entry] of Object.entries(zipFiles)) {
    if (entry?.dir || name.endsWith('/')) continue
    const dot = name.lastIndexOf('.')
    const type = dot > 0 ? IMAGE_MEDIA_TYPES[name.slice(dot + 1).toLowerCase()] : null
    if (!type) continue
    const normalized = normalizeArchivePath(name)
    if (declared.has(normalized)) continue

    let id = `goof-off-undeclared-image-${extraSeq}`
    while (manifest[id]) id = `goof-off-undeclared-image-${++extraSeq}`
    manifest[id] = {
      href: encodeArchiveHref(relativeFromDirectory(opfDirParts, normalized)),
      type,
      overlay: '',
      properties: []
    }
    declared.add(normalized)
    extraSeq += 1
  }
}

let manifestImagePatched = false

export function ensureEpubjsUndeclaredImagePatch(Book) {
  if (manifestImagePatched) return
  const originalUnpack = Book?.prototype?.unpack
  if (typeof originalUnpack !== 'function') return
  Book.prototype.unpack = function patchedBookUnpack(packaging) {
    try {
      // 必须早于同一函数内的 this.replacements()：createUrl 在那里被批量调用
      ensureEpubjsArchiveCreateUrlPatch(this.archive)
      augmentManifestWithArchiveImages(this, packaging)
    } catch {
      // 清单补齐失败时保持原行为（缺失图片继续裂图），不得影响开书
    }
    return originalUnpack.call(this, packaging)
  }
  manifestImagePatched = true
}

let archiveCreateUrlPatched = false

// Resources.replacements() 只 catch 拒绝的 promise，兜不住同步抛出（永挂）；
// 也无法避免失败项被 filter 掉造成的下标前移。这里把两种失败都收敛成空串：
// 空串仍是字符串，filter 保留 → 下标对齐；substitute 又会因 `replacements[i]`
// 为假而跳过替换 → 未命中的引用保持原样裂图，不会替换成别的图片。
// Archive 不在 epubjs 的导出里，故从 book.archive 实例取原型；调用点在
// Book.unpack 入口，早于同一函数内的 this.replacements()。
export function ensureEpubjsArchiveCreateUrlPatch(archive) {
  if (archiveCreateUrlPatched) return
  const proto = archive ? Object.getPrototypeOf(archive) : null
  const originalCreateUrl = proto?.createUrl
  if (typeof originalCreateUrl !== 'function' || originalCreateUrl.__goofOffSafeCreateUrl) return
  function safeCreateUrl(url, options) {
    let result
    try {
      result = originalCreateUrl.call(this, url, options)
    } catch {
      // decodeURIComponent 对非法百分号序列同步抛 URIError
      return Promise.resolve('')
    }
    if (!result || typeof result.then !== 'function') return Promise.resolve(result ?? '')
    // 原实现在 getBlob 返回 undefined（包内无此文件）时 reject，同样收敛成空串
    return Promise.resolve(result).catch(() => '')
  }
  safeCreateUrl.__goofOffSafeCreateUrl = true
  proto.createUrl = safeCreateUrl
  archiveCreateUrlPatched = true
}

function createInertHook() {
  return {
    register() {},
    deregister() {},
    clear() {},
    list() {
      return []
    },
    trigger() {
      return Promise.resolve([])
    }
  }
}

export function ensureEpubjsSectionDestroyPatch(book) {
  try {
    const section = book?.spine?.spineItems?.[0]
    const proto = section ? Object.getPrototypeOf(section) : null
    const originalDestroy = proto?.destroy
    if (typeof originalDestroy !== 'function' || originalDestroy.__goofOffSafeDestroy) return
    function safeDestroy() {
      originalDestroy.call(this)
      this.hooks = { serialize: createInertHook(), content: createInertHook() }
    }
    safeDestroy.__goofOffSafeDestroy = true
    proto.destroy = safeDestroy
  } catch {
    // 补丁失败仅意味着保留原有日志噪音，不影响阅读
  }
}
