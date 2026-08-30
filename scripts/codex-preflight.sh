#!/usr/bin/env bash
# Shared fail-closed preflight for the one Codex CLI used by this config.
#
# Callers source this file and invoke `codex_preflight review|writer|all`.
# The first `codex` found on PATH is resolved once to its real path. No caller
# supplied binary, alternate installation, or package-manager fallback is
# accepted. The selected path and version are exported as CODEX_BIN and
# CODEX_VERSION for the same process to use after this check.

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
  printf '%s\n' "$CODEX_EXEC_HELP" | grep -Eq "$pattern"
}

codex_preflight() {
  local lane=${1:-}
  local version_output help_output major minor patch
  case "$lane" in
    review|writer|all) ;;
    *) codex_preflight_usage; return 2 ;;
  esac

  # This is intentionally the sole discovery operation. command -v may
  # return a shell function or alias, so require an absolute executable path
  # before realpath resolves one stable target for the entire caller run.
  local discovered
  discovered=$(command -v codex 2>/dev/null || true)
  if [ -z "$discovered" ] || [ "${discovered#/}" = "$discovered" ] || [ ! -x "$discovered" ]; then
    CODEX_BIN=''
    CODEX_VERSION=''
    codex_preflight_report 'approved Codex CLI is unavailable on PATH'
    return 1
  fi
  CODEX_BIN=$(realpath "$discovered" 2>/dev/null || true)
  if [ -z "$CODEX_BIN" ] || [ "${CODEX_BIN#/}" = "$CODEX_BIN" ] || [ ! -f "$CODEX_BIN" ] || [ ! -x "$CODEX_BIN" ]; then
    codex_preflight_report 'selected Codex CLI could not be resolved to an executable realpath'
    return 1
  fi

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
