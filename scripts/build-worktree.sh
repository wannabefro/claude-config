#!/usr/bin/env bash
# Create, refresh, integrate, and remove one private build worktree.
set -euo pipefail
umask 077

usage() {
  echo 'usage: build-worktree.sh probe REPO BASE | prepare REPO BASE ROOT INVOCATION_NONCE PLAN_HASH UNIT... | create REPO BASE DEST BRANCH INVOCATION_NONCE PLAN_HASH | seed REPO WORKTREE INVOCATION_NONCE PLAN_HASH | refresh REPO WORKTREE BASE RUN_TOKEN INVOCATION_NONCE PLAN_HASH | integrate REPO WORKTREE SEED CANONICAL RUN_TOKEN INVOCATION_NONCE PLAN_HASH FILE... | cleanup REPO ROOT RUN_TOKEN INVOCATION_NONCE PLAN_HASH' >&2
  exit 64
}

die() { echo "build-worktree: $*" >&2; exit 65; }
abs_dir() { cd "$1" 2>/dev/null && pwd -P; }
is_abs() { [[ "$1" = /* ]]; }
valid_rel() {
  [[ -n "$1" && "$1" != /* && "$1" != *'\\'* && "$1" != *'//'*
    && "$1" != */ && "$1" != '.' && "$1" != '..' ]] || return 1
  local part
  IFS=/ read -r -a parts <<< "$1"
  for part in "${parts[@]}"; do [[ "$part" != '.' && "$part" != '..' && -n "$part" ]] || return 1; done
}

tmp_root() { abs_dir "${TMPDIR:-/tmp}"; }
private_root_for() {
  local worktree=$1 root tmp
  root=$(dirname "$worktree")
  root=$(abs_dir "$root") || return 1
  tmp=$(tmp_root) || return 1
  case "$root" in "$tmp"/claude-build-worktrees.*) ;; *) return 1 ;; esac
  [ "$(stat -f '%u' "$root" 2>/dev/null || true)" = "$(id -u)" ] || return 1
  [ ! -L "$root" ] || return 1
  printf '%s\n' "$root"
}

private_root_path() {
  local root=$1 tmp
  is_abs "$root" || return 1
  root=$(abs_dir "$root") || return 1
  tmp=$(tmp_root) || return 1
  case "$root" in "$tmp"/claude-build-worktrees.*) ;; *) return 1 ;; esac
  [ "$(stat -f '%u' "$root" 2>/dev/null || true)" = "$(id -u)" ] || return 1
  [ ! -L "$root" ] || return 1
  printf '%s\n' "$root"
}

