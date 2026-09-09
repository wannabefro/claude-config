#!/bin/bash
# Shared fail-closed preflight for the one Codex CLI used by this config.
#
# Callers source this file and invoke `codex_preflight review|writer|all`.
# A persistent user install at $HOME/.local/bin/codex is preferred when it is
# present; otherwise the first `codex` found on PATH is used. No caller
# supplied binary or package-manager search is accepted. The selected path,
# version, filesystem identity, and digest are retained for the same process to
# revalidate immediately before its exec.

CODEX_PREFLIGHT_REALPATH=/bin/realpath
CODEX_PREFLIGHT_GREP=/usr/bin/grep
CODEX_PREFLIGHT_STAT=/usr/bin/stat
CODEX_PREFLIGHT_SHASUM=/usr/bin/shasum
CODEX_PREFLIGHT_MKTEMP=/usr/bin/mktemp
CODEX_PREFLIGHT_ID=/usr/bin/id
CODEX_PREFLIGHT_RM=/bin/rm
CODEX_PREFLIGHT_CAT=/bin/cat
CODEX_PREFLIGHT_PS=/bin/ps
CODEX_PREFLIGHT_TR=/usr/bin/tr
CODEX_PREFLIGHT_WC=/usr/bin/wc
CODEX_PREFLIGHT_AWK=/usr/bin/awk
CODEX_PREFLIGHT_PGREP=/usr/bin/pgrep
CODEX_PREFLIGHT_FIND=/usr/bin/find
CODEX_PREFLIGHT_SLEEP=/bin/sleep
CODEX_PREFLIGHT_RG=''
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

codex_preflight_is_regular_executable() {
  [ -f "$1" ] && [ -x "$1" ]
}

codex_preflight_find_perl() {
  local candidate
  CODEX_PREFLIGHT_PERL=''
  for candidate in /usr/bin/perl /opt/homebrew/bin/perl /usr/local/bin/perl; do
    if codex_preflight_is_regular_executable "$candidate"; then
      CODEX_PREFLIGHT_PERL=$candidate
      return 0
    fi
  done
  return 1
}

codex_preflight_find_rg() {
  local candidate
  CODEX_PREFLIGHT_RG=''
  for candidate in /opt/homebrew/bin/rg /usr/local/bin/rg; do
    if codex_preflight_is_regular_executable "$candidate"; then
      CODEX_PREFLIGHT_RG=$candidate
      return 0
    fi
  done
  return 1
}

codex_preflight_require_control_tools() {
  local path
  codex_preflight_find_perl || {
    codex_preflight_report 'trusted Perl runtime is unavailable'
    return 1
  }
  codex_preflight_find_rg || {
    codex_preflight_report 'trusted Homebrew ripgrep is unavailable'
    return 1
  }
  for path in \
    "$CODEX_PREFLIGHT_REALPATH" \
    "$CODEX_PREFLIGHT_GREP" \
    "$CODEX_PREFLIGHT_STAT" \
    "$CODEX_PREFLIGHT_SHASUM" \
    "$CODEX_PREFLIGHT_MKTEMP" \
    "$CODEX_PREFLIGHT_ID" \
    "$CODEX_PREFLIGHT_RM" \
    "$CODEX_PREFLIGHT_CAT" \
    "$CODEX_PREFLIGHT_PS" \
    "$CODEX_PREFLIGHT_TR" \
    "$CODEX_PREFLIGHT_WC" \
    "$CODEX_PREFLIGHT_AWK" \
    "$CODEX_PREFLIGHT_PGREP" \
    "$CODEX_PREFLIGHT_FIND" \
    "$CODEX_PREFLIGHT_SLEEP"; do
    if ! codex_preflight_is_regular_executable "$path"; then
      codex_preflight_report "required trusted control utility is unavailable: $path"
      return 1
    fi
  done
  return 0
}

codex_preflight_has() {
  local pattern=$1
  printf '%s\n' "$CODEX_EXEC_HELP" | "$CODEX_PREFLIGHT_GREP" -Eq "$pattern"
}

