import { resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * 独立构建 Service Worker 产物 dist/mvt-sw.js
 *
 * SW 必须是自包含的单文件（IIFE），不能有运行时 import，
 * 因此单独走一次构建，且不复用主构建的 externals。
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/sw/mvt-sw.ts'),
      formats: ['iife'],
      name: 'MvtTileFixerSw',
      fileName: () => 'mvt-sw.js',
    },
    emptyOutDir: false,
    minify: false,
    target: 'es2020',
  },
})
