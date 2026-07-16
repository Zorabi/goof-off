[简体中文](./README.md) | English

<div align="center">

<img src="resources/icon.png" width="120" alt="Goof Off logo" />

# Goof Off

A stealth reader built for goofing off: TXT / EPUB / PDF reading plus an embedded browser — go transparent, hide, or vanish at any moment.

![License](https://img.shields.io/badge/license-GPL--3.0-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon%20%7C%20Windows%2011%20x64-lightgrey)
![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white)
![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)

</div>

> **Note:** the app UI is currently Chinese-only. This document quotes the Chinese UI labels (with translations) so you can follow along.

## What is this

Goof Off packs a local e-book reader (TXT / EPUB / PDF) and an embedded web browser into one unassuming little window, then wraps them in a full set of stealth features:

- **Transparency** — the window background disappears entirely, leaving the text floating over your desktop, with adjustable fading;
- **Evasion** — a global boss key hides/restores the window in one stroke and a kill switch quits instantly; when the mouse leaves the window, the content auto-fades and clicks pass through to whatever is underneath;
- **Tracelessness** — it can stay out of the taskbar / Dock and live only in the system tray; history can be disabled or wiped.

Supports macOS (Apple Silicon) and Windows 11 x64. All data (reading progress, preferences, history) stays on your machine.

## Features

**Reading**

- TXT: automatic chapter detection, full-text search, encoding auto-detection (UTF-8 / GBK / GB2312 / Big5, manually switchable), auto page-turn; large-file optimizations (worker-thread parsing above 256 KB, virtualized rendering above 1 MB)
- EPUB: table of contents, search, scroll / paginated modes, font & typography settings (encrypted/DRM EPUB not supported)
- PDF: outline, fit-width / fit-page / custom zoom (25%–400%), page jumping, Range-based streaming
- Per-file progress and typography are remembered; the app can restore your last read on launch (optional)

**Embedded browser**

- Smart address bar: URLs open directly, anything else goes to Bing search; suggestions from history and saved sites as you type
- Quick-site cards: presets for WeRead, Bilibili, Xiaohongshu (RED) and Douyin; add / edit / remove / drag to reorder, one-click bookmarking of the current page
- User-agent spoofing: iPhone by default (mobile pages are smaller and cleaner), or macOS / Windows / iPad, with per-site overrides
- Plain view (strip backgrounds), hide media (images / video), hide scrollbars, page zoom, wheel-speed control
- Web / file history (latest 100 entries each; can be disabled or cleared)

**Stealth**

- Hidden window background + UI fading (0–95%): only the content floats over the desktop
- Global boss key: hide / restore (default `Ctrl+\` / `⌘+\`) and a kill switch that quits instantly (default `Shift+Ctrl+\` / `⇧⌘+\`); both re-bindable
- Body auto-hide: content fades out the moment the mouse leaves the window, with mouse click-through on macOS / Windows 11
- Auto-hiding toolbars that reappear via 44-px hot zones at the window's top/bottom edges
- Optional taskbar / Dock hiding — only a tray icon remains; always-on-top pinning
- Mini mode: a fixed 280×500 window (TXT / EPUB)

## Install

### Option 1: Download a prebuilt package (recommended)

Grab the latest build for your platform from the [Releases](https://github.com/triWater-Chen/goof-off/releases) page:

- **Windows 11 x64**: `Goof-Off-x.x.x-Setup.exe` (installer) or `Goof-Off-x.x.x-Portable.exe` (portable, no install needed)
- **macOS (Apple Silicon)**: `Goof-Off-x.x.x.dmg` or `Goof-Off-x.x.x.zip`

> The packages are not code-signed: on Windows, if SmartScreen pops up, click "More info → Run anyway"; on macOS, if it says the developer cannot be verified, right-click the app → Open.

### Option 2: Build from source

Requires Node.js ≥ 22.12.0 and npm ≥ 10.9.3.

```bash
git clone https://github.com/triWater-Chen/goof-off.git
cd goof-off
npm install     # downloads the Electron binary and rebuilds native deps
npm run dev     # start in dev mode (HMR)
```

Package distributables:

```bash
npm run build:win      # Windows: NSIS installer + portable (x64), output in dist/
npm run build:mac      # macOS: DMG + ZIP
npm run build:unpack   # unpacked directory only, for local verification
```

> - If the Electron download is slow, set a mirror and rerun `npm install`: `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`.
> - A `build:linux` script exists, but the platform policy (`src/shared/platformPolicy.js`) does not support Linux — it may not work.

## Usage

### Quick start

1. Launch the app and you land on the home page.
2. **Read a book**: drag a `.txt` / `.epub` / `.pdf` file into the window (one at a time), or click 「点此打开」 ("click to open") on the home page; keyboard: `Ctrl/⌘+O` (TXT), `Ctrl/⌘+Shift+O` (EPUB), `Ctrl/⌘+Alt+O` (PDF).
3. **Browse**: click a quick-site card, or type a URL / search terms into the address bar and press Enter.
4. On the next launch the app returns to your last page or reading position (disable via Preferences → 系统 (System) → 「启动时恢复上次阅读」 (restore last read on launch)).

### Boss key: hide or kill in one stroke

| Action | Windows | macOS | Behavior |
| --- | --- | --- | --- |
| Hide / restore | `Ctrl + \` | `⌘ + \` | Hides when visible; restores when hidden; opens the main window if closed |
| Kill switch (熔断) | `Shift + Ctrl + \` | `⇧ + ⌘ + \` | Quits the app immediately |

- These are system-wide global shortcuts and keep working while the window is hidden.
- Rebind: Preferences → 快捷键 (Shortcuts) → 「老板键」 (boss key), click the key button and press a new combo (`Esc` cancels; combos already taken by the system are rejected and the old binding is kept).
- Getting the window back: press the hide key again, or click the tray icon → 「恢复显示」 (restore).

### Going full stealth

With a book or web page open, dial the stealth up step by step:

1. **Hide the background**: bottom toolbar → 「视觉控制」 (visual control) → switch on 「背景隐去」 (hide background) — the window background disappears and the content floats over the desktop; then enable 「界面淡化」 (fade UI) and drag the intensity slider (0–95%).
   - One-switch version: Preferences → 视觉 (Visual) → check 「隐身阅读」 (stealth reading) to merge both toggles into one.
2. **Auto-hide the toolbars**: top-right 「更多」 (more) menu → check 「工具栏自动隐藏」 (auto-hide toolbar; requires hide-background first). Bars collapse and reappear when the pointer enters the ~44-px hot zones at the window's top/bottom edges.
3. **Auto-hide the body**: in the same menu, check 「主体自动隐藏」 (auto-hide body). The moment the mouse leaves the window, the content fades to invisible; on macOS and Windows 11, mouse **click-through** also kicks in — clicks land on whatever window is underneath, as if this one didn't exist. Move the mouse back into a hot zone or press a key to bring it back.
4. **Drop out of the taskbar / Dock**: Preferences → 系统 (System) → uncheck 「在任务栏 / Dock 中显示」 (show in taskbar / Dock). From then on there are exactly two ways back: the boss key, or the tray icon.
5. **Pin a tiny window** (optional): 「更多」 menu → 「窗口置顶」 (always on top); while reading TXT / EPUB, 「精简模式」 (mini mode) shrinks the app to a fixed 280×500 window (exit via the in-window menu → 「退出精简态」).

Two extra cleanup switches for web pages (inside the visual control panel; quick icons also appear in the bottom bar once transparency is on):

- 「网页素览」 (plain view): strips page background colors/images — pairs best with transparency;
- 「隐藏媒体」 (hide media): hides images and videos, leaving text only.

### Reading controls

With a file open, the bottom toolbar offers 「目录 / 搜索 / 排版 / 自动翻页」 (contents / search / typography / auto page-turn; varies slightly by format); click the page indicator at the bottom to type a jump target.

| Keys | Action |
| --- | --- |
| `Space` / `Shift+Space` | Next / previous page (rebindable; Ctrl/⌘ combos not allowed) |
| `PageDown` / `PageUp`, arrow keys | Page / scroll (in EPUB, `←` `→` switch chapters) |
| `Ctrl/⌘ + F` | Full-text search (TXT / EPUB) |
| `T` / `A` | TXT: toggle contents / auto page-turn |
| `Home` / `End` | TXT: jump to start / end |
| `Ctrl/⌘ + =` / `-` / `0` | PDF: zoom in / out / reset |
| `Esc` | Collapse the topmost panel / menu / input |

- **TXT**: chapters are auto-detected into a tree (individual chapters can be removed); if you see garbled text, switch the encoding manually in 「排版」 (typography) — it takes effect immediately.
- **EPUB**: switch between scroll and paginated modes in 「排版」; encrypted (DRM) EPUB is not supported.
- **PDF**: pick fit-width / fit-page / a custom ratio (25%–400%) in the 「PDF 适配」 (PDF fit) panel; custom background/text colors do not apply to PDF.
- **Auto page-turn**: enable it in its panel and set an interval (5–180 s).

### Browsing details

- Address bar rules: input starting with `http(s)://` opens directly; `example.com`-like input gets `https://` prepended; everything else is searched on Bing.
- Pages open with an iPhone UA by default. If a site misbehaves: Preferences → 模式 (Modes) → 网页 (Web) — change 「用户代理」 (user agent) or enable 「站点覆盖」 (per-site override) for just that site; 「兼容模式」 (compatibility mode) forces the iPhone UA.
- Bookmarks: click the star next to the address bar to turn the current page into a home-screen site card; right-click a card to edit / delete it, drag to reorder.

### History

Home → 「历史」 (history) card. Two tabs — web history and file history — grouped by today / yesterday / this week / earlier. Hover a row to delete it; 「清空」 (clear all) asks for a second confirmation. Opening a file entry whose file has been moved or deleted offers to remove that record. To leave no trace, disable recording in Preferences → 系统 (System).

### Preferences

「更多」 (more) menu → 「偏好设置」 (preferences), or `Ctrl/⌘ + ,`. Four tabs:

| Tab | Contents |
| --- | --- |
| 视觉 (Visual) | App theme (auto / light / dark), stealth-reading toggle & fade intensity, TXT / EPUB reading background (text color, gradient background) |
| 模式 (Modes) | Web (UA / compatibility / scrollbar / zoom, global & per-site), default typography and auto page-turn for TXT / EPUB / PDF |
| 快捷键 (Shortcuts) | Boss keys, custom page-turn keys, built-in shortcut reference |
| 系统 (System) | Startup restore, history toggles & clearing, taskbar / Dock icon, diagnostic logs, cache cleanup, app reset, config export / import |

## FAQ

- **The window is gone — how do I get it back?** Press the boss key (default `Ctrl+\` / `⌘+\`), or click the Goof Off tray icon → 「恢复显示」 (restore).
- **A site won't load or renders badly?** Preferences → 模式 → 网页: try a different user agent or a per-site override; failing that, 「兼容模式」 (compatibility mode).
- **TXT shows garbled text?** Reader → 「排版」 (typography) → 「编码」 (encoding): switch between UTF-8 / GBK / GB2312 / Big5.

## Project layout

```
src/
├── main/       # Main process: ~30 modules — windows, embedded browser, boss key & tray, transparency, per-format file services
│   └── txtWorker.js    # Separate build entry: large TXT files parse in a worker thread
├── preload/    # Four preloads: main window, preferences, popover, in-page dialog override
├── renderer/   # Three separate Vue apps: main UI, preferences window, popover window
└── shared/     # Pure modules shared by main / preload / renderer (platform policy, popover protocol, layout model, ...)
```

- The embedded browser is a `WebContentsView` (not a `<webview>` tag); UA, CSS injection and the wheel-speed script are managed by the main process.
- PDFs stream to pdf.js through a custom privileged protocol, `goof-off-pdf://`, with Range support.
- All IPC channels are registered centrally in `src/main/ipcHandlers.js` (named `domain:action`); persistence uses electron-store with a full JSON schema in `src/main/store.js`.
- Every macOS/Windows difference is encoded in `src/shared/platformPolicy.js` — feature code never branches on `process.platform` directly.

## Development

```bash
npm run dev      # dev mode (HMR)
npm run build    # bundle main / preload / renderer into out/
npm start        # preview the built bundle
npm run lint     # ESLint (--max-warnings=0 — any warning fails)
npm run format   # Prettier
```

- The env var `GOOF_OFF_STEALTH_SPIKE=1` enables experimental stealth-probing paths (off by default; development only).
- Structured diagnostic logs (JSONL) are written to `logs/` under the user-data directory; they can be disabled in Preferences → 系统.

## Contributing

Issues and PRs are welcome:

- For bug reports, include reproduction steps, your OS version (macOS / Windows 11), and diagnostic log snippets if relevant;
- Make sure `npm run lint` and `npm run format` pass before submitting a PR;
- The codebase is plain JavaScript (no TypeScript); user-facing strings are in Chinese;
- New persisted keys need a schema entry in `src/main/store.js`; platform-specific behavior goes through policy fields in `src/shared/platformPolicy.js`.

## License

Released under the [GPL-3.0](./LICENSE) license.

## Acknowledgments

- The development of this project benefited from the technical discussions and shared resources of the [LINUX DO](https://linux.do/) community.
