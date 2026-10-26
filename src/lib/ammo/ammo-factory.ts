// ESM wrapper for the local Ammo.js WASM build (CJS IIFE).
// We load it as a raw string and execute it to extract the factory function,
// avoiding all Vite/Rollup CJS-interop edge cases.

import ammoScript from './ammo.wasm.js?raw';

let _factory: ((opts: object) => Promise<unknown>) | null = null;

export function getAmmoFactory(): (opts: object) => Promise<unknown> {
    if (_factory) return _factory;

    // Execute the IIFE in a scope where `module` and `exports` are defined,
    // so the CJS tail (`module.exports = Ammo`) deposits the factory there.
    const mod = { exports: {} as Record<string, unknown> };
    // under node (the headless run) the glue reads its wasm with require('node:fs'); the browser never calls it
    const require = (id: string) => (globalThis as any).process?.getBuiltinModule?.(id);
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', ammoScript)(mod, mod.exports, require);

    const result = (mod.exports as Record<string, unknown>).default ?? mod.exports;
    if (typeof result !== 'function') {
        throw new Error('ammo-factory: could not extract factory from ammo.wasm.js');
    }
    _factory = result as (opts: object) => Promise<unknown>;
    return _factory;
}
