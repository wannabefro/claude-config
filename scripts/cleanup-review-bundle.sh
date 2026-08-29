#!/usr/bin/env bash
# Remove one private canonical review bundle after its final consumer.
# Only mktemp directories created by review-bundle.sh are eligible.
set -euo pipefail
umask 077

if [ "$#" -ne 1 ]; then
  echo 'cleanup-review-bundle: usage: cleanup-review-bundle.sh BUNDLE_DIRECTORY' >&2
  exit 64
fi

TARGET=$1
[ -n "$TARGET" ] || { echo 'cleanup-review-bundle: empty target' >&2; exit 64; }
[ -d "$TARGET" ] || { echo 'cleanup-review-bundle: target is not a directory' >&2; exit 0; }
[ ! -L "$TARGET" ] || { echo 'cleanup-review-bundle: refusing symlink target' >&2; exit 65; }

TMP_ROOT=$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P) || {
  echo 'cleanup-review-bundle: cannot resolve private temp root' >&2
  exit 65
}
TARGET=$(cd "$TARGET" 2>/dev/null && pwd -P) || {
  echo 'cleanup-review-bundle: cannot resolve target' >&2
  exit 65
}
case "$TARGET" in
  "$TMP_ROOT"/claude-review-bundle.*) ;;
  *) echo 'cleanup-review-bundle: target is not a canonical review bundle' >&2; exit 65 ;;
esac

# A bundle must carry the manifest and all top-level artifacts expected from
# review-bundle.sh. Refuse incomplete or foreign directories rather than
# turning cleanup into a general-purpose recursive delete.
[ -f "$TARGET/00-manifest.txt" ] || { echo 'cleanup-review-bundle: manifest missing' >&2; exit 65; }
[ -f "$TARGET/01-the-diff.patch" ] || { echo 'cleanup-review-bundle: canonical diff missing' >&2; exit 65; }
[ "$(stat -f '%u' "$TARGET" 2>/dev/null || stat -c '%u' "$TARGET" 2>/dev/null || true)" = "$(id -u)" ] || {
  echo 'cleanup-review-bundle: target is not owned by the current user' >&2
  exit 65
}
[ "$(stat -f '%Lp' "$TARGET" 2>/dev/null || stat -c '%a' "$TARGET" 2>/dev/null || true)" = '700' ] || {
  echo 'cleanup-review-bundle: target is not owner-private' >&2
  exit 65
}

rm -rf -- "$TARGET"
