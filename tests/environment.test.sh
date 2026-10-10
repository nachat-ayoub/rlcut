#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT=/home/student/rlcut
source scripts/environment.sh
expect() {
  local expected="$1"; shift
  local actual
  actual="$(env "$@" bash -c 'source scripts/environment.sh; detect_environment')"
  [[ "$actual" == "$expected" ]] || { echo "Expected $expected, got $actual" >&2; exit 1; }
}
expect docker RLCUT_ENV=auto RLCUT_HOSTNAME=e1r5p2.1337.ma RLCUT_PROJECT_PATH=/home/student/app
expect docker RLCUT_ENV=auto RLCUT_HOSTNAME=lab.42.fr RLCUT_PROJECT_PATH=/home/student/app
expect docker RLCUT_ENV=auto RLCUT_HOSTNAME=lab RLCUT_PROJECT_PATH=/goinfre/student/rlcut
expect docker RLCUT_ENV=auto RLCUT_HOSTNAME=lab RLCUT_PROJECT_PATH=/home/student/goinfre/rlcut
expect native RLCUT_ENV=auto RLCUT_HOSTNAME=ubuntu-laptop RLCUT_PROJECT_PATH=/home/student/rlcut
expect native RLCUT_ENV=native RLCUT_HOSTNAME=lab.1337.ma RLCUT_PROJECT_PATH=/goinfre/student/app
expect docker RLCUT_ENV=docker RLCUT_HOSTNAME=laptop RLCUT_PROJECT_PATH=/home/student/app
if RLCUT_ENV=invalid detect_environment 2>/dev/null; then exit 1; fi
bash -n scripts/run.sh scripts/runtime.sh scripts/environment.sh
echo 'Environment detection: 8 cases passed; launcher syntax passed.'
