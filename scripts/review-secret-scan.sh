#!/bin/bash
# Fail closed before review bytes cross into another model provider.
set -euo pipefail
umask 077

RG_BIN=''
for candidate in /opt/homebrew/bin/rg /usr/local/bin/rg; do
  if [ -f "$candidate" ] && [ -x "$candidate" ]; then
    RG_BIN=$candidate
    break
  fi
done
FIND_BIN=/usr/bin/find
MKTEMP_BIN=/usr/bin/mktemp
RM_BIN=/bin/rm
for required_tool in "$RG_BIN" "$FIND_BIN" "$MKTEMP_BIN" "$RM_BIN"; do
  if [ -z "$required_tool" ] || [ ! -f "$required_tool" ] || [ ! -x "$required_tool" ]; then
    echo 'review-secret-scan: trusted scanner utility is unavailable; refusing transfer' >&2
    exit 67
  fi
done

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
scan_failed=0
scan_file() {
  local file=$1 rg_status
  # Match credential-shaped values, never print their contents.
  if LC_ALL=C "$RG_BIN" -n -i --no-messages -- \
    '-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\b(?:ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bglpat-[A-Za-z0-9_-]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{12,}\b|\bxox[baprs]_[A-Za-z0-9-]{12,}\b|\bnpm_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bAIza[0-9A-Za-z_-]{30,}\b|(?:password|passwd|secret|token|api[_-]?key|auth[_-]?token)[[:space:]]*[:=][[:space:]]*[^[:space:]]{8,}|postgres(?:ql)?://[^[:space:]/]+:[^[:space:]@]+@' "$file" >/dev/null 2>&1; then
    rg_status=0
  else
    rg_status=$?
  fi
  case "$rg_status" in
    0)
      echo 'review-secret-scan: credential-shaped value detected in review payload' >&2
      status=1
      ;;
    1) ;;
    *)
      scan_failed=1
      ;;
  esac
}

if [ "$MODE" = file ]; then
  scan_file "$2"
else
  file_list=$("$MKTEMP_BIN" -t claude-secret-scan.XXXXXXXX) || {
    echo 'review-secret-scan: scanner workspace could not be created; refusing transfer' >&2
    exit 67
  }
  cleanup_file_list() { "$RM_BIN" -f "$file_list"; }
  trap cleanup_file_list EXIT HUP INT TERM
  if ! "$FIND_BIN" "$BUNDLE/files/after" "$BUNDLE/files/before" "$BUNDLE/untracked/after" -type f -print0 > "$file_list" 2>/dev/null; then
    echo 'review-secret-scan: trusted file enumeration failed; refusing transfer' >&2
    exit 67
  fi
  while IFS= read -r -d '' file; do
    if [ ! -f "$file" ]; then
      scan_failed=1
      continue
    fi
    scan_file "$file"
  done < "$file_list"

# The canonical patch is a cross-provider payload too; scan it even when a
# snapshot was omitted or a future bundle layout changes.
  if [ -f "$BUNDLE/01-the-diff.patch" ]; then
    scan_file "$BUNDLE/01-the-diff.patch"
  fi
fi

if [ "$scan_failed" -ne 0 ]; then
  echo 'review-secret-scan: ripgrep or file enumeration failed; refusing transfer' >&2
  exit 67
fi
if [ "$status" -ne 0 ]; then
  echo 'review-secret-scan: refusing cross-provider transfer' >&2
  exit 66
fi
printf 'clean\n'
