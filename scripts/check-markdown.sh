#!/usr/bin/env sh
set -eu

ROOT_DIR=${1:-.}

npm run compile --silent
node "$(dirname "$0")/../out/markdownCli.js" "$ROOT_DIR"
