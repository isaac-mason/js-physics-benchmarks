import path from 'node:path'
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// tumble's js package as built (npm run build in its js/, the wasm by its wasm/toolchain/build.sh)
const TUMBLE_DIR = path.resolve(__dirname, process.env.TUMBLE_DIR ?? '../tumble')

export default defineConfig({
  base: './',
  plugins: [
    wasm(),
    topLevelAwait(),
  ],
  resolve: {
    alias: [
      { find: /^tumble$/, replacement: path.join(TUMBLE_DIR, 'js/dist/index.js') },
      // a regex, as the binary is imported with a ?url query, which a plain alias doesn't match
      { find: /^tumble-binary(?=\?|$)/, replacement: path.join(TUMBLE_DIR, 'js/dist/tumble.wasm') },
    ],
  },
  server: {
    fs: {
      allow: [__dirname, TUMBLE_DIR],
    },
  },
  optimizeDeps: {
    // These ship their own ESM + WASM — exclude from Vite's dep pre-bundling
    exclude: ['@dimforge/rapier3d-simd', 'jolt-physics'],
  },
  build: {
    target: 'esnext'
  }
})