codex_preflight_validate_path_env() {
  local path_value=${PATH:-} entry remainder last
  if [ -z "$path_value" ]; then
    codex_preflight_report 'PATH must be non-empty and contain only absolute entries'
    return 1
  fi
  remainder=$path_value
  while :; do
    last=0
    case "$remainder" in
      *:*)
        entry=${remainder%%:*}
        remainder=${remainder#*:}
        ;;
      *)
        entry=$remainder
        remainder=''
        last=1
        ;;
    esac
    case "$entry" in
      '')
        codex_preflight_report 'PATH must be non-empty and contain only absolute entries'
        return 1
        ;;
      /*) ;;
      *)
        codex_preflight_report 'PATH must be non-empty and contain only absolute entries'
        return 1
        ;;
    esac
    [ "$last" -eq 1 ] && break
  done
  return 0
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

codex_preflight_discover() {
  local discovered persistent_candidate
  local discovered_label=${1:-discovered Codex CLI}
  local persistent_label=${2:-persistent Codex CLI}

  # A cmux shim can win PATH; prefer the stable user install.
  # A present invalid path errors, never falls back.
  if [ -n "${HOME:-}" ]; then
    persistent_candidate=$HOME/.local/bin/codex
    if [ -e "$persistent_candidate" ] || [ -L "$persistent_candidate" ]; then
      codex_preflight_validate_path "$persistent_candidate" "$persistent_label" || return 1
      printf '%s\n' "$persistent_candidate"
      return 0
    fi
  fi

  discovered=$(command -v codex 2>/dev/null || true)
  codex_preflight_validate_path "$discovered" "$discovered_label" || return 1
  printf '%s\n' "$discovered"
}

codex_preflight() {
  local lane=${1:-}
  local version_output help_output major minor patch
  case "$lane" in
    review|writer|all) ;;
    *) codex_preflight_usage; return 2 ;;
  esac

  # Clear inherited values; only the discovered path may populate CODEX_BIN.
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
  if ! codex_preflight_require_control_tools; then
    return 1
  fi
  if ! codex_preflight_validate_path_env; then
    return 1
  fi

  # command -v returns a function or alias, so require an absolute path.
  # The persistent install wins over PATH.
  local discovered
  discovered=$(codex_preflight_discover 'discovered Codex CLI' 'persistent Codex CLI' || true)
  if [ -z "$discovered" ]; then
    CODEX_BIN=''
    CODEX_VERSION=''
    codex_preflight_report 'approved Codex CLI is unavailable'
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

  # Keep warnings off stdout; require one stable version line and bound the probe.
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
  # Validate each component so prereleases, builds, extras, and zeroes fail.
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

  # Help is the capability contract; check wrapper flags so missing surfaces fail closed.
  help_output=$("$CODEX_PREFLIGHT_PERL" -e 'alarm shift; exec @ARGV' 10 "$CODEX_BIN" exec --help 2>&1) || {
    codex_preflight_report 'selected Codex CLI failed its bounded exec help probe'
    return 1
  }
  CODEX_EXEC_HELP=$help_output
  if ! codex_preflight_has '(^|[[:space:]])exec([[:space:]]|$)' ||
    ! codex_preflight_has '(^|[[:space:]])-c([,[:space:]]|$)' ||
    ! codex_preflight_has '(^|[[:space:]])--model([[:space:]]|$)' ||
    ! codex_preflight_has '(^|[[:space:]])--sandbox([[:space:]]|$)' ||
    ! codex_preflight_has '(^|[[:space:]])--ignore-user-config([[:space:]]|$)'; then
    codex_preflight_report 'selected Codex CLI lacks a required common exec flag (-c, --model, --sandbox, or --ignore-user-config)'
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
      ! codex_preflight_has '(^|[[:space:]])--output-last-message([[:space:]]|$)' ||
      ! codex_preflight_has '(^|[[:space:]])workspace-write([[:space:]]|[,.)]|$)'; then
      codex_preflight_report 'selected Codex CLI lacks a required writer surface (--approve-for-me, --ephemeral, -C, --output-last-message, or workspace-write sandbox)'
      return 1
    fi
  fi
  return 0
}

codex_preflight_revalidate() {
  local discovered resolved current_id current_digest
  if ! codex_preflight_validate_path_env; then
    return 1
  fi
  discovered=$(codex_preflight_discover 'current Codex CLI' 'current persistent Codex CLI' || true)
  if [ -z "$discovered" ]; then
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
