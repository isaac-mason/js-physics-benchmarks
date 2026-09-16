#!/bin/sh
# Build ammo.js with wasm SIMD and install it into src/lib/ammo/.
#
# Why this exists: ammo.js has no SIMD option at all. Bullet only self-enables
# its SSE paths for __i386__/__x86_64__ (see LinearMath/btScalar.h), and
# emscripten is neither, so a stock ammo.js build is entirely scalar.
# ammo-simd.patch adds an ENABLE_SIMD option that:
#   * passes -msimd128 -msse2 so emscripten maps SSE intrinsics onto wasm SIMD
#   * force-defines BT_USE_SSE / BT_USE_SIMD_VECTOR3 / BT_USE_SSE_IN_API
#   * force-includes <emmintrin.h>, because btScalar.h only includes it inside
#     the __APPLE__/x86 branch we never take, yet still does
#     `typedef __m128 btSimdFloat4` whenever BT_USE_SSE is set
#   * applies those flags to BOTH the Bullet static libs and the glue.cpp
#     translation unit -- BT_USE_SSE_IN_API changes btVector3's layout, so
#     compiling the bindings without it would silently corrupt every vector
#     crossing the JS<->wasm boundary
# It also updates two emscripten flags that modern emsdk removed.
#
# Requires: emsdk (set EMSDK_DIR or have emcc on PATH), cmake, python3.
set -e

AMMO_COMMIT=7dec46e35e0233514e4ed72a79e65e706ac20208
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT_DIR="$REPO_ROOT/src/lib/ammo"
PATCH="$REPO_ROOT/scripts/ammo-simd.patch"
WORK_DIR="${WORK_DIR:-$(mktemp -d)}"

EMSDK_DIR="${EMSDK_DIR:-$HOME/Development/emsdk}"
if [ -f "$EMSDK_DIR/emsdk_env.sh" ]; then
	. "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
fi
command -v emcc >/dev/null 2>&1 || { echo "emcc not found; set EMSDK_DIR"; exit 1; }

echo "Cloning ammo.js into $WORK_DIR"
rm -rf "$WORK_DIR/ammo.js"
git clone --recursive https://github.com/kripken/ammo.js.git "$WORK_DIR/ammo.js"

cd "$WORK_DIR/ammo.js"
git checkout "$AMMO_COMMIT"
git submodule update --init --recursive
git apply "$PATCH"

cmake -B Build/SIMD -DENABLE_SIMD=ON -DCLOSURE=0 -DCMAKE_BUILD_TYPE=Release
cmake --build Build/SIMD --target ammo-wasm -j"$(getconf _NPROCESSORS_ONLN)"

mkdir -p "$OUT_DIR"
cp Build/SIMD/ammo.wasm.js   "$OUT_DIR/ammo.wasm.js"
cp Build/SIMD/ammo.wasm.wasm "$OUT_DIR/ammo.wasm.wasm"

echo "Installed SIMD ammo build into $OUT_DIR"
echo
echo "To build the non-SIMD control for comparison:"
echo "  cmake -B Build/NOSIMD -DENABLE_SIMD=OFF -DCLOSURE=0 -DCMAKE_BUILD_TYPE=Release"
echo "  cmake --build Build/NOSIMD --target ammo-wasm -j\$(getconf _NPROCESSORS_ONLN)"
