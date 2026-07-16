import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.js'),
          txtWorker: resolve('src/main/txtWorker.js')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.js'),
          preferences: resolve('src/preload/preferences.js'),
          dialogOverride: resolve('src/preload/dialogOverride.js'),
          popover: resolve('src/preload/popover.js')
        }
      }
    }
  },
  renderer: {
    server: {
      host: '127.0.0.1'
    },
    define: {
      'import.meta.env.GOOF_OFF_STEALTH_SPIKE': JSON.stringify(
        process.env.GOOF_OFF_STEALTH_SPIKE || ''
      )
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      vue(),
      viteStaticCopy({
        targets: [
          {
            src: '../../node_modules/pdfjs-dist/cmaps/*',
            dest: 'pdfjs/cmaps',
            rename: { stripBase: true }
          },
          {
            src: '../../node_modules/pdfjs-dist/standard_fonts/*',
            dest: 'pdfjs/standard_fonts',
            rename: { stripBase: true }
          },
          {
            src: '../../node_modules/pdfjs-dist/wasm/*',
            dest: 'pdfjs/wasm',
            rename: { stripBase: true }
          }
        ]
      })
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          preferences: resolve('src/renderer/preferences/index.html'),
          popover: resolve('src/renderer/popover/index.html')
        }
      }
    }
  }
})
