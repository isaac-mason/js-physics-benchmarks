/**
 * Bundle size measurement script.
 *
 * For each engine:
 *   - Bundles the entry in bundle-sizes/entries/<engine>.ts using rollup
 *   - Measures raw JS size, minified JS size, and gzip-of-minified size
 *   - For WASM engines, also records the .wasm file size from node_modules
 *
 * Writes results to bundle-sizes/results.json
 *
 * Usage: node bundle-sizes/build.mjs
 */

import { rollup } from 'rollup'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import { minify } from 'terser'
import { createGzip } from 'zlib'
import { Readable } from 'stream'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = path.join(__dirname, 'out')

// ---------------------------------------------------------------------------
// Engine definitions
// ---------------------------------------------------------------------------

const ENGINES = [
  {
    name: 'crashcat',
    entry: 'entries/crashcat.ts',
    // No WASM
  },
  {
    name: 'rapier',
    entry: 'entries/rapier.ts',
    wasm: [
      'node_modules/@dimforge/rapier3d/rapier_wasm3d_bg.wasm',
    ],
  },
  {
    name: 'jolt',
    entry: 'entries/jolt.ts',
    wasm: [
      // wasm-compat flavour (the default import) uses the base wasm
      'node_modules/jolt-physics/dist/jolt-physics.wasm.wasm',
    ],
  },
  {
    name: 'cannon',
    entry: 'entries/cannon.ts',
  },
  {
    name: 'bounce',
    entry: 'entries/bounce.ts',
  },
  {
    name: 'ammo',
    entry: 'entries/ammo.ts',
    wasm: [
      'src/lib/ammo/ammo.wasm.wasm',
    ],
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gzipSize(buf) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const gzip = createGzip({ level: 6 })
    Readable.from(buf).pipe(gzip)
    gzip.on('data', (chunk) => chunks.push(chunk))
    gzip.on('end', () => resolve(Buffer.concat(chunks).length))
    gzip.on('error', reject)
  })
}

async function wasmSizes(wasmPaths) {
  if (!wasmPaths || wasmPaths.length === 0) return null
  let total = 0
  let totalGzip = 0
  const files = {}
  for (const rel of wasmPaths) {
    const abs = path.join(root, rel)
    const buf = readFileSync(abs)
    const size = buf.length
    const gz = await gzipSize(buf)
    files[path.basename(rel)] = { raw: size, gzip: gz }
    total += size
    totalGzip += gz
  }
  return { total, totalGzip, files }
}

async function measureEntry(engine) {
  const entryPath = path.join(__dirname, engine.entry)
  console.log(`\n[${engine.name}] bundling...`)

  let bundle
  try {
    bundle = await rollup({
      input: entryPath,
      // Treat Node built-ins and .wasm files as external
      external: (id) => ['fs', 'path', 'module'].includes(id) || id.endsWith('.wasm'),
      plugins: [
        // Resolve node_modules
        resolve({
          browser: true,
          preferBuiltins: false,
          // Inline WASM as base64 would bloat — instead mark .wasm as external
          // We account for it separately from disk
          extensions: ['.js', '.mjs', '.cjs', '.ts'],
        }),
        commonjs({
          // Transform CJS (ammo.js)
          ignoreDynamicRequires: true,
        }),
        typescript({
          tsconfig: false,
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: false,
            skipLibCheck: true,
            noEmit: false,
          },
        }),
      ],
      // Silence circular dependency warnings (common in physics libs)
      onwarn(warning, warn) {
        if (
          warning.code === 'CIRCULAR_DEPENDENCY' ||
          warning.code === 'UNRESOLVED_IMPORT' ||
          warning.code === 'EVAL' ||
          warning.code === 'THIS_IS_UNDEFINED'
        )
          return
        warn(warning)
      },
    })
  } catch (err) {
    console.error(`[${engine.name}] rollup error:`, err.message)
    return { name: engine.name, error: err.message }
  }

  let generated
  try {
    const result = await bundle.generate({
      format: 'esm',
      // Inline dynamic imports so we get a single file
      inlineDynamicImports: true,
    })
    generated = result.output
  } finally {
    await bundle.close()
  }

  // Collect all JS chunks/assets (exclude .wasm assets emitted by rollup)
  const jsParts = generated
    .filter((chunk) => chunk.type === 'chunk' || (chunk.type === 'asset' && !chunk.fileName.endsWith('.wasm')))
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : chunk.source?.toString() ?? ''))

  const rawJs = jsParts.join('')
  const rawSize = Buffer.byteLength(rawJs, 'utf8')

  console.log(`[${engine.name}] raw JS: ${(rawSize / 1024).toFixed(1)} kB`)

  // Minify
  let minifiedSize = null
  let minifiedGzipSize = null
  try {
    const minResult = await minify(rawJs, {
      compress: true,
      mangle: true,
      module: true,
    })
    const minBuf = Buffer.from(minResult.code ?? '', 'utf8')
    minifiedSize = minBuf.length
    minifiedGzipSize = await gzipSize(minBuf)
    console.log(
      `[${engine.name}] minified: ${(minifiedSize / 1024).toFixed(1)} kB  gzip: ${(minifiedGzipSize / 1024).toFixed(1)} kB`
    )
  } catch (err) {
    console.warn(`[${engine.name}] terser failed: ${err.message}`)
  }

  // WASM sizes (from disk, not bundled)
  const wasm = await wasmSizes(engine.wasm)
  if (wasm) {
    console.log(`[${engine.name}] wasm total: ${(wasm.total / 1024).toFixed(1)} kB  gzip: ${(wasm.totalGzip / 1024).toFixed(1)} kB`)
  }

  return {
    name: engine.name,
    js: {
      raw: rawSize,
      minified: minifiedSize,
      minifiedGzip: minifiedGzipSize,
    },
    ...(wasm ? { wasm } : {}),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const results = {}
  const meta = {
    measuredAt: new Date().toISOString(),
    versions: {},
  }

  // Collect package versions
  const require = createRequire(import.meta.url)
  const versionFor = (pkg) => {
    try {
      return require(path.join(root, 'node_modules', pkg, 'package.json')).version
    } catch {
      return null
    }
  }
  meta.versions = {
    crashcat: versionFor('crashcat'),
    rapier: versionFor('@dimforge/rapier3d'),
    jolt: versionFor('jolt-physics'),
    cannon: versionFor('cannon-es'),
    bounce: versionFor('@perplexdotgg/bounce'),
    ammo: '1ed8b58',
  }

  for (const engine of ENGINES) {
    const result = await measureEntry(engine)
    results[engine.name] = result
  }

  const output = { meta, results }
  const outPath = path.join(__dirname, 'results.json')
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\nResults written to bundle-sizes/results.json`)

  // Print summary table
  console.log('\n--- Summary ---')
  console.log(
    `${'Engine'.padEnd(12)} ${'JS raw'.padStart(10)} ${'JS min'.padStart(10)} ${'JS min+gz'.padStart(12)} ${'WASM'.padStart(10)}`
  )
  console.log('-'.repeat(60))
  for (const [name, r] of Object.entries(results)) {
    if (r.error) {
      console.log(`${name.padEnd(12)} ERROR: ${r.error}`)
      continue
    }
    const kb = (n) => (n == null ? '   —' : `${(n / 1024).toFixed(1)} kB`)
    const wasmStr = r.wasm ? kb(r.wasm.total) : '   —'
    console.log(
      `${name.padEnd(12)} ${kb(r.js.raw).padStart(10)} ${kb(r.js.minified).padStart(10)} ${kb(r.js.minifiedGzip).padStart(12)} ${wasmStr.padStart(10)}`
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