manifest_value() {
  local file=$1 field=$2 value count
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  value=$(awk -F= -v key="$field" '
    $1 == key { count++; value=substr($0, index($0, "=") + 1) }
    END { if (count != 1) exit 1; print value }
  ' "$file") || return 1
  printf '%s\n' "$value"
}

worktree_manifest() {
  local worktree=$1 unit root
  root=$(private_root_for "$worktree") || return 1
  unit=$(basename "$worktree")
  [[ "$unit" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 1
  printf '%s/.%s.identity\n' "$root" "$unit"
}

identity_token() {
  local repo_root=$1 git_common=$2 base=$3 branch=$4 worktree=$5 run_token=$6 invocation_nonce=$7 plan_hash=$8
  printf '%s\0%s\0%s\0%s\0%s\0%s\0%s\0%s\0' "$repo_root" "$git_common" "$base" "$branch" "$worktree" "$run_token" "$invocation_nonce" "$plan_hash" | shasum -a 256 | awk '{print $1}'
}

invocation_binding() {
  local invocation_nonce=$1 plan_hash=$2 repo_root=$3 base=$4 units=$5
  printf '%s\0%s\0%s\0%s\0%s\0' "$invocation_nonce" "$plan_hash" "$repo_root" "$base" "$units" | shasum -a 256 | awk '{print $1}'
}

random_token() {
  local token
  token=$(openssl rand -hex 32 2>/dev/null) || return 1
  [[ "$token" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$token"
}

root_manifest_fields() {
  local file=$1 key
  while IFS='=' read -r key _; do
    case "$key" in
      version|run_token|invocation_nonce|plan_hash|binding_hash|root|repo_root|git_common|base_commit|expected_units|unit.*.branch|unit.*.path) ;;
      *) return 1 ;;
    esac
  done < "$file"
}

root_identity() {
  local repo=$1 root=$2 expected_token=${3:-} expected_base=${4:-} expected_nonce=${5:-} expected_plan_hash=${6:-}
  local manifest recorded_root repo_root git_common base token units invocation_nonce plan_hash binding_hash actual_repo_root actual_common expected_binding branch path
  root=$(private_root_path "$root") || return 1
  manifest="$root/.run.identity"
  [ -f "$manifest" ] && [ ! -L "$manifest" ] || return 1
  [ "$(stat -f '%u' "$manifest" 2>/dev/null || true)" = "$(id -u)" ] || return 1
  root_manifest_fields "$manifest" || return 1
  [ "$(manifest_value "$manifest" version)" = 3 ] || return 1
  recorded_root=$(manifest_value "$manifest" root) || return 1
  [ "$recorded_root" = "$root" ] || return 1
  repo_root=$(manifest_value "$manifest" repo_root) || return 1
  git_common=$(manifest_value "$manifest" git_common) || return 1
  base=$(manifest_value "$manifest" base_commit) || return 1
  token=$(manifest_value "$manifest" run_token) || return 1
  invocation_nonce=$(manifest_value "$manifest" invocation_nonce) || return 1
  plan_hash=$(manifest_value "$manifest" plan_hash) || return 1
  binding_hash=$(manifest_value "$manifest" binding_hash) || return 1
  units=$(manifest_value "$manifest" expected_units) || return 1
  [[ "$token" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$invocation_nonce" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$plan_hash" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$binding_hash" =~ ^[0-9a-f]{64}$ ]] || return 1
  [ -z "$expected_token" ] || [ "$token" = "$expected_token" ] || return 1
  [ -z "$expected_base" ] || [ "$base" = "$expected_base" ] || return 1
  [ -z "$expected_nonce" ] || [ "$invocation_nonce" = "$expected_nonce" ] || return 1
  [ -z "$expected_plan_hash" ] || [ "$plan_hash" = "$expected_plan_hash" ] || return 1
  [ -n "$units" ] || return 1
  actual_repo_root=$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null) || return 1
  actual_repo_root=$(realpath "$actual_repo_root") || return 1
  [ "$repo_root" = "$actual_repo_root" ] || return 1
  actual_common=$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null) || return 1
  actual_common=$(cd "$repo" && cd "$actual_common" 2>/dev/null && pwd -P) || return 1
  [ "$git_common" = "$actual_common" ] || return 1
  [[ "$base" =~ ^[0-9a-fA-F]{40,64}$ ]] || return 1
  expected_binding=$(invocation_binding "$invocation_nonce" "$plan_hash" "$repo_root" "$base" "$units")
  [ "$binding_hash" = "$expected_binding" ] || return 1

  local seen=' ' key suffix field record_unit expected_unit
  for unit in $units; do
    [[ "$unit" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 1
    case "$seen" in *" $unit "*) return 1 ;; esac
    seen="${seen}${unit} "
    branch=$(manifest_value "$manifest" "unit.$unit.branch") || return 1
    path=$(manifest_value "$manifest" "unit.$unit.path") || return 1
    [ "$branch" = "codex-build/${token:0:12}-$unit" ] || return 1
    [ "$path" = "$root/$unit" ] || return 1
  done
  # Reject well-formed-looking records for units outside the frozen set; the
  # manifest is an exact invocation contract, not an extensible hint bag.
  while IFS='=' read -r key _; do
    case "$key" in
      unit.*.branch|unit.*.path)
        suffix=${key#unit.}
        field=${suffix##*.}
        record_unit=${suffix%.$field}
        expected_unit=0
        for unit in $units; do [ "$unit" = "$record_unit" ] && expected_unit=1; done
        [ "$expected_unit" -eq 1 ] || return 1
        ;;
    esac
  done < "$manifest"
  printf '%s\n' "$token"
}

identity_manifest_fields() {
  local file=$1 key
  while IFS='=' read -r key _; do
    case "$key" in
      version|run_token|invocation_nonce|plan_hash|binding_hash|root|repo_root|git_common|base_commit|branch|worktree|unit|identity_token) ;;
      *) return 1 ;;
    esac
  done < "$file"
}

prepare_root() {
  local repo=$1 base=$2 root=$3 invocation_nonce=$4 plan_hash=$5 manifest temp repo_root git_common token unit units binding_hash
  shift 5
  [ "$#" -gt 0 ] || die 'at least one expected unit is required'
  repo=$(abs_dir "$repo") || die 'repository cannot be resolved'
  root=$(private_root_path "$root") || die 'private build root is unsafe'
  [ -z "$(find "$root" -mindepth 1 -maxdepth 1 -print -quit)" ] || die 'private build root is not empty'
  base=$(git -C "$repo" rev-parse --verify "$base^{commit}" 2>/dev/null) || die 'base is not a commit'
  [[ "$invocation_nonce" =~ ^[0-9a-f]{64}$ ]] || die 'invocation nonce must be a 64-character lowercase hexadecimal value'
  [[ "$plan_hash" =~ ^[0-9a-f]{64}$ ]] || die 'plan hash must be a 64-character lowercase hexadecimal value'
  repo_root=$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null) || die 'repository root cannot be resolved'
  repo_root=$(realpath "$repo_root") || die 'repository root cannot be resolved'
  git_common=$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null)
  git_common=$(cd "$repo" && cd "$git_common" 2>/dev/null && pwd -P) || die 'repository git directory cannot be resolved'
  token=$(random_token) || die 'cryptographically secure run token could not be generated'
  units=''
  local seen_units=' '
  for unit in "$@"; do
    [[ "$unit" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "invalid expected unit: $unit"
    case "$seen_units" in *" $unit "*) die "duplicate expected unit: $unit" ;; esac
    seen_units="${seen_units}${unit} "
    units="${units:+$units }$unit"
  done
  binding_hash=$(invocation_binding "$invocation_nonce" "$plan_hash" "$repo_root" "$base" "$units")
  manifest="$root/.run.identity"
  temp=$(mktemp "$root/.run.identity.tmp.XXXXXXXX") || die 'run manifest cannot be created'
  trap 'rm -f -- "$temp"' RETURN
  {
    printf 'version=3\nrun_token=%s\ninvocation_nonce=%s\nplan_hash=%s\nbinding_hash=%s\nroot=%s\nrepo_root=%s\ngit_common=%s\nbase_commit=%s\nexpected_units=%s\n' \
      "$token" "$invocation_nonce" "$plan_hash" "$binding_hash" "$root" "$repo_root" "$git_common" "$base" "$units"
    for unit in "$@"; do
      printf 'unit.%s.branch=codex-build/%s-%s\nunit.%s.path=%s/%s\n' "$unit" "${token:0:12}" "$unit" "$unit" "$root" "$unit"
    done
  } > "$temp"
  chmod 600 "$temp"
  mv -f -- "$temp" "$manifest"
  trap - RETURN
  root_identity "$repo" "$root" "$token" "$base" "$invocation_nonce" "$plan_hash" >/dev/null || die 'new private build run manifest failed validation'
  printf '%s\n' "$token"
}

root_expected_units() {
  local root=$1 manifest
  manifest="$root/.run.identity"
  manifest_value "$manifest" expected_units
}

validate_root_children() {
  local repo=$1 root=$2 expected_token=$3 expected_base=${4:-} expected_nonce=${5:-} expected_plan_hash=${6:-}
  local token units unit child branch manifest name expected item expected_count=0 child_count=0 child_unit seen_child=' '
  token=$(root_identity "$repo" "$root" "$expected_token" "$expected_base" "$expected_nonce" "$expected_plan_hash") || return 1
  units=$(root_expected_units "$root") || return 1
  # Validate the complete top-level set before any caller is permitted to
  # refresh, integrate, or remove a child. Extra files and directories are
  # invalid rather than silently ignored.
  while IFS= read -r -d '' child; do
    name=${child##*/}
    case "$name" in
      .run.identity) ;;
      .*\.identity)
        child_unit=${name#.}
        child_unit=${child_unit%.identity}
        [[ "$child_unit" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 1
        expected=0
        for item in $units; do [ "$item" = "$child_unit" ] && expected=1; done
        [ "$expected" -eq 1 ] || return 1
        [ -f "$child" ] && [ ! -L "$child" ] || return 1
        ;;
      *)
        case "$seen_child" in *" $name "*) return 1 ;; esac
        seen_child="${seen_child}${name} "
        child_count=$((child_count + 1))
        [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 1
        expected=0
        for item in $units; do [ "$item" = "$name" ] && expected=1; done
        [ "$expected" -eq 1 ] || return 1
        [ -d "$child" ] && [ ! -L "$child" ] || return 1
        ;;
    esac
  done < <(find "$root" -mindepth 1 -maxdepth 1 -print0)
  for unit in $units; do
    expected_count=$((expected_count + 1))
    child="$root/$unit"
    [ -d "$child" ] && [ ! -L "$child" ] || return 1
    branch=$(manifest_value "$root/.run.identity" "unit.$unit.branch") || return 1
    manifest=$(worktree_manifest "$child" "$branch") || return 1
    validate_identity "$repo" "$child" "$expected_base" "$branch" "$expected_token" "$expected_nonce" "$expected_plan_hash" 0 || return 1
    [ -f "$manifest" ] || return 1
  done
  [ "$child_count" -eq "$expected_count" ] || return 1
  printf '%s\n' "$token"
}

write_identity() {
  local repo=$1 worktree=$2 base=$3 branch=$4 run_token=$5 invocation_nonce=$6 plan_hash=$7 manifest repo_root git_common token root units unit item unit_match unit_path expected_branch binding_hash
  repo_root=$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null) || die 'repository root cannot be resolved'
  repo_root=$(realpath "$repo_root") || die 'repository root cannot be resolved'
  git_common=$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null)
  git_common=$(cd "$repo" && cd "$git_common" 2>/dev/null && pwd -P) || die 'repository git directory cannot be resolved'
  manifest=$(worktree_manifest "$worktree" "$branch") || die 'private worktree identity path is unsafe'
  root=$(private_root_for "$worktree") || die 'private worktree root cannot be resolved'
  root_identity "$repo" "$root" "$run_token" "$base" "$invocation_nonce" "$plan_hash" >/dev/null || die 'private build run manifest is invalid'
  unit=$(basename "$worktree")
  units=$(root_expected_units "$root") || die 'private build run manifest has no expected units'
  unit_match=0
  for item in $units; do [ "$item" = "$unit" ] && unit_match=1; done
  [ "$unit_match" -eq 1 ] || die 'private worktree unit is not part of the frozen build run'
  expected_branch=$(manifest_value "$root/.run.identity" "unit.$unit.branch") || die 'private build run manifest has no expected unit branch'
  [ "$expected_branch" = "$branch" ] || die 'private worktree branch does not match the frozen build run'
  unit_path=$(manifest_value "$root/.run.identity" "unit.$unit.path") || die 'private build run manifest has no expected unit path'
  [ "$unit_path" = "$worktree" ] || die 'private worktree path does not match the frozen build run'
  binding_hash=$(manifest_value "$root/.run.identity" binding_hash) || die 'private build run binding is missing'
  token=$(identity_token "$repo_root" "$git_common" "$base" "$branch" "$worktree" "$run_token" "$invocation_nonce" "$plan_hash")
  umask 077
  printf 'version=3\nrun_token=%s\ninvocation_nonce=%s\nplan_hash=%s\nbinding_hash=%s\nroot=%s\nrepo_root=%s\ngit_common=%s\nbase_commit=%s\nbranch=%s\nworktree=%s\nunit=%s\nidentity_token=%s\n' \
    "$run_token" "$invocation_nonce" "$plan_hash" "$binding_hash" "$root" "$repo_root" "$git_common" "$base" "$branch" "$worktree" "$unit" "$token" > "$manifest"
  printf '%s\n' "$token"
}

parse_worktree_stream() {
  local target=$1 expected_head=$2 expected_identity=${3:-} mode=${4:-line} require_match=${5:-1}
  local line block_started=0 block_path='' block_head='' block_kind='' block_identity=''
  local matched=0 matched_identity='' locked_seen=0 prunable_seen=0 seen_paths=$'\n'

  finish_block() {
    [ "$block_started" -eq 1 ] || return 0
    # A bare repository record is the one valid record without HEAD/branch.
    if [ "$block_kind" = bare ]; then
      [ -z "$block_head" ] || return 1
    else
      [ -n "$block_head" ] && [ -n "$block_kind" ] || return 1
      [[ "$block_head" =~ ^[0-9a-fA-F]{40,64}$ ]] || return 1
    fi
    case "${seen_paths}" in *$'\n'"$block_path"$'\n'*) return 1 ;; esac
    seen_paths="${seen_paths}${block_path}"$'\n'
    if [ "$block_path" = "$target" ]; then
      [ "$matched" -eq 0 ] || return 1
      if [ "$block_kind" != bare ]; then
        [ -z "$expected_head" ] || [ "$block_head" = "$expected_head" ] || return 1
      fi
      if [ -n "$expected_identity" ]; then
        if [ "$expected_identity" = detached ] || [ "$expected_identity" = bare ]; then
          [ "$block_kind" = "$expected_identity" ] || return 1
        else
          [ "$block_kind" = branch ] && [ "$block_identity" = "$expected_identity" ] || return 1
        fi
      fi
      matched=1
      matched_identity=$([ "$block_kind" = branch ] && printf '%s' "$block_identity" || printf '%s' "$block_kind")
    fi
  }

  consume_record() {
    line=$1
    if [ -z "$line" ]; then
      finish_block || return 1
      block_started=0
      block_path=''
      block_head=''
      block_kind=''
      block_identity=''
      locked_seen=0
      prunable_seen=0
      return 0
    fi
    case "$line" in
      'worktree '*)
        # A record header without a separator is malformed; accepting it would
        # allow fields from adjacent records to be silently rebound.
        [ "$block_started" -eq 0 ] || return 1
        block_started=1
        block_path=${line#worktree }
        [ -n "$block_path" ] || return 1
        ;;
      'HEAD '*)
        [ "$block_started" -eq 1 ] || return 1
        [ -z "$block_head" ] || return 1
        [ -z "$block_kind" ] || return 1
        block_head=${line#HEAD }
        [ -n "$block_head" ] || return 1
        ;;
      'branch refs/heads/'*)
        [ "$block_started" -eq 1 ] && [ -n "$block_head" ] || return 1
        [ -z "$block_kind" ] || return 1
        block_identity=${line#branch refs/heads/}
        [ -n "$block_identity" ] || return 1
        block_kind=branch
        ;;
      detached|bare)
        [ "$block_started" -eq 1 ] || return 1
        [ -z "$block_kind" ] || return 1
        [ "$line" = bare ] || [ -n "$block_head" ] || return 1
        block_kind=$line
        block_identity=''
        ;;
      locked|locked\ *)
        [ "$block_started" -eq 1 ] && [ -n "$block_kind" ] || return 1
        [ "$locked_seen" -eq 0 ] || return 1
        locked_seen=1
        ;;
      prunable|prunable\ *)
        [ "$block_started" -eq 1 ] && [ -n "$block_kind" ] || return 1
        [ "$prunable_seen" -eq 0 ] || return 1
        prunable_seen=1
        ;;
      *) return 1 ;;
    esac
  }

  if [ "$mode" = nul ]; then
    while IFS= read -r -d '' line; do consume_record "$line" || return 1; done
  else
    while IFS= read -r line || [ -n "$line" ]; do consume_record "$line" || return 1; done
  fi
  finish_block || return 1
  if [ "$require_match" -eq 1 ]; then
    [ "$matched" -eq 1 ] || return 1
    printf '%s\n' "$matched_identity"
  else
    [ "$matched" -eq 0 ] || return 1
  fi
}

