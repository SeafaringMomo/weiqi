#!/bin/sh
# Parallel dev: frontend watch + backend watch (tsx).
set -e
cd "$(dirname "$0")/.."

node scripts/build-web.mjs --watch &
BUILD_PID=$!
cleanup() { kill "$BUILD_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

npx tsx watch src/server.ts
