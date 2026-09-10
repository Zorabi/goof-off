[简体中文](./README.md) | English

<div align="center">

<img src="resources/icon.png" width="112" alt="Goof Off logo" />

# Goof Off

**Keep web pages and local documents in a small window you can hide at any time.**

Goof Off combines TXT, EPUB, and PDF reading with web browsing, plus background transparency, auto-hide, mouse click-through, and global boss keys.

![License](https://img.shields.io/badge/license-GPL--3.0-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon%20%7C%20Windows%2011%20x64-lightgrey)
![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white)
![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)

[**Download and Install**](#download-and-install) · [**3-Minute Quick Start**](#3-minute-quick-start) · [**Move the Window**](#move-the-window) · [**Feature Overview**](#feature-overview) · [**Development and Contributing**](#development-and-contributing)

</div>

<p align="center">
  <img src="./.github/assets/stealth.webp" width="900" alt="Goof Off switching from normal reading to a hidden background, faded UI, and auto-hide" />
</p>

<p align="center"><sub>Captured on macOS; Windows 11 provides the same core capabilities.</sub></p>

## Why Goof Off

- **Disappear when needed**: Enable Hide Background to let content float directly over your desktop. You can also fade the UI and automatically hide the toolbars or reading content when the pointer leaves the window. While the reading content is hidden, mouse clicks pass through to the window underneath.
- **One place for everything**: Open web pages, TXT, EPUB, and PDF files in the same window. Drag in a local file and the app detects its format automatically.
- **Pick up where you left off**: Reading progress is stored separately for each file, along with your frequently used typography and reading-mode settings.
- **Your data stays local**: No account is required, and nothing is synced to the cloud. Reading progress, preferences, and history remain on your machine, and history can be disabled or cleared at any time.

## Download and Install

Download the latest release from [Releases](https://github.com/triWater-Chen/goof-off/releases):

| Platform            | File                                                 | Description                                     |
| ------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| Windows 11 x64      | `Goof-Off-x.x.x-Setup.exe`                           | Installer; lets you choose the install location |
| Windows 11 x64      | `Goof-Off-x.x.x-Portable.zip`                        | Extract fully, then run the executable in place |
| macOS Apple Silicon | `Goof-Off-x.x.x-mac.dmg` or `Goof-Off-x.x.x-mac.zip` | For Macs with Apple silicon (M-series)          |

> Current release packages are not signed with a trusted developer certificate, so your system may display a security warning. On Windows, choose “More info → Run anyway” if SmartScreen appears. On macOS, if the developer cannot be verified, right-click the app in Finder and choose “Open.” Download the app only from this repository's Releases page.

Extract the Windows portable archive completely and keep all files together. You can then run `goof-off-app.exe` directly without unpacking temporary files on every launch.

<details>
<summary><strong>Run from source</strong></summary>

Requires Node.js ≥ 22.12.0 and npm ≥ 10.9.3.

```bash
git clone https://github.com/triWater-Chen/goof-off.git
cd goof-off
npm install
npm run dev
```

</details>

## 3-Minute Quick Start

1. **Open a local file**: Drag a `.txt`, `.epub`, or `.pdf` file into the window, or click “点此打开” (Open File) at the bottom of the home page.
2. **Start reading**: Depending on the file format, the bottom bar displays common tools such as contents, search, typography, auto page-turn, or zoom.
3. **Browse the web**: Enter a URL or search terms at the top and press Enter, or open one of the quick sites on the home page.
4. **Quit and resume later**: Quit normally and the app saves your current position by default. The next time it starts, it can return to the last web page or file you were reading.

<p align="center">
  <img src="./.github/assets/reading.gif" width="420" alt="Opening a TXT file from the home page and using the table of contents and full-text search" />
</p>

<p align="center"><sub>TXT reading → chapter list → full-text search.</sub></p>

### Read your first book

- **TXT**: The app detects chapters automatically and builds a table of contents. Search results appear in the bottom panel, with matching text highlighted in the document. If the text is garbled, open “排版” (Typography) and manually switch among UTF-8, GBK, GB2312, and Big5.
- **EPUB**: In “排版” (Typography), switch between scrolling and paginated modes and adjust the font size, line height, and font family. EPUB also supports a table of contents and book-wide search. Images in the text are hidden by default; click “隐藏图片” (Hide Images) in the bottom bar to show or hide them at any time.
- **PDF**: Open “PDF 适配” (PDF Fit) to choose Fit Width, Fit Page, or a custom zoom from 25% to 400%. If the file contains a bookmark outline, the bottom bar also displays a contents button. “自定义配色” (Custom Colors) defaults to white text on black and can be changed to any two colors in Preferences.

### Manage quick sites

- The home page includes a set of quick sites. Click one to open it, or click “+ 添加” (+ Add) to add your own.
- Right-click a site to edit or delete it, and drag it to reorder. While browsing, click the star in the address bar to save the current page to the home page.

### Browse the web

- Enter a full URL to open it directly. If you enter only `example.com`, the app adds the protocol automatically; all other input is sent to Bing Search.
- The default user agent (UA) is iPhone, which gives common content sites a more compact mobile layout. If a page does not display correctly, switch the UA in Preferences or create an override for the current site.
- After a page opens, the top bar shows only its current domain by default. Click the address bar to expand the full URL and enter a new one.
- Click “隐藏媒体” (Hide Media) in the bottom bar to hide regular images, audio, and video, leaving a cleaner reading view.
- After enabling “背景隐去” (Hide Background), click “网页素览” (Plain View) in the bottom bar when the controls are not merged to remove or soften page backgrounds. If the controls have been merged into “隐身阅读” (Stealth Reading) in Preferences, enabling that master switch also enables Plain View. Disabling Plain View refreshes the current page to restore its original styles.

<p align="center">
  <img src="./.github/assets/web.webp" width="900" alt="Opening a quick site, expanding the address bar, hiding media, and enabling Plain View" />
</p>

<p align="center"><sub>Web view: expand the address bar → hide media → enable Plain View.</sub></p>

### Move the window

Goof Off uses a frameless window on both macOS and Windows 11. Hold one of these drag regions and move the pointer:

| Current state                         | Where to drag                                                                                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Normal window**                     | Use a blank part of the top bar that contains no button or input; the blank area at the upper left is the easiest target. Buttons, the address field, and document content remain available for normal interaction and cannot move the window. |
| **Toolbars are auto-hidden**          | Use the narrow transparent drag strip, about 6 px high, along the very top edge. You can also move the pointer over a top-bar button area or near the bottom edge of the top bar, then drag a blank part of the restored bar.                  |
| **TXT / EPUB Mini Mode**              | Drag the file name or another blank part of the visible top bar, or use either narrow transparent side rail between the top and bottom bars.                                                                                                   |
| **Body is hidden with click-through** | First move the pointer into the full-width re-entry band (about 44 px) at the top or bottom edge to restore the body and disable click-through, then use one of the regions above.                                                             |

> Hide Background, Fade UI, and Always on Top do not change how window dragging works.

## Core Workflow: Make the Window Disappear

1. Open a file or web page, click “视觉控制” (Visual Controls) in the bottom bar, and enable **背景隐去 (Hide Background)**.
2. To make the interface less conspicuous, enable **界面淡化 (Fade UI)** and adjust its intensity. TXT and EPUB text colors and reading backgrounds can be adjusted further in Preferences.
3. Open the “更多” (More) menu in the top bar and enable **工具栏自动隐藏 (Auto-hide Toolbars)** or **主体自动隐藏 (Auto-hide Body)** as needed. Enabling Auto-hide Body also enables Auto-hide Toolbars; you can then disable Auto-hide Toolbars independently without affecting Auto-hide Body.
4. When the pointer leaves the window, the enabled toolbars or body content automatically disappear. While the body is hidden, macOS and Windows 11 also enable mouse click-through, so clicks go directly to the window underneath.

- **Bring back the toolbars**: Move the pointer over a button area in the top or bottom bar, or near the bottom edge of the top bar or the top edge of the bottom bar, to bring back the corresponding toolbar. Blank drag regions do not trigger it. Hidden toolbars keep their original layout space, so the document does not expand into those areas.
- **Bring back the body**: Once the body is hidden, move the pointer into the full-width 44 px re-entry band at the top or bottom edge to restore the reading content. The top drag strip is included; the body itself remains click-through until it is restored.
- **Web media**: Any audio or video playing on a web page is paused before the page body is hidden. Playback does not resume automatically when the body returns.

> Auto-hide works in normal Home, History, web, and file views when Hide Background is enabled, while Mini Mode does not display the options. Both switches last only for the current app session and are not written to long-term preferences. Disabling Hide Background temporarily suspends auto-hide without resetting the current session's choices; enabling it again restores those choices.

### Boss keys

Boss keys are system-wide global shortcuts, so they continue to work even while the window is hidden:

| Action         | Windows            | macOS       | Result                                                |
| -------------- | ------------------ | ----------- | ----------------------------------------------------- |
| Hide / restore | `Ctrl + \`         | `⌘ + \`     | Hides the window instantly; press again to restore it |
| Kill switch    | `Shift + Ctrl + \` | `⇧ + ⌘ + \` | Quits the app immediately without confirmation        |

Rebind them under “偏好设置 → 快捷键 → 老板键” (Preferences → Shortcuts → Boss Keys). If you cannot find the window, you can also click the system tray icon and choose “恢复显示” (Restore).

> “Restore” in the table means showing the entire window after it was hidden with a boss key. It does not include reading content hidden by Auto-hide Body; move the pointer into a button area in the top or bottom bar to bring that content back.

### Mini Mode

While reading TXT or EPUB, choose “更多 → 精简模式” (More → Mini Mode) to shrink the window to 280 × 500 pixels and reduce visual distraction. Web pages and PDF files do not currently support Mini Mode.

<p align="center">
  <img src="./.github/assets/mini.png" width="280" alt="Goof Off TXT Mini Mode" />
</p>

## Feature Overview

| Content                 | Core capabilities                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Web**                 | Smart address bar, suggestions from history and favorites, iPhone / iPad / macOS / Windows user agents (UA), per-site overrides, Plain View (softened page backgrounds), hide images and video, hide scrollbars, page zoom, and wheel-speed control                |
| **TXT**                 | Hierarchical chapter list, full-text search, encoding detection and switching, font size / line height / font family, auto page-turn, background parsing for large files, and on-demand rendering                                                                  |
| **EPUB**                | Table of contents, book-wide search, scrolling / paginated modes, font size / line height / font family, auto page-turn, one-click image visibility (hidden by default), and Mini Mode; DRM-protected books and fixed-layout comics or art books are not supported |
| **PDF**                 | Embedded bookmark outline, Fit Width / Fit Page / 25%–400% zoom, page jumping, on-demand streaming, and full-page custom duotone colors; full-text search and text selection, forms and printing, and Mini Mode are not supported                                  |
| **History and restore** | Web and file history each keep the latest 100 entries and can be deleted individually, cleared, or disabled completely; each file stores its own progress, while commonly used typography and modes are saved as preferences                                       |

## Frequently Used Shortcuts

| Keys                      | Action                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| `Ctrl/⌘ + O`              | Open TXT                                                           |
| `Ctrl/⌘ + Shift + O`      | Open EPUB                                                          |
| `Ctrl/⌘ + Alt + O`        | Open PDF                                                           |
| `Space` / `Shift + Space` | Next / previous page; configurable in Preferences                  |
| `Ctrl/⌘ + F`              | Full-text search in TXT / EPUB                                     |
| `Ctrl/⌘ + =` / `-` / `0`  | Zoom in / out / reset PDF zoom                                     |
| `Ctrl/⌘ + ,`              | Open Preferences                                                   |
| `Esc`                     | Dismiss the active panel, menu, or input field one layer at a time |

<details>
<summary><strong>What else can I change in Preferences?</strong></summary>

- **Visual**: Auto / light / dark theme, Stealth Reading, UI fade intensity, and TXT / EPUB text colors and gradient backgrounds.
- **Modes**: Web UA, compatibility mode, scrollbars, zoom, and site overrides, plus default typography and auto page-turn settings for TXT / EPUB / PDF.
- **Shortcuts**: Boss keys, custom page-turn keys, and a reference for built-in shortcuts.
- **System**: Startup restore, history, taskbar / Dock icon, diagnostic logs, cache cleanup, app reset, and configuration import / export.

</details>

<details>
<summary><strong>History and resume reading</strong></summary>

Click “历史” (History) on the home page to switch between web and file history, grouped by today, yesterday, this week, or earlier. If you open a local-file entry after the file has been moved or deleted, the app offers to remove the stale record. Deleting a history entry never deletes the original file. To stop keeping records, disable web history or file history under “偏好设置 → 系统” (Preferences → System).

</details>

## FAQ

<details>
<summary><strong>The window suddenly disappeared. How do I get it back?</strong></summary>

If the window is still present but the reading content or toolbars have disappeared, auto-hide is active. Move the pointer into the full-width 44 px re-entry band at the top or bottom edge; boss keys cannot restore auto-hidden content. If the entire window is gone, press the Hide / Restore boss key again (default `Ctrl+\` or `⌘+\`), or click the Goof Off icon in the system tray and choose “恢复显示” (Restore).

</details>

<details>
<summary><strong>A website will not open or looks wrong. What should I do?</strong></summary>

Go to “偏好设置 → 模式 → 网页” (Preferences → Modes → Web) and try another user agent (UA). You can also use a site override to change settings only for the current site. If the issue remains, try enabling compatibility mode.

</details>

<details>
<summary><strong>TXT text is garbled. What should I do?</strong></summary>

In the TXT bottom bar, open “排版 → 编码” (Typography → Encoding) and try UTF-8, GBK, GB2312, or Big5. The text is reparsed immediately after you switch encodings.

</details>

<details>
<summary><strong>A comic or art-book EPUB opens blank. I cannot select text in a PDF. Why?</strong></summary>

Goof Off targets long-form, text-first reading. Both behaviors are deliberate trade-offs rather than defects:

- **EPUB** is rendered as reflowable text, and images in the text are hidden by default, so comics, art books, and scanned books whose pages are entirely images open as blank pages. Those books need a large, high-fidelity canvas, which conflicts with the small disguised window this app is built around; use a dedicated reader instead. The publisher's own typography and colors are also normalized to your chosen reading colors, and in-book scripts, narration audio, and DRM-protected books are not supported.
- **PDF** pages are rendered only as images, with no text layer, so text cannot be selected, copied, searched, or extracted, and annotations, form filling, printing, and exporting are unavailable. Custom Colors flattens each page to two colors, so turn it off when you need accurate colors.

</details>

<details>
<summary><strong>Does Goof Off support Intel Macs, Windows 10, or Linux?</strong></summary>

Goof Off officially supports Macs with Apple silicon (M-series) and Windows 11 x64. Intel Macs, Windows 10, Windows ARM64, and Linux are not currently guaranteed to work.

</details>

## Development and Contributing

<details>
<summary><strong>Development commands and project structure</strong></summary>

```bash
npm run dev      # Development mode (HMR)
npm run build    # Build main / preload / renderer
npm start        # Preview the build output
npm run lint     # ESLint; any warning fails the command
npm test         # Run state and transparency recovery regression tests
```

```text
src/
├── main/       # Electron main process, windows, browser, file services, and persistence
├── preload/    # Secure bridges for the main window, Preferences, and popovers
├── renderer/   # Vue apps for the main UI, Preferences, and popovers
└── shared/     # Platform policies, layout models, and pure cross-process modules
```

- The embedded browser uses `WebContentsView`, not `<webview>`.
- PDF files are streamed to pdf.js with Range support through the custom `goof-off-pdf://` protocol.
- Platform differences are centralized in `src/shared/platformPolicy.js`; the persistence schema is in `src/main/store.js`.

</details>

Issues and pull requests are welcome. When reporting a problem, include reproduction steps and your OS version. Before submitting a pull request, run `npm run lint` and `npm run build`. The project uses JavaScript and does not currently use TypeScript; the user interface is currently mainly in Chinese.

## License

This project is released under the [GPL-3.0](./LICENSE) license.

## Acknowledgments

This project has benefited from the technical discussions and shared resources of the [LINUX DO](https://linux.do/) community.
