// Types for the local single-threaded + SIMD build. The glue API is identical
// to the npm `jolt-physics/wasm` export, so we just re-export its types.
import Jolt from 'jolt-physics/wasm';

export default Jolt;
export * from 'jolt-physics/wasm';