parse_worktree_file() {
  local file=$1 target=$2 expected_head=$3 expected_identity=${4:-} mode=${5:-nul} require_match=${6:-1}
  parse_worktree_stream "$target" "$expected_head" "$expected_identity" "$mode" "$require_match" < "$file"
}

registered_worktree() {
  local repo=$1 worktree=$2 expected_branch=${3:-} actual_head list_file result
  actual_head=$(git -C "$worktree" rev-parse --verify HEAD^{commit} 2>/dev/null) || return 1
  # Keep NUL framing through a temporary file. Command substitution destroys
  # NULs and process substitution hides the producer's exit status.
  list_file=$(mktemp "${TMPDIR:-/tmp}/claude-worktree-list.XXXXXXXX") || return 1
  if ! git -C "$repo" worktree list --porcelain -z > "$list_file" 2>/dev/null; then
    rm -f -- "$list_file"
    return 1
  fi
  result=$(parse_worktree_file "$list_file" "$worktree" "$actual_head" "$expected_branch" nul 1) || {
    rm -f -- "$list_file"
    return 1
  }
  rm -f -- "$list_file"
  printf '%s\n' "$result"
}

worktree_registered_path() {
  local repo=$1 worktree=$2 list_file
  list_file=$(mktemp "${TMPDIR:-/tmp}/claude-worktree-list.XXXXXXXX") || return 1
  if ! git -C "$repo" worktree list --porcelain -z > "$list_file" 2>/dev/null; then
    rm -f -- "$list_file"
    return 1
  fi
  parse_worktree_file "$list_file" "$worktree" '' '' nul 1 >/dev/null 2>&1
  local status=$?
  rm -f -- "$list_file"
  return "$status"
}

