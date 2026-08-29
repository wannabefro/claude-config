#!/usr/bin/env bash
# Fail closed before review bytes cross into another model provider.
set -euo pipefail
umask 077

[ "$#" -eq 1 ] || { [ "$#" -eq 2 ] && [ "$1" = '--file' ] || { echo 'review-secret-scan: usage: review-secret-scan.sh BUNDLE_DIRECTORY | --file FILE' >&2; exit 64; }; }
MODE=bundle
if [ "$1" = '--file' ]; then
  [ "$#" -eq 2 ] && [ -f "$2" ] || { echo 'review-secret-scan: file is missing or unreadable' >&2; exit 65; }
  MODE=file
  BUNDLE=''
else
  BUNDLE=$1
  [ -d "$BUNDLE" ] || { echo 'review-secret-scan: bundle is not a directory' >&2; exit 65; }
fi

status=0
scan_file() {
  local file=$1
  # Match credential-shaped values, never print their contents.
  if LC_ALL=C rg -n -i --no-messages -- \
    '-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\b(?:ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bglpat-[A-Za-z0-9_-]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{12,}\b|\bxox[baprs]_[A-Za-z0-9-]{12,}\b|\bnpm_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bAIza[0-9A-Za-z_-]{30,}\b|(?:password|passwd|secret|token|api[_-]?key|auth[_-]?token)[[:space:]]*[:=][[:space:]]*[^[:space:]]{8,}|postgres(?:ql)?://[^[:space:]/]+:[^[:space:]@]+@' "$file" >/dev/null; then
    echo "review-secret-scan: credential-shaped value in ${file#"$BUNDLE"/}" >&2
    status=1
  fi
}

if [ "$MODE" = file ]; then
  scan_file "$2"
else
  while IFS= read -r -d '' file; do
    [ -f "$file" ] || continue
    scan_file "$file"
  done < <(find "$BUNDLE/files/after" "$BUNDLE/files/before" "$BUNDLE/untracked/after" -type f -print0 2>/dev/null)

# The canonical patch is a cross-provider payload too; scan it even when a
# snapshot was omitted or a future bundle layout changes.
  [ -f "$BUNDLE/01-the-diff.patch" ] && scan_file "$BUNDLE/01-the-diff.patch"
fi

if [ "$status" -ne 0 ]; then
  echo 'review-secret-scan: refusing cross-provider transfer' >&2
  exit 66
fi
printf 'clean\n'
