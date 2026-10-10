#!/usr/bin/env bash
set -euo pipefail
mkdir -p .checks
rustc --edition=2021 --test src-tauri/src/core.rs -o .checks/core-tests
.checks/core-tests
