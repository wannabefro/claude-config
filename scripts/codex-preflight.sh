#!/usr/bin/env bash
# Shared fail-closed preflight for the one Codex CLI used by this config.
#
# Callers source this file and invoke `codex_preflight review|writer|all`.
# The first `codex` found on PATH is resolved once to its real path. No caller
# supplied binary, alternate installation, or package-manager fallback is
# accepted. The selected path, version, filesystem identity, and digest are
# retained for the same process to revalidate immediately before its exec.

CODEX_PREFLIGHT_REALPATH=/bin/realpath
CODEX_PREFLIGHT_GREP=/usr/bin/grep
CODEX_PREFLIGHT_STAT=/usr/bin/stat
CODEX_PREFLIGHT_SHASUM=/usr/bin/shasum
CODEX_PREFLIGHT_SCRIPT_ROOT="$(CDPATH= cd -- "$(/usr/bin/dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)" || CODEX_PREFLIGHT_SCRIPT_ROOT=''
CODEX_PREFLIGHT_CHECKOUT_ROOT=''
if [ -n "$CODEX_PREFLIGHT_SCRIPT_ROOT" ]; then
  CODEX_PREFLIGHT_CHECKOUT_ROOT="$(CDPATH= cd -- "$CODEX_PREFLIGHT_SCRIPT_ROOT/.." 2>/dev/null && pwd -P)" || CODEX_PREFLIGHT_CHECKOUT_ROOT=''
fi

codex_preflight_usage() {
  echo 'codex preflight: usage: codex_preflight review|writer|all' >&2
  return 2
}

codex_preflight_report() {
  local detail=$1
  echo "codex preflight: $detail" >&2
  if [ -n "${CODEX_BIN:-}" ]; then
    echo "codex preflight: selected CLI: $CODEX_BIN" >&2
  fi
  if [ -n "${CODEX_BIN:-}" ]; then
    echo "codex preflight: reported version: ${CODEX_VERSION:-<unavailable>}" >&2
  fi
}

codex_preflight_find_perl() {
  CODEX_PREFLIGHT_PERL=/usr/bin/perl
  if [ ! -x "$CODEX_PREFLIGHT_PERL" ]; then
    CODEX_PREFLIGHT_PERL=$(command -v perl 2>/dev/null || true)
  fi
  [ -n "$CODEX_PREFLIGHT_PERL" ] && [ -x "$CODEX_PREFLIGHT_PERL" ] || {
    CODEX_PREFLIGHT_PERL=''
    return 1
  }
  return 0
}

codex_preflight_has() {
  local pattern=$1
  printf '%s\n' "$CODEX_EXEC_HELP" | "$CODEX_PREFLIGHT_GREP" -Eq "$pattern"
}