worktree_unregistered_path() {
  local repo=$1 worktree=$2 list_file
  list_file=$(mktemp "${TMPDIR:-/tmp}/claude-worktree-list.XXXXXXXX") || return 1
  if ! git -C "$repo" worktree list --porcelain -z > "$list_file" 2>/dev/null; then
    rm -f -- "$list_file"
    return 1
  fi
  parse_worktree_file "$list_file" "$worktree" '' '' nul 0 >/dev/null 2>&1
  local status=$?
  rm -f -- "$list_file"
  return "$status"
}

validate_identity() {
  local repo=$1 worktree=$2 expected_base=${3:-} expected_branch=${4:-} expected_token=${5:-} expected_nonce=${6:-} expected_plan_hash=${7:-} require_complete=${8:-1}
  local manifest repo_root git_common base branch recorded_worktree unit token run_token invocation_nonce plan_hash binding_hash root actual_token registered root_token
  repo=$(abs_dir "$repo") || die 'repository cannot be resolved'
  worktree=$(abs_dir "$worktree") || die 'worktree cannot be resolved'
  [ "$worktree" != "$repo" ] || die 'private worktree must not be the canonical checkout'
  [ -n "$expected_token" ] || die 'private build run token is required'
  root=$(private_root_for "$worktree") || die 'private worktree is outside its canonical mktemp root'
  root_token=$(root_identity "$repo" "$root" "$expected_token" "$expected_base" "$expected_nonce" "$expected_plan_hash") || die 'private build run manifest is invalid'
  manifest=$(worktree_manifest "$worktree" "$expected_branch") || die 'private worktree is outside its canonical mktemp root'
  [ -f "$manifest" ] && [ ! -L "$manifest" ] || die 'private worktree identity manifest is missing'
  [ "$(stat -f '%u' "$manifest" 2>/dev/null || true)" = "$(id -u)" ] || die 'private worktree identity manifest is not owned by the current user'
  identity_manifest_fields "$manifest" || die 'private worktree identity manifest contains unknown fields'
  [ "$(manifest_value "$manifest" version)" = 3 ] || die 'private worktree identity manifest has an unsupported version'
  run_token=$(manifest_value "$manifest" run_token) || die 'private worktree identity manifest is incomplete'
  invocation_nonce=$(manifest_value "$manifest" invocation_nonce) || die 'private worktree identity manifest is incomplete'
  plan_hash=$(manifest_value "$manifest" plan_hash) || die 'private worktree identity manifest is incomplete'
  binding_hash=$(manifest_value "$manifest" binding_hash) || die 'private worktree identity manifest is incomplete'
  [ "$run_token" = "$root_token" ] && [ "$run_token" = "$expected_token" ] || die 'private worktree identity belongs to another build run'
  [ "$invocation_nonce" = "$expected_nonce" ] || die 'private worktree identity belongs to another invocation'
  [ "$plan_hash" = "$expected_plan_hash" ] || die 'private worktree identity belongs to another frozen plan'
  [ "$(manifest_value "$manifest" root)" = "$root" ] || die 'private worktree identity names a different build root'
  repo_root=$(manifest_value "$manifest" repo_root) || die 'private worktree identity manifest is incomplete'
  git_common=$(manifest_value "$manifest" git_common) || die 'private worktree identity manifest is incomplete'
  base=$(manifest_value "$manifest" base_commit) || die 'private worktree identity manifest is incomplete'
  branch=$(manifest_value "$manifest" branch) || die 'private worktree identity manifest is incomplete'
  recorded_worktree=$(manifest_value "$manifest" worktree) || die 'private worktree identity manifest is incomplete'
  unit=$(manifest_value "$manifest" unit) || die 'private worktree identity manifest is incomplete'
  token=$(manifest_value "$manifest" identity_token) || die 'private worktree identity manifest is incomplete'
  [ "$recorded_worktree" = "$worktree" ] || die 'private worktree identity manifest names a different path'
  actual_repo_root=$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null) || die 'repository root cannot be resolved'
  actual_repo_root=$(realpath "$actual_repo_root") || die 'repository root cannot be resolved'
  [ "$repo_root" = "$actual_repo_root" ] || die 'private worktree identity belongs to another checkout'
  [ "$git_common" = "$(cd "$repo" && cd "$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)" ] || die 'private worktree identity belongs to another Git repository'
  [ -z "$expected_base" ] || [ "$base" = "$expected_base" ] || die 'private worktree base commit does not match the frozen plan'
  [ -z "$expected_branch" ] || [ "$branch" = "$expected_branch" ] || die 'private worktree branch does not match the expected unit'
  [[ "$branch" = codex-build/* && "$unit" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die 'private worktree identity has an invalid unit branch'
  [ "$(manifest_value "$root/.run.identity" "unit.$unit.branch")" = "$branch" ] || die 'private worktree branch is not bound to this build run'
  [ "$(manifest_value "$root/.run.identity" "unit.$unit.path")" = "$worktree" ] || die 'private worktree path is not bound to this build run'
  [ "$binding_hash" = "$(manifest_value "$root/.run.identity" binding_hash)" ] || die 'private worktree identity has a mismatched invocation binding'
  actual_token=$(identity_token "$repo_root" "$git_common" "$base" "$branch" "$worktree" "$run_token" "$invocation_nonce" "$plan_hash")
  [ "$token" = "$actual_token" ] || die 'private worktree identity token does not match its manifest'
  registered=$(registered_worktree "$repo" "$worktree" "$branch") || die 'private worktree is not registered in the frozen repository'
  [ "$registered" = "$branch" ] || die 'registered worktree branch does not match its identity manifest'
  if [ "$require_complete" -eq 1 ]; then
    validate_root_children "$repo" "$root" "$expected_token" "$expected_base" "$expected_nonce" "$expected_plan_hash" >/dev/null || die 'private build root does not contain the complete expected unit set'
  fi
}

REPO=''
WORKTREE=''
SEED=''
tmp=''
cleanup_tmp() { [ -z "$tmp" ] || rm -f -- "$tmp"; }
trap cleanup_tmp EXIT HUP INT TERM

write_seed() {
  local repo=$1 worktree=$2
  git -C "$worktree" config user.email "$(git -C "$repo" config user.email || printf 'codex-build@localhost')"
  git -C "$worktree" config user.name "$(git -C "$repo" config user.name || printf 'Codex build seed')"
  git -C "$worktree" add -A -- .
  git -C "$worktree" commit --no-verify -qm 'temporary Codex build seed' >/dev/null 2>&1 || true
  git -C "$worktree" rev-parse HEAD
}

copy_untracked() {
  local repo=$1 worktree=$2 rel src dst
  while IFS= read -r -d '' rel; do
    src="$repo/$rel"
    dst="$worktree/$rel"
    [ -L "$src" ] && die "untracked symlink cannot seed a worktree: $rel"
    [ -f "$src" ] || die "untracked path is not a regular file: $rel"
    mkdir -p -- "$(dirname "$dst")"
    cp -p -- "$src" "$dst"
  done < <(git -C "$repo" ls-files --others --exclude-standard -z)
}

seed_worktree() {
  local repo=$1 worktree=$2 invocation_nonce=$3 plan_hash=$4 diff_file base branch root run_token
  repo=$(abs_dir "$repo") || die 'repository cannot be resolved'
  worktree=$(abs_dir "$worktree") || die 'worktree cannot be resolved'
  branch=$(git -C "$worktree" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
  root=$(private_root_for "$worktree") || die 'private worktree root cannot be resolved'
  run_token=$(manifest_value "$root/.run.identity" run_token) || die 'private build run token is missing'
  validate_identity "$repo" "$worktree" '' "$branch" "$run_token" "$invocation_nonce" "$plan_hash" 0
  base=$(manifest_value "$(worktree_manifest "$worktree" "$branch")" base_commit) || die 'private worktree base is missing'
  [ "$(git -C "$worktree" rev-parse HEAD)" = "$base" ] || die 'private worktree is not at its frozen base before seeding'
  diff_file=$(mktemp "${TMPDIR:-/tmp}/claude-build-seed.XXXXXXXX")
  tmp=$diff_file
  # The working-tree diff includes staged and unstaged tracked changes exactly once.
  git -C "$repo" diff --binary HEAD -- > "$diff_file"
  if [ -s "$diff_file" ]; then git -C "$worktree" apply --binary "$diff_file"; fi
  copy_untracked "$repo" "$worktree"
  write_seed "$repo" "$worktree"
}

refresh_worktree() {
  local repo=$1 worktree=$2 base=$3 run_token=$4 invocation_nonce=$5 plan_hash=$6 branch
  repo=$(abs_dir "$repo") || die 'repository cannot be resolved'
  worktree=$(abs_dir "$worktree") || die 'worktree cannot be resolved'
  branch=$(git -C "$worktree" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
  validate_identity "$repo" "$worktree" "$base" "$branch" "$run_token" "$invocation_nonce" "$plan_hash" 1
  git -C "$worktree" rev-parse --verify "$base^{commit}" >/dev/null 2>&1 || die 'refresh base is not a commit'
  # The directory is private and disposable; reset it before reseeding the
  # canonical snapshot so repeated dependency handoffs never double-apply.
  git -C "$worktree" reset --hard "$base" >/dev/null
  git -C "$worktree" clean -fd >/dev/null
  seed_worktree "$repo" "$worktree" "$invocation_nonce" "$plan_hash"
}

cleanup_manifest_fields() {
  local file=$1 key
  while IFS='=' read -r key _; do
    case "$key" in
      version|phase|run_token|invocation_nonce|plan_hash|root|repo_root|git_common|base_commit|expected_units|unit.*.path|unit.*.branch|unit.*.state|unit.*.tombstone) ;;
      *) return 1 ;;
    esac
  done < "$file"
}

cleanup_tombstone() {
  local root=$1 unit
  unit=$2
  printf '%s/.cleanup.%s.tombstone\n' "$root" "$unit"
}

write_cleanup_tombstone() {
  local root=$1 unit=$2 invocation_nonce=$3 plan_hash=$4 path=$5 branch=$6 temp tombstone
  tombstone=$(cleanup_tombstone "$root" "$unit") || return 1
  temp=$(mktemp "$root/.cleanup.$unit.tombstone.tmp.XXXXXXXX") || return 1
  tmp=$temp
  {
    printf 'version=1\nstate=removed\nunit=%s\nroot=%s\npath=%s\nbranch=%s\ninvocation_nonce=%s\nplan_hash=%s\n' \
      "$unit" "$root" "$path" "$branch" "$invocation_nonce" "$plan_hash"
  } > "$temp" || return 1
  chmod 600 "$temp" || return 1
  mv -f -- "$temp" "$tombstone" || return 1
  tmp=''
}

write_cleanup_journal() {
  local repo=$1 root=$2 run_token=$3 invocation_nonce=$4 plan_hash=$5 phase=$6 units=$7
  local temp journal unit repo_root git_common base
  journal="$root/.cleanup.journal"
  repo_root=$(manifest_value "$root/.run.identity" repo_root) || return 1
  git_common=$(manifest_value "$root/.run.identity" git_common) || return 1
  base=$(manifest_value "$root/.run.identity" base_commit) || return 1
  temp=$(mktemp "$root/.cleanup.journal.tmp.XXXXXXXX") || return 1
  tmp=$temp
  {
    printf 'version=1\nphase=%s\nrun_token=%s\ninvocation_nonce=%s\nplan_hash=%s\nroot=%s\nrepo_root=%s\ngit_common=%s\nbase_commit=%s\nexpected_units=%s\n' \
      "$phase" "$run_token" "$invocation_nonce" "$plan_hash" "$root" "$repo_root" "$git_common" "$base" "$units"
    for unit in $units; do
      printf 'unit.%s.path=%s/%s\nunit.%s.branch=%s\nunit.%s.state=pending\nunit.%s.tombstone=.cleanup.%s.tombstone\n' \
        "$unit" "$root" "$unit" "$unit" "$(manifest_value "$root/.run.identity" "unit.$unit.branch")" "$unit" "$unit" "$unit"
    done
  } > "$temp" || return 1
  chmod 600 "$temp" || return 1
  mv -f -- "$temp" "$journal" || return 1
  tmp=''
}

update_cleanup_journal() {
  local root=$1 phase=$2 unit=$3 state=$4 journal temp line phase_seen=0 state_seen=0
  journal="$root/.cleanup.journal"
  [ -f "$journal" ] && [ ! -L "$journal" ] || return 1
  temp=$(mktemp "$root/.cleanup.journal.tmp.XXXXXXXX") || return 1
  tmp=$temp
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      phase=*)
        printf 'phase=%s\n' "$phase"
        phase_seen=1
        ;;
      "unit.$unit.state="*)
        printf 'unit.%s.state=%s\n' "$unit" "$state"
        state_seen=1
        ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$journal" > "$temp" || return 1
  if [ "$unit" = __phase__ ]; then
    [ "$phase_seen" -eq 1 ] || { rm -f -- "$temp"; tmp=''; return 1; }
  elif [ "$phase_seen" -ne 1 ] || [ "$state_seen" -ne 1 ]; then
    rm -f -- "$temp"
    tmp=''
    return 1
  fi
  chmod 600 "$temp" || return 1
  mv -f -- "$temp" "$journal" || return 1
  tmp=''
}

validate_tombstone() {
  local root=$1 unit=$2 invocation_nonce=$3 plan_hash=$4 path=$5 branch=$6 tombstone
  tombstone=$(cleanup_tombstone "$root" "$unit") || return 1
  [ -f "$tombstone" ] && [ ! -L "$tombstone" ] || return 1
  [ "$(manifest_value "$tombstone" version)" = 1 ] || return 1
  [ "$(manifest_value "$tombstone" state)" = removed ] || return 1
  [ "$(manifest_value "$tombstone" unit)" = "$unit" ] || return 1
  [ "$(manifest_value "$tombstone" root)" = "$root" ] || return 1
  [ "$(manifest_value "$tombstone" path)" = "$path" ] || return 1
  [ "$(manifest_value "$tombstone" branch)" = "$branch" ] || return 1
  [ "$(manifest_value "$tombstone" invocation_nonce)" = "$invocation_nonce" ] || return 1
  [ "$(manifest_value "$tombstone" plan_hash)" = "$plan_hash" ] || return 1
}

validate_cleanup_journal() {
  local repo=$1 root=$2 run_token=$3 invocation_nonce=$4 plan_hash=$5 journal phase units unit state path branch tombstone name item
  journal="$root/.cleanup.journal"
  [ -f "$journal" ] && [ ! -L "$journal" ] || return 1
  [ "$(stat -f '%u' "$journal" 2>/dev/null || true)" = "$(id -u)" ] || return 1
  cleanup_manifest_fields "$journal" || return 1
  [ "$(manifest_value "$journal" version)" = 1 ] || return 1
  phase=$(manifest_value "$journal" phase) || return 1
  case "$phase" in removing|blocked|branches|complete) ;; *) return 1 ;; esac
  [ "$(manifest_value "$journal" run_token)" = "$run_token" ] || return 1
  [ "$(manifest_value "$journal" invocation_nonce)" = "$invocation_nonce" ] || return 1
  [ "$(manifest_value "$journal" plan_hash)" = "$plan_hash" ] || return 1
  [ "$(manifest_value "$journal" root)" = "$root" ] || return 1
  [ "$(manifest_value "$journal" repo_root)" = "$(manifest_value "$root/.run.identity" repo_root)" ] || return 1
  [ "$(manifest_value "$journal" git_common)" = "$(manifest_value "$root/.run.identity" git_common)" ] || return 1
  [ "$(manifest_value "$journal" base_commit)" = "$(manifest_value "$root/.run.identity" base_commit)" ] || return 1
  units=$(manifest_value "$root/.run.identity" expected_units) || return 1
  [ "$(manifest_value "$journal" expected_units)" = "$units" ] || return 1

  # During retry, only the journal, identity records, remaining worktrees, and
  # completed tombstones may exist at the root. Any other entry is a recovery
  # stop, never an invitation to delete more broadly.
  while IFS= read -r -d '' item; do
    name=${item##*/}
    case "$name" in
      .run.identity|.cleanup.journal) ;;
      .*\.identity)
        unit=${name#.}; unit=${unit%.identity}
        case " $units " in *" $unit "*) ;; *) return 1 ;; esac
        ;;
      .cleanup.*.tombstone)
        unit=${name#.cleanup.}; unit=${unit%.tombstone}
        case " $units " in *" $unit "*) ;; *) return 1 ;; esac
        [ -f "$item" ] && [ ! -L "$item" ] || return 1
        ;;
      *)
        case " $units " in *" $name "*) [ -d "$item" ] && [ ! -L "$item" ] || return 1 ;; *) return 1 ;; esac
        ;;
    esac
  done < <(find "$root" -mindepth 1 -maxdepth 1 -print0)

  for unit in $units; do
    path=$(manifest_value "$journal" "unit.$unit.path") || return 1
    branch=$(manifest_value "$journal" "unit.$unit.branch") || return 1
    state=$(manifest_value "$journal" "unit.$unit.state") || return 1
    [ "$path" = "$root/$unit" ] || return 1
    [ "$branch" = "$(manifest_value "$root/.run.identity" "unit.$unit.branch")" ] || return 1
    tombstone=$(manifest_value "$journal" "unit.$unit.tombstone") || return 1
    [ "$tombstone" = ".cleanup.$unit.tombstone" ] || return 1
    case "$state" in
      pending)
        if [ -d "$path" ] && [ ! -L "$path" ]; then
          validate_identity "$repo" "$path" "$(manifest_value "$root/.run.identity" base_commit)" "$branch" "$run_token" "$invocation_nonce" "$plan_hash" 0 >/dev/null || return 1
        else
          # A process can be interrupted after Git unregisters the worktree
          # but before the tombstone/journal rename. Reconcile that one
          # unambiguous completed remove so retry remains resumable.
          worktree_unregistered_path "$repo" "$path" || return 1
          if [ -f "$(cleanup_tombstone "$root" "$unit")" ]; then
            validate_tombstone "$root" "$unit" "$invocation_nonce" "$plan_hash" "$path" "$branch" || return 1
          else
            write_cleanup_tombstone "$root" "$unit" "$invocation_nonce" "$plan_hash" "$path" "$branch" || return 1
          fi
          update_cleanup_journal "$root" "$phase" "$unit" removed || return 1
        fi
        ;;
      removed|branch_removed)
        [ ! -e "$path" ] && [ ! -L "$path" ] || return 1
        worktree_unregistered_path "$repo" "$path" || return 1
        validate_tombstone "$root" "$unit" "$invocation_nonce" "$plan_hash" "$path" "$branch" || return 1
        ;;
      *) return 1 ;;
    esac
  done
}

