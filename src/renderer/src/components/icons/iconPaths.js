export const iconPaths = Object.freeze({
  'chevron-left': [{ d: 'M15 18l-6-6 6-6' }],
  'chevron-right': [{ d: 'M9 6l6 6-6 6' }],
  refresh: [{ d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }, { d: 'M21 3v5h-5' }],
  home: [{ d: 'M3.5 10.5 12 3.5l8.5 7' }, { d: 'M5.5 9.5V20h5v-6h3v6h5V9.5' }],
  star: [
    {
      d: 'M12 3 14.35 8.76 20.56 9.22 15.8 13.24 17.29 19.28 12 16 6.71 19.28 8.2 13.24 3.44 9.22 9.65 8.76Z'
    }
  ],
  'star-filled': [
    {
      d: 'M12 3 14.35 8.76 20.56 9.22 15.8 13.24 17.29 19.28 12 16 6.71 19.28 8.2 13.24 3.44 9.22 9.65 8.76Z',
      attrs: {
        fill: 'var(--color-bookmark-fill)',
        stroke: 'var(--color-bookmark-fill)',
        'data-icon-fill': 'neutral'
      }
    }
  ],
  'chevron-down': [{ d: 'm6 9 6 6 6-6' }],
  minimize: [{ d: 'M6 12h12' }],
  close: [{ d: 'm7 7 10 10M17 7 7 17' }],
  gear: [
    { d: 'M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z' },
    {
      d: 'M19.4 13.5a7.9 7.9 0 0 0 0-3l2-1.3-2-3.4-2.35 1a8 8 0 0 0-2.6-1.5L14.1 2h-4.2l-.35 3.3a8 8 0 0 0-2.6 1.5l-2.35-1-2 3.4 2 1.3a7.9 7.9 0 0 0 0 3l-2 1.3 2 3.4 2.35-1a8 8 0 0 0 2.6 1.5l.35 3.3h4.2l.35-3.3a8 8 0 0 0 2.6-1.5l2.35 1 2-3.4-2-1.3Z'
    }
  ],
  'mini-enter': [{ d: 'M4 14h6v6' }, { d: 'M20 10h-6V4' }, { d: 'm14 10 7-7' }, { d: 'm3 21 7-7' }],
  'mini-exit': [{ d: 'M15 3h6v6' }, { d: 'M9 21H3v-6' }, { d: 'm21 3-7 7' }, { d: 'm3 21 7-7' }],
  stealth: [
    { d: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z' },
    {
      d: 'M12 4a8 8 0 0 1 0 16Z',
      attrs: { fill: 'currentColor', 'fill-opacity': '0.32', stroke: 'none' }
    }
  ],
  pin: [{ d: 'M9 4h6l-1 5 4 4v1H6v-1l4-4-1-5Z' }, { d: 'M12 14v6' }],
  'autohide-toolbar': [
    { d: 'M4 6h16v12H4z' },
    { d: 'M7 4h10', attrs: { 'stroke-dasharray': '2 2' } },
    { d: 'M7 20h10', attrs: { 'stroke-dasharray': '2 2' } }
  ],
  'autohide-body': [
    { d: 'M4 6h16v12H4z' },
    { d: 'M8 10h8v4H8z', attrs: { 'stroke-dasharray': '2 2' } }
  ],
  toc: [
    { d: 'M8 7h12' },
    { d: 'M8 12h12' },
    { d: 'M8 17h9' },
    { d: 'M4 7h.01' },
    { d: 'M4 12h.01' },
    { d: 'M4 17h.01' }
  ],
  search: [{ d: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z' }, { d: 'm16 16 4 4' }],
  type: { kind: 'glyph', text: 'Aa' },
  autopage: [{ d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z' }, { d: 'm10 8 6 4-6 4Z' }],
  'hide-media': [
    { d: 'M4 5h16v14H4z' },
    { d: 'M15.5 8.5h.01' },
    { d: 'm6 16 3.5-3.5 3 3.5' },
    { d: 'm4 4 16 16' }
  ],
  'plain-view': [{ d: 'M6 4h9l3 3v13H6z' }, { d: 'M15 4v3h3' }, { d: 'M8 11h8M8 15h8' }],
  fit: [{ d: 'M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4' }, { d: 'M9 9h6v6H9z' }],
  'zoom-out': [
    { d: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z' },
    { d: 'm16 16 4 4' },
    { d: 'M8 11h6' }
  ],
  'zoom-in': [
    { d: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z' },
    { d: 'm16 16 4 4' },
    { d: 'M8 11h6M11 8v6' }
  ],
  history: [
    { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' },
    { d: 'M3 3v5h5' },
    { d: 'M12 7v5l4 2' }
  ],
  'scroll-mode': [{ d: 'M7 4h10v16H7z' }, { d: 'm10 8 2-2 2 2M10 16l2 2 2-2' }],
  'paginate-mode': [{ d: 'M5 5h6v14H5zM13 5h6v14h-6z' }],
  'more-horizontal': [{ d: 'M6 12h.01M12 12h.01M18 12h.01' }]
})

export const ICON_NAMES = Object.freeze(Object.keys(iconPaths))