codex_preflight_inside() {
  local candidate=$1 root=$2
  [ -n "$root" ] || return 1
  case "$candidate" in
    "$root"|"$root"/*) return 0 ;;
    *) return 1 ;;
  esac
}

codex_preflight_worktree_root() {
  local root parent
  root=$(pwd -P 2>/dev/null) || return 1
  while :; do
    if [ -e "$root/.git" ] || [ -d "$root/.git" ]; then
      printf '%s\n' "$root"
      return 0
    fi
    [ "$root" = '/' ] && return 1
    parent=${root%/*}
    [ -n "$parent" ] || parent=/
    [ "$parent" != "$root" ] || return 1
    root=$parent
  done
}

codex_preflight_rejected_path() {
  local candidate=$1 root tmpdir resolved_tmpdir
  local worktree_root
  worktree_root=$(codex_preflight_worktree_root 2>/dev/null || true)
  for root in \
    "$worktree_root" \
    "$CODEX_PREFLIGHT_SCRIPT_ROOT" \
    "$CODEX_PREFLIGHT_CHECKOUT_ROOT" \
    /tmp \
    /private/tmp \
    /var/folders \
    /private/var/folders; do
    if codex_preflight_inside "$candidate" "$root"; then return 0; fi
  done
  tmpdir=${TMPDIR:-}
  if [ -n "$tmpdir" ]; then
    if codex_preflight_inside "$candidate" "$tmpdir"; then return 0; fi
    resolved_tmpdir=$("$CODEX_PREFLIGHT_REALPATH" "$tmpdir" 2>/dev/null || true)
    if codex_preflight_inside "$candidate" "$resolved_tmpdir"; then return 0; fi
  fi
  return 1
}

codex_preflight_capture_fingerprint() {
  local path=$1 identity digest_output
  [ -x "$CODEX_PREFLIGHT_STAT" ] || return 1
  [ -x "$CODEX_PREFLIGHT_SHASUM" ] || return 1
  identity=$("$CODEX_PREFLIGHT_STAT" -f '%d:%i:%m:%z' "$path" 2>/dev/null) ||
    identity=$("$CODEX_PREFLIGHT_STAT" -c '%d:%i:%Y:%s' "$path" 2>/dev/null) || return 1
  [ -n "$identity" ] || return 1
  digest_output=$("$CODEX_PREFLIGHT_SHASUM" -a 256 "$path" 2>/dev/null) || return 1
  CODEX_FS_ID=$identity
  CODEX_DIGEST=${digest_output%% *}
  case "$CODEX_DIGEST" in
    ''|*[!0-9A-Fa-f]*) return 1 ;;
  esac
  [ "${#CODEX_DIGEST}" -eq 64 ] || return 1
  return 0
}

codex_preflight_validate_path() {
  local candidate=$1 label=$2
  if [ -z "$candidate" ] || [ "${candidate#/}" = "$candidate" ] || [ ! -f "$candidate" ] || [ ! -x "$candidate" ]; then
    codex_preflight_report "$label is not an absolute executable file"
    return 1
  fi
  if codex_preflight_rejected_path "$candidate"; then
    codex_preflight_report "$label is inside a repository, checkout, script, or temporary root"
    return 1
  fi
  return 0
}

codex_preflight() {
  local lane=${1:-}
  local version_output help_output major minor patch
  case "$lane" in
    review|writer|all) ;;
    *) codex_preflight_usage; return 2 ;;
  esac

  # Clear inherited values first. In particular, CODEX_BIN is never an input
  # override; only the path discovered below may populate it.
  CODEX_BIN=''
  CODEX_VERSION=''
  CODEX_FS_ID=''
  CODEX_DIGEST=''
  CODEX_FS_ID_INITIAL=''
  CODEX_DIGEST_INITIAL=''
  [ -x "$CODEX_PREFLIGHT_REALPATH" ] || {
    codex_preflight_report 'trusted /bin/realpath is unavailable'
    return 1
  }

  # This is intentionally the sole discovery operation. command -v may
  # return a shell function or alias, so require an absolute executable path
  # before realpath resolves one stable target for the entire caller run.
  local discovered
  discovered=$(command -v codex 2>/dev/null || true)
  if ! codex_preflight_validate_path "$discovered" 'discovered Codex CLI'; then
    CODEX_BIN=''
    CODEX_VERSION=''
    codex_preflight_report 'approved Codex CLI is unavailable on PATH'
    return 1
  fi
  CODEX_BIN=$("$CODEX_PREFLIGHT_REALPATH" "$discovered" 2>/dev/null || true)
  if ! codex_preflight_validate_path "$CODEX_BIN" 'resolved Codex CLI'; then
    codex_preflight_report 'selected Codex CLI could not be resolved to an executable realpath'
    return 1
  fi
  if ! codex_preflight_capture_fingerprint "$CODEX_BIN"; then
    codex_preflight_report 'selected Codex CLI filesystem identity or SHA-256 digest could not be captured'
    return 1
  fi
  CODEX_FS_ID_INITIAL=$CODEX_FS_ID
  CODEX_DIGEST_INITIAL=$CODEX_DIGEST

  if ! codex_preflight_find_perl; then
    codex_preflight_report 'bounded preflight runtime (perl) is unavailable'
    return 1
  fi

  # Keep stdout separate from stderr. Codex may print harmless host warnings
  # on stderr; the version value itself must still be exactly one stable
  # `codex-cli X.Y.Z` line. The alarm bounds a wedged executable.
  CODEX_VERSION=''
  version_output=$("$CODEX_PREFLIGHT_PERL" -e 'alarm shift; exec @ARGV' 10 "$CODEX_BIN" --version 2>/dev/null) || {
    codex_preflight_report 'selected Codex CLI failed its bounded --version probe'
    return 1
  }
  case "$version_output" in
    'codex-cli '[0-9]*.[0-9]*.[0-9]*) ;;
    *)
      codex_preflight_report 'selected Codex CLI returned malformed or non-stable version output'
      return 1
      ;;
  esac
  # The shell glob above establishes the shape; split and validate every
  # component so prereleases, builds, extra components, and leading zeroes do
  # not sneak through as a stable release.
  CODEX_VERSION=${version_output#codex-cli }
  case "$CODEX_VERSION" in
    *[!0-9.]*|*.*.*.*) codex_preflight_report 'selected Codex CLI returned malformed or non-stable version output'; return 1 ;;
    *.*.*) ;;
    *) codex_preflight_report 'selected Codex CLI returned malformed or non-stable version output'; return 1 ;;
  esac
  major=${CODEX_VERSION%%.*}
  minor=${CODEX_VERSION#*.}; minor=${minor%%.*}
  patch=${CODEX_VERSION##*.}
  case "$major" in ''|0|[1-9]|[1-9][0-9]*) ;; *) codex_preflight_report 'selected Codex CLI returned malformed version output'; return 1 ;; esac
  case "$minor" in ''|0|[1-9]|[1-9][0-9]*) ;; *) codex_preflight_report 'selected Codex CLI returned malformed version output'; return 1 ;; esac
  case "$patch" in ''|0|[1-9]|[1-9][0-9]*) ;; *) codex_preflight_report 'selected Codex CLI returned malformed version output'; return 1 ;; esac
  if [ "$major" -lt 0 ] || { [ "$major" -eq 0 ] && [ "$minor" -lt 149 ]; } || { [ "$major" -eq 0 ] && [ "$minor" -eq 149 ] && [ "$patch" -lt 1 ]; }; then
    codex_preflight_report 'selected Codex CLI is below the supported stable version floor (0.149.1)'
    return 1
  fi

  # Help is the capability contract, not a version guess. Check the exact
  # flags and sandbox values used by the wrappers, so a future CLI with a high
  # version but a missing surface fails closed.
  help_output=$("$CODEX_PREFLIGHT_PERL" -e 'alarm shift; exec @ARGV' 10 "$CODEX_BIN" exec --help 2>&1) || {
    codex_preflight_report 'selected Codex CLI failed its bounded exec help probe'
    return 1
  }
  CODEX_EXEC_HELP=$help_output
  if ! codex_preflight_has '(^|[[:space:]])exec([[:space:]]|$)' ||
    ! codex_preflight_has '(^|[[:space:]])-c([,[:space:]]|$)' ||
    ! codex_preflight_has '(^|[[:space:]])--model([[:space:]]|$)' ||
    ! codex_preflight_has '(^|[[:space:]])--sandbox([[:space:]]|$)'; then
    codex_preflight_report 'selected Codex CLI lacks a required common exec flag (-c, --model, or --sandbox)'
    return 1
  fi

  if [ "$lane" = review ] || [ "$lane" = all ]; then
    if ! codex_preflight_has '(^|[[:space:]])--skip-git-repo-check([[:space:]]|$)' ||
      ! codex_preflight_has '(^|[[:space:]])--output-last-message([[:space:]]|$)' ||
      ! codex_preflight_has '(^|[[:space:]])read-only([[:space:]]|[,.)]|$)'; then
      codex_preflight_report 'selected Codex CLI lacks a required review surface (--skip-git-repo-check, --output-last-message, or read-only sandbox)'
      return 1
    fi
  fi
  if [ "$lane" = writer ] || [ "$lane" = all ]; then
    if ! codex_preflight_has '(^|[[:space:]])--approve-for-me([[:space:]]|$)' ||
      ! codex_preflight_has '(^|[[:space:]])--ephemeral([[:space:]]|$)' ||
      ! codex_preflight_has '(^|[[:space:]])-C([,[:space:]]|$)' ||
      ! codex_preflight_has '(^|[[:space:]])workspace-write([[:space:]]|[,.)]|$)'; then
      codex_preflight_report 'selected Codex CLI lacks a required writer surface (--approve-for-me, --ephemeral, -C, or workspace-write sandbox)'
      return 1
    fi
  fi
  return 0
}

codex_preflight_revalidate() {
  local discovered resolved current_id current_digest
  discovered=$(command -v codex 2>/dev/null || true)
  if ! codex_preflight_validate_path "$discovered" 'current Codex CLI'; then
    return 1
  fi
  resolved=$("$CODEX_PREFLIGHT_REALPATH" "$discovered" 2>/dev/null || true)
  if ! codex_preflight_validate_path "$resolved" 'current resolved Codex CLI'; then
    return 1
  fi
  if [ "$resolved" != "${CODEX_BIN:-}" ]; then
    codex_preflight_report 'Codex CLI realpath changed after preflight'
    return 1
  fi
  codex_preflight_capture_fingerprint "$resolved" || {
    codex_preflight_report 'Codex CLI filesystem identity or SHA-256 digest could not be revalidated'
    return 1
  }
  current_id=$CODEX_FS_ID
  current_digest=$CODEX_DIGEST
  if [ "$current_id" != "${CODEX_FS_ID_INITIAL:-}" ] || [ "$current_digest" != "${CODEX_DIGEST_INITIAL:-}" ]; then
    codex_preflight_report 'Codex CLI filesystem identity or SHA-256 digest changed after preflight'
    return 1
  fi
  return 0
}