cleanup_root() {
  local repo=$1 root=$2 run_token=$3 invocation_nonce=$4 plan_hash=$5
  local units unit state branch path remove_count=0 fail_after journal
  root=$(private_root_path "$root") || die 'worktree root is unsafe'
  [ "$run_token" != '' ] || die 'private build run token is required'
  [[ "$invocation_nonce" =~ ^[0-9a-f]{64}$ ]] || die 'invocation nonce is required for cleanup'
  [[ "$plan_hash" =~ ^[0-9a-f]{64}$ ]] || die 'plan hash is required for cleanup'
  journal="$root/.cleanup.journal"
  if [ -e "$journal" ]; then
    validate_cleanup_journal "$repo" "$root" "$run_token" "$invocation_nonce" "$plan_hash" || die 'cleanup recovery required: journal is inconsistent; repair the recorded state and retry'
  else
    validate_root_children "$repo" "$root" "$run_token" '' "$invocation_nonce" "$plan_hash" >/dev/null || die 'private build root failed complete-set validation; no worktree was removed'
    units=$(root_expected_units "$root") || die 'private build run manifest disappeared during cleanup'
    write_cleanup_journal "$repo" "$root" "$run_token" "$invocation_nonce" "$plan_hash" removing "$units" || die 'cleanup recovery required: durable cleanup journal could not be written'
  fi
  units=$(root_expected_units "$root") || die 'private build run manifest disappeared during cleanup'
  fail_after=${CLAUDE_BUILD_WORKTREE_FAIL_REMOVE_AFTER:-}
  if [ -n "$fail_after" ] && ! [[ "$fail_after" =~ ^[0-9]+$ ]]; then die 'cleanup failure injection must be a non-negative integer'; fi

  for unit in $units; do
    state=$(manifest_value "$journal" "unit.$unit.state") || die 'cleanup recovery required: journal is missing a unit state'
    [ "$state" = pending ] || continue
    path=$(manifest_value "$journal" "unit.$unit.path") || die 'cleanup recovery required: journal is missing a unit path'
    branch=$(manifest_value "$journal" "unit.$unit.branch") || die 'cleanup recovery required: journal is missing a unit branch'
    if [ -n "$fail_after" ] && [ "$remove_count" -ge "$fail_after" ]; then
      update_cleanup_journal "$root" blocked "$unit" pending || true
      die "cleanup recovery required: injected removal failure before $unit; retry cleanup to resume remaining units"
    fi
    git -C "$repo" worktree remove --force "$path" >/dev/null 2>&1 || {
      update_cleanup_journal "$root" blocked "$unit" pending || true
      die "cleanup recovery required: could not remove worktree $path; retry cleanup after resolving the Git error"
    }
    remove_count=$((remove_count + 1))
    worktree_unregistered_path "$repo" "$path" || {
      update_cleanup_journal "$root" blocked "$unit" pending || true
      die "cleanup recovery required: Git did not unregister worktree $path; retry cleanup after inspecting Git worktree state"
    }
    write_cleanup_tombstone "$root" "$unit" "$invocation_nonce" "$plan_hash" "$path" "$branch" || die "cleanup recovery required: tombstone for $unit could not be written; retry cleanup"
    update_cleanup_journal "$root" removing "$unit" removed || die "cleanup recovery required: journal update for $unit could not be committed; retry cleanup"
  done

  update_cleanup_journal "$root" branches __phase__ removed || die 'cleanup recovery required: branch-cleanup phase could not be journaled'
  for unit in $units; do
    state=$(manifest_value "$journal" "unit.$unit.state") || die 'cleanup recovery required: journal is missing a unit state'
    [ "$state" = removed ] || continue
    branch=$(manifest_value "$journal" "unit.$unit.branch") || die 'cleanup recovery required: journal is missing a unit branch'
    if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
      git -C "$repo" branch -D "$branch" >/dev/null 2>&1 || {
        update_cleanup_journal "$root" blocked "$unit" removed || true
        die "cleanup recovery required: could not delete branch $branch; retry cleanup after resolving the Git error"
      }
    fi
    update_cleanup_journal "$root" branches "$unit" branch_removed || die "cleanup recovery required: branch state for $unit could not be journaled; retry cleanup"
  done
  for unit in $units; do
    state=$(manifest_value "$journal" "unit.$unit.state") || die 'cleanup recovery required: journal is missing a unit state'
    [ "$state" = branch_removed ] || die 'cleanup recovery required: a worktree or branch remains before final root removal'
  done
  update_cleanup_journal "$root" complete __phase__ removed || die 'cleanup recovery required: final cleanup phase could not be journaled'
  # At this point every worktree registration and branch is gone. Remove only
  # the exact journal/tombstone/identity files, then the now-empty root.
  for unit in $units; do
    rm -f -- "$(cleanup_tombstone "$root" "$unit")" "$root/.$unit.identity" || die "cleanup recovery required: metadata for $unit could not be removed; inspect and retry"
  done
  rm -f -- "$root/.cleanup.journal" "$root/.run.identity" || die 'cleanup recovery required: final cleanup metadata could not be removed; inspect and retry'
  rmdir "$root" || die 'cleanup recovery required: private root was not empty after all registered worktrees and branches were removed; inspect and retry'
}

