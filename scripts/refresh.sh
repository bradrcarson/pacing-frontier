#!/usr/bin/env bash
# Rebuild site/ from the microsite source and keep the hand-made site/404.html.
#
#   scripts/refresh.sh
#   MICROSITE_DIR=/path/to/microsite scripts/refresh.sh
#
# Runs the microsite's own build in preview mode (full HTML pages), drops build-report.json,
# copies 404.html across, checks the result and only then swaps it in for site/.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${MICROSITE_DIR:-/home/claude/microsite}"
SITE_DIR="$DEPLOY_DIR/site"

fail() { echo "refresh: $*" >&2; exit 1; }
[ -f "$SRC_DIR/build/build.mjs" ] || fail "no build script at $SRC_DIR/build/build.mjs"
[ -f "$SITE_DIR/404.html" ] || fail "site/404.html is missing; restore it before refreshing"

# Work inside the deploy folder so the final swap is a rename on one file system.
WORK="$(mktemp -d "$DEPLOY_DIR/.refresh.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

node "$SRC_DIR/build/build.mjs" --out "$WORK/site" --preview
rm -f "$WORK/site/build-report.json"
cp "$SITE_DIR/404.html" "$WORK/site/404.html"

head -c 64 "$WORK/site/index.html" | grep -qi '<!doctype html' || fail "index.html is a fragment; the build must run with --preview"
[ -s "$WORK/site/assets/search-index.json" ] || fail "assets/search-index.json is missing"

mv "$SITE_DIR" "$WORK/old"
mv "$WORK/site" "$SITE_DIR"

pages=$(find "$SITE_DIR" -maxdepth 1 -name '*.html' ! -name 404.html | wc -l | tr -d ' ')
echo "refresh: site/ rebuilt with $pages pages plus 404.html ($(du -sh "$SITE_DIR" | cut -f1))"
