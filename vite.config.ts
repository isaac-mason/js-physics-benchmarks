import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
  ],
  optimizeDeps: {
    // These ship their own ESM + WASM — exclude from Vite's dep pre-bundling
    exclude: ['@dimforge/rapier3d', 'jolt-physics'],
  },
  build: {
    target: 'esnext'
  }
})