case "${1:-}" in
  probe)
    [ "$#" -eq 3 ] || usage
    REPO=$(abs_dir "$2") || die 'repository cannot be resolved'
    BASE=$3
    git -C "$REPO" rev-parse --verify "$BASE^{commit}" >/dev/null 2>&1 || die 'base is not a commit'
    root=$(mktemp -d "${TMPDIR:-/tmp}/claude-build-probe.XXXXXXXX")
    trap 'git -C "$REPO" worktree remove --force "$root/w" >/dev/null 2>&1 || true; rmdir "$root" 2>/dev/null || true' EXIT HUP INT TERM
    git -C "$REPO" worktree add --detach "$root/w" "$BASE" >/dev/null
    printf '%s\n' "$root/w"
    ;;
  parse-worktrees)
    [ "$#" -ge 3 ] && [ "$#" -le 4 ] || usage
    parse_worktree_stream "$2" "$3" "${4:-}"
    ;;
  parse-worktrees-z)
    [ "$#" -ge 3 ] && [ "$#" -le 4 ] || usage
    parse_worktree_stream "$2" "$3" "${4:-}" nul
    ;;
  registered-worktree)
    [ "$#" -eq 4 ] || usage
    registered_worktree "$2" "$3" "$4"
    ;;
  prepare)
    [ "$#" -ge 7 ] || usage
    prepare_root "$2" "$3" "$4" "$5" "$6" "${@:7}"
    ;;
  create)
    [ "$#" -eq 7 ] || usage
    REPO=$(abs_dir "$2") || die 'repository cannot be resolved'
    BASE=$3
    DEST=$4
    BRANCH=$5
    INVOCATION_NONCE=$6
    PLAN_HASH=$7
    is_abs "$DEST" || die 'worktree destination must be absolute'
    [[ "$BRANCH" =~ ^codex-build/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die 'invalid private branch name'
    git -C "$REPO" rev-parse --verify "$BASE^{commit}" >/dev/null 2>&1 || die 'base is not a commit'
    DEST_PARENT=$(abs_dir "$(dirname "$DEST")") || die 'worktree parent cannot be resolved'
    TMP_ROOT=$(tmp_root) || die 'private temp root cannot be resolved'
    case "$DEST_PARENT" in "$TMP_ROOT"/claude-build-worktrees.*) ;; *) die 'worktree destination is outside its private mktemp root' ;; esac
    [ "$(stat -f '%u' "$DEST_PARENT" 2>/dev/null || true)" = "$(id -u)" ] || die 'private worktree root is not owned by the current user'
    [ ! -L "$DEST_PARENT" ] || die 'private worktree root must not be a symlink'
    [ ! -e "$DEST" ] || die "destination already exists: $DEST"
    RUN_TOKEN=$(root_identity "$REPO" "$(dirname "$DEST")" '' "$BASE" "$INVOCATION_NONCE" "$PLAN_HASH") || die 'private build run manifest is missing or does not match the frozen invocation'
    git -C "$REPO" worktree add -b "$BRANCH" "$DEST" "$BASE" >/dev/null
    DEST=$(abs_dir "$DEST") || die 'created worktree cannot be resolved'
    if ! write_identity "$REPO" "$DEST" "$BASE" "$BRANCH" "$RUN_TOKEN" "$INVOCATION_NONCE" "$PLAN_HASH" >/dev/null; then
      git -C "$REPO" worktree remove --force "$DEST" >/dev/null 2>&1 || true
      die 'could not write private worktree identity'
    fi
    printf '%s\n' "$DEST"
    ;;
  seed)
    [ "$#" -eq 5 ] || usage
    seed_worktree "$2" "$3" "$4" "$5"
    ;;
  refresh)
    [ "$#" -eq 7 ] || usage
    refresh_worktree "$2" "$3" "$4" "$5" "$6" "$7"
    ;;
  integrate)
    [ "$#" -ge 8 ] || usage
    REPO=$(abs_dir "$2") || die 'repository cannot be resolved'
    WORKTREE=$(abs_dir "$3") || die 'worktree cannot be resolved'
    SEED=$4
    CANONICAL=$(abs_dir "$5") || die 'canonical checkout cannot be resolved'
    RUN_TOKEN=$6
    INVOCATION_NONCE=$7
    PLAN_HASH=$8
    shift 8
    [ "$#" -gt 0 ] || die 'at least one owned file is required'
    branch=$(git -C "$WORKTREE" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
    validate_identity "$REPO" "$WORKTREE" '' "$branch" "$RUN_TOKEN" "$INVOCATION_NONCE" "$PLAN_HASH" 1
    [ "$CANONICAL" = "$REPO" ] || die 'canonical integration checkout does not match the frozen repository'
    [ "$(git -C "$WORKTREE" rev-parse HEAD)" = "$SEED" ] || die 'private worktree HEAD does not match its seed commit'
    git -C "$WORKTREE" rev-parse --verify "$SEED^{commit}" >/dev/null 2>&1 || die 'seed is not a commit'
    owned_paths=()
    for rel in "$@"; do
      valid_rel "$rel" || die "non-canonical owned path: $rel"
      for root in "$WORKTREE" "$CANONICAL"; do
        if [ -e "$root/$rel" ] || [ -L "$root/$rel" ]; then
          [ -f "$root/$rel" ] && [ "$(realpath "$root/$rel")" = "$root/$rel" ] || die "symlink or non-regular owned path: $rel"
        fi
      done
      owned_paths+=("$rel")
    done
    is_owned() { local candidate=$1 item; for item in "${owned_paths[@]}"; do [ "$item" = "$candidate" ] && return 0; done; return 1; }
    changed_paths=()
    record_changed() { local candidate=$1 item; for item in "${changed_paths[@]-}"; do [ "$item" = "$candidate" ] && return; done; changed_paths+=("$candidate"); }
    while IFS= read -r -d '' rel; do record_changed "$rel"; done < <(git -C "$WORKTREE" diff --name-only -z "$SEED" --)
    while IFS= read -r -d '' rel; do record_changed "$rel"; done < <(git -C "$WORKTREE" ls-files --others --exclude-standard -z)
    # Include ignored files as well. A worker-created ignored artifact must not
    # escape the unit merely because Git omits it from normal untracked output.
    while IFS= read -r -d '' rel; do record_changed "$rel"; done < <(git -C "$WORKTREE" ls-files --others --ignored --exclude-standard -z)
    for rel in "${changed_paths[@]-}"; do
      [ -n "$rel" ] || continue
      is_owned "$rel" || die "unit patch escapes owned canonical paths: $rel"
    done

    tmp=$(mktemp "${TMPDIR:-/tmp}/claude-build-patch.XXXXXXXX")
    # Intent-to-add makes newly-created owned files appear in the binary diff.
    for rel in "$@"; do
      if [ -f "$WORKTREE/$rel" ] && ! git -C "$WORKTREE" ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
        git -C "$WORKTREE" add -N -- "$rel"
      fi
    done
    git -C "$WORKTREE" diff --binary "$SEED" -- "$@" > "$tmp"
    if [ -s "$tmp" ]; then
      git -C "$CANONICAL" apply --binary --check "$tmp" || die 'unit patch does not apply cleanly to the canonical checkout'
      git -C "$CANONICAL" apply --binary "$tmp"
    fi
    printf 'integrated\n'
    ;;
  cleanup)
    [ "$#" -eq 6 ] || usage
    REPO=$(abs_dir "$2") || die 'repository cannot be resolved'
    ROOT=$3
    RUN_TOKEN=$4
    INVOCATION_NONCE=$5
    PLAN_HASH=$6
    is_abs "$ROOT" || die 'worktree root must be absolute'
    TMP_ROOT=$(abs_dir "${TMPDIR:-/tmp}") || die 'private temp root cannot be resolved'
    ROOT=$(abs_dir "$ROOT") || die 'worktree root cannot be resolved'
    case "$ROOT" in "$TMP_ROOT"/claude-build-worktrees.*) ;; *) die 'refusing non-canonical worktree root' ;; esac
    [ "$(stat -f '%u' "$ROOT" 2>/dev/null || true)" = "$(id -u)" ] || die 'worktree root is not owned by the current user'
    cleanup_root "$REPO" "$ROOT" "$RUN_TOKEN" "$INVOCATION_NONCE" "$PLAN_HASH"
    ;;
  *) usage ;;
esac
