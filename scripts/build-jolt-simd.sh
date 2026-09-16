#!/bin/sh
# Build a single-threaded + SIMD JoltPhysics.js and install it into src/lib/jolt/.
#
# Why this exists: the npm `jolt-physics` package ships an ST build with no SIMD
# and an MT build with SIMD, and nothing in between. That is purely a choice in
# upstream's build.sh -- ENABLE_SIMD and ENABLE_MULTI_THREADING are independent
# CMake options, so ST+SIMD builds fine, it just never gets emitted. We want it
# because the MT build needs COOP/COEP headers and would not be comparable
# against the other single-threaded engines in this benchmark.
#
# Requires: emsdk (set EMSDK_DIR or have emcc on PATH), cmake, python3.
set -e

JOLT_VERSION=1.1.0
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT_DIR="$REPO_ROOT/src/lib/jolt"
WORK_DIR="${WORK_DIR:-$(mktemp -d)}"

EMSDK_DIR="${EMSDK_DIR:-$HOME/Development/emsdk}"
if [ -f "$EMSDK_DIR/emsdk_env.sh" ]; then
	. "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
fi
command -v emcc >/dev/null 2>&1 || { echo "emcc not found; set EMSDK_DIR"; exit 1; }

echo "Cloning JoltPhysics.js $JOLT_VERSION into $WORK_DIR"
rm -rf "$WORK_DIR/JoltPhysics.js"
git clone --recursive --depth 1 --branch "$JOLT_VERSION" \
	https://github.com/jrouwe/JoltPhysics.js.git "$WORK_DIR/JoltPhysics.js"

cd "$WORK_DIR/JoltPhysics.js"

# upstream build.sh does this before invoking cmake; the typings step writes here
mkdir -p dist

# The only delta from upstream's stock ST build is -DENABLE_SIMD=ON.
# Note ENABLE_MULTI_THREADING is left OFF, so no -pthread / SHARED_MEMORY.
cmake -B Build/ST-SIMD -DENABLE_SIMD=ON -DCMAKE_BUILD_TYPE=Distribution
cmake --build Build/ST-SIMD -j"$(getconf _NPROCESSORS_ONLN)"

mkdir -p "$OUT_DIR"
cp dist/jolt-physics.wasm.js   "$OUT_DIR/jolt-physics.st-simd.wasm.js"
cp dist/jolt-physics.wasm.wasm "$OUT_DIR/jolt-physics.st-simd.wasm.wasm"

echo "Installed ST+SIMD Jolt build into $OUT_DIR"
