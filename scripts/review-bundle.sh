#!/usr/bin/env bash
# Assemble one immutable, reviewable snapshot for every review seat.
#
# Usage: review-bundle.sh [REPOSITORY] [PRIVATE_OUTPUT_DIRECTORY] [TARGET]
# The canonical patch is 01-the-diff.patch. Staged and unstaged patches are
# separate diagnostic views; they are never concatenated into the canonical
# patch. Every changed tracked regular file and untracked regular file is
# copied in full. Directories are never recursively copied.
set -euo pipefail
umask 077

REPO=${1:-.}
OUT=${2:-}
TARGET=${3:-}
if [ -z "$OUT" ]; then
  OUT=$(mktemp -d "${TMPDIR:-/tmp}/claude-review-bundle.XXXXXXXX")
else
  # A caller-supplied output is still disposable workflow state. Requiring the
  # canonical unique prefix prevents a caller from making this helper write a
  # review bundle into a shared or persistent directory.
  [ -d "$OUT" ] || { echo 'review-bundle: caller output directory must already exist' >&2; exit 65; }
fi
OUT=$(cd "$OUT" && pwd -P)
# Both the workflow-created directory and a caller-supplied directory must carry
# the canonical mktemp prefix. Such directories are safe to remove on any
# assembly failure; persistent caller paths are not accepted.
TMP_ROOT=$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P) || { echo 'review-bundle: cannot resolve private temp root' >&2; exit 65; }
case "$OUT" in
  "$TMP_ROOT"/claude-review-bundle.*) PRIVATE_OUT=1 ;;
  *) echo 'review-bundle: output directory must be a private claude-review-bundle temp directory' >&2; exit 65 ;;
esac
OUT_OWNER=$(stat -f '%u' "$OUT" 2>/dev/null || stat -c '%u' "$OUT" 2>/dev/null || true)
OUT_MODE=$(stat -f '%Lp' "$OUT" 2>/dev/null || stat -c '%a' "$OUT" 2>/dev/null || true)
if [ "$PRIVATE_OUT" -eq 1 ] && { [ "$OUT_OWNER" != "$(id -u)" ] || [ "$OUT_MODE" != '700' ]; }; then
  echo 'review-bundle: private output directory is not owner-private' >&2
  exit 65
fi
KEEP=0
cleanup() {
  # The successful bundle is owned by the review workflow and is removed by
  # cleanup-review-bundle.sh after its final consumer. Failed private bundles
  # are removed here.
  if [ "$KEEP" -eq 0 ] && [ ! -L "$OUT" ]; then
    rm -rf -- "$OUT"
  fi
}
trap cleanup EXIT HUP INT TERM

REPO=$(cd "$REPO" && pwd -P)

# A review must name the exact comparison. The only implicit target allowed is
# the checked-out branch's configured upstream, which cannot silently omit commits.
HEAD_REF=''
BASE_REF=''
HEAD_OID=''
BASE_REF_OID=''
GH_REPO=''
PR_TARGET=0
TARGET_OPERATOR='...'
remote_slug() {
  local remote slug
  remote=$(git -C "$REPO" remote get-url origin 2>/dev/null || true)
  case "$remote" in
    *github.com:*) slug=${remote##*github.com:} ;;
    *github.com/*) slug=${remote##*github.com/} ;;
    *) slug='' ;;
  esac
  slug=${slug%.git}
  slug=${slug%/}
  [[ "$slug" =~ ^[^/]+/[^/]+$ ]] || return 1
  printf '%s\n' "$slug"
}
fetch_exact_commit() {
  local oid=$1 remote=$2 ref=${3:-}
  git -C "$REPO" cat-file -e "$oid^{commit}" 2>/dev/null && return 0
  # The API OID is authoritative. Fetch that exact object; never substitute a
  # local branch with the same name or silently review a diverged checkout.
  if [ -n "$ref" ]; then
    git -C "$REPO" fetch --no-tags "$remote" "$ref" >/dev/null 2>&1 || true
  fi
  git -C "$REPO" cat-file -e "$oid^{commit}" 2>/dev/null || \
    git -C "$REPO" fetch --no-tags "$remote" "$oid" >/dev/null 2>&1 || {
    echo "review-bundle: exact GitHub commit is unavailable locally: $oid" >&2
    return 65
  }
  git -C "$REPO" cat-file -e "$oid^{commit}" 2>/dev/null || {
    echo "review-bundle: fetched object is not the requested commit: $oid" >&2
    return 65
  }
}
resolve_target() {
  local current upstream pr base_ref head_ref
  current=$(git -C "$REPO" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
  if [ -z "$TARGET" ] || [ "$TARGET" = 'the current branch diff plus uncommitted changes' ] || [ "$TARGET" = 'the current branch: committed diff against the default branch, plus any uncommitted changes' ]; then
    [ -n "$current" ] || { echo 'review-bundle: detached HEAD requires an explicit base..head target' >&2; return 65; }
    upstream=$(git -C "$REPO" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null) || {
      echo 'review-bundle: no upstream configured; pass base..head or --pr N' >&2
      return 65
    }
    BASE_REF=$upstream
    HEAD_REF=$current
    TARGET_OPERATOR='...'
  elif [[ "$TARGET" =~ ^pr[[:space:]#/:-]*([0-9]+)$ ]]; then
    pr=${BASH_REMATCH[1]}
    PR_TARGET=1
    command -v gh >/dev/null 2>&1 || { echo 'review-bundle: gh is required to resolve a PR target' >&2; return 65; }
    GH_REPO=$(remote_slug) || {
      echo 'review-bundle: PR targets require an origin GitHub remote so gh can bind the requested repository' >&2
      return 65
    }
    # Execute from the requested checkout and still pass --repo explicitly;
    # this prevents gh's ambient cwd or account default from selecting another
    # repository when repoPath is an external checkout.
    gh_pr_field() {
      local field=$1
      (cd "$REPO" && gh pr view "$pr" --repo "$GH_REPO" --json "$field" --jq ".$field") 2>/dev/null
    }
    base_ref=$(gh_pr_field baseRefName) || return 65
    head_ref=$(gh_pr_field headRefName) || return 65
    BASE_REF_OID=$(gh_pr_field baseRefOid) || return 65
    HEAD_OID=$(gh_pr_field headRefOid) || return 65
    [[ "$BASE_REF_OID" =~ ^[0-9a-fA-F]{40}$ && "$HEAD_OID" =~ ^[0-9a-fA-F]{40}$ ]] || {
      echo 'review-bundle: GitHub PR response did not contain exact baseRefOid and headRefOid values' >&2
      return 65
    }
    BASE_REF=$base_ref
    HEAD_REF=$head_ref
    TARGET_OPERATOR='...'
  elif [[ "$TARGET" =~ ^([^[:space:]]+)\.\.\.([^[:space:]]+)$ ]]; then
    BASE_REF=${BASH_REMATCH[1]}
    HEAD_REF=${BASH_REMATCH[2]}
    TARGET_OPERATOR='...'
  elif [[ "$TARGET" =~ ^([^[:space:]]+)\.\.([^[:space:]]+)$ ]]; then
    BASE_REF=${BASH_REMATCH[1]}
    HEAD_REF=${BASH_REMATCH[2]}
    TARGET_OPERATOR='..'
  else
    echo 'review-bundle: unresolved target; use base..head, pr:N, or the checked-out branch with an upstream' >&2
    return 65
  fi
  if [ "$PR_TARGET" -eq 0 ]; then
    git -C "$REPO" rev-parse --verify "$BASE_REF^{commit}" >/dev/null 2>&1 || { echo "review-bundle: base ref does not resolve: $BASE_REF" >&2; return 65; }
    [ -n "$HEAD_REF" ] && git -C "$REPO" rev-parse --verify "$HEAD_REF^{commit}" >/dev/null 2>&1 || { echo "review-bundle: head ref does not resolve: $HEAD_REF" >&2; return 65; }
  fi
  local actual_head
  actual_head=$(git -C "$REPO" rev-parse HEAD)
  if [ "$PR_TARGET" -eq 1 ]; then
    fetch_exact_commit "$HEAD_OID" "https://github.com/$GH_REPO.git" "refs/pull/$pr/head" || return 65
    fetch_exact_commit "$BASE_REF_OID" "https://github.com/$GH_REPO.git" "refs/heads/$BASE_REF" || return 65
    [ "$actual_head" = "$HEAD_OID" ] || { echo 'review-bundle: checkout HEAD does not match the requested PR head' >&2; return 65; }
  else
    HEAD_OID=$(git -C "$REPO" rev-parse "$HEAD_REF")
    [ "$actual_head" = "$HEAD_OID" ] || { echo 'review-bundle: checkout branch does not match the requested head' >&2; return 65; }
  fi
  local base_oid
  if [ -n "$BASE_REF_OID" ]; then
    base_oid=$BASE_REF_OID
    [ "$(git -C "$REPO" rev-parse "$base_oid^{commit}")" = "$BASE_REF_OID" ] || {
      echo 'review-bundle: local object for GitHub PR base does not match baseRefOid' >&2
      return 65
    }
  else
    base_oid=$(git -C "$REPO" rev-parse "$BASE_REF") || return 65
  fi
  if [ "$TARGET_OPERATOR" = '...' ]; then
    BASE=$(git -C "$REPO" merge-base "$base_oid" "$HEAD_OID") || return 65
  else
    # Two-dot targets mean exactly the requested base commit. Do not silently
    # replace it with a merge-base and omit commits that exist on that base.
    BASE=$base_oid
  fi
}
resolve_target

mkdir -p "$OUT/files/after" "$OUT/files/before" "$OUT/untracked/after"
printf 'repository=%s\nbase_ref=%s\nbase_ref_oid=%s\nbase=%s\noperator=%s\nhead_ref=%s\nhead_ref_oid=%s\nhead=%s\ngh_repo=%s\ntarget=%s\ncreated_at=%s\n' "$REPO" "$BASE_REF" "$BASE_REF_OID" "$BASE" "$TARGET_OPERATOR" "$HEAD_REF" "$HEAD_OID" "$HEAD_OID" "$GH_REPO" "$TARGET" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT/00-manifest.txt"

declare -a REDACTED=()
is_denylisted() {
  # Keep this path policy in lockstep with settings.json's Read deny rules.
  # Matching is deliberately basename-aware so nested credentials cannot enter
  # a patch or snapshot merely because the parent directory was not named.
  case "$1" in
    .env|.env.*|*/.env|*/.env.*|*.env|*.env.*|.envrc|*/.envrc|\
    .npmrc|*/.npmrc|.netrc|*/.netrc|.pypirc|*/.pypirc|.terraformrc|*/.terraformrc|\
    .aws|.aws/*|*/.aws|*/.aws/*|.ssh|.ssh/*|*/.ssh|*/.ssh/*|\
    .gnupg|.gnupg/*|*/.gnupg|*/.gnupg/*|\
    .docker|.docker/*|*/.docker|*/.docker/*|.kube|.kube/*|*/.kube|*/.kube/*|\
    .config/gcloud|.config/gcloud/*|*/.config/gcloud|*/.config/gcloud/*|\
    *.pem|*.key|*.crt|*.cer|*.der|*.p12|*.pfx|*.jks|*.keystore|*.mobileprovision|\
    *.asc|*.gpg|*.tfstate|*.tfstate.*|\
    id_*|*/id_*|\
    credentials|credentials.*|*/credentials|*/credentials.*|\
    secret*|*/secret*|\
    license.dat|*/license.dat)
      return 0
      ;;
    *) return 1 ;;
  esac
}

MAX_UNTRACKED_BYTES=${MAX_UNTRACKED_BYTES:-1048576}
validate_untracked() {
  local rel src size
  while IFS= read -r -d '' rel; do
    is_denylisted "$rel" && continue
    src="$REPO/$rel"
    [ ! -L "$src" ] || { echo "review-bundle: untracked symlink is not reviewable: $rel" >&2; return 65; }
    [ -f "$src" ] || { echo "review-bundle: untracked path is not a regular file: $rel" >&2; return 65; }
    size=$(stat -f '%z' "$src" 2>/dev/null || stat -c '%s' "$src" 2>/dev/null || true)
    [[ "$size" =~ ^[0-9]+$ ]] || { echo "review-bundle: cannot size untracked file: $rel" >&2; return 65; }
    [ "$size" -le "$MAX_UNTRACKED_BYTES" ] || { echo "review-bundle: untracked file exceeds ${MAX_UNTRACKED_BYTES}-byte review bound: $rel" >&2; return 65; }
  done < <(git -C "$REPO" ls-files --others --exclude-standard -z)
}
record_redacted() {
  local rel=$1 existing
  if [ "${#REDACTED[@]}" -gt 0 ]; then
    for existing in "${REDACTED[@]}"; do
      [ "$existing" = "$rel" ] && return
    done
  fi
  REDACTED+=("$rel")
  printf 'redacted=%s reason=denylisted secret path\n' "$rel" >> "$OUT/00-manifest.txt"
}

gitlink_at_base() {
  [ "$(git -C "$REPO" cat-file -t "$BASE:$1" 2>/dev/null || true)" = commit ]
}
gitlink_in_index() {
  git -C "$REPO" ls-files --stage -- "$1" 2>/dev/null \
    | awk '$1 == "160000" { found=1 } END { exit(found ? 0 : 1) }'
}
gitlink_marker() {
  local rel=$1 dst=$2 commit=''
  if gitlink_in_index "$rel"; then
    commit=$(git -C "$REPO" ls-files --stage -- "$rel" | awk '$1 == "160000" {print $2; exit}')
  elif gitlink_at_base "$rel"; then
    commit=$(git -C "$REPO" rev-parse "$BASE:$rel" 2>/dev/null || true)
  fi
  mkdir -p "$(dirname "$dst")"
  printf 'gitlink\npath=%s\ncommit=%s\n' "$rel" "$commit" > "$dst.gitlink"
}

copy_snapshot() {
  local rel=$1 src=$2 dst=$3
  mkdir -p "$(dirname "$dst")"
  if gitlink_in_index "$rel" || gitlink_at_base "$rel"; then
    gitlink_marker "$rel" "$dst"
  elif [ -L "$src" ]; then
    readlink "$src" > "$dst.symlink-target"
  elif [ -f "$src" ]; then
    cp -p -- "$src" "$dst"
    # Preserve a line-addressable companion for read-only council agents.
    if LC_ALL=C grep -Iq . "$src" 2>/dev/null; then
      nl -ba "$src" > "$dst.line-numbered"
    fi
  elif [ -e "$src" ] || [ -d "$src" ]; then
    echo "review-bundle: refusing non-regular non-gitlink path: $rel" >&2
    return 1
  else
    printf '[deleted in working tree]\n' > "$dst"
  fi
}

copy_base_snapshot() {
  local rel=$1 dst=$2
  mkdir -p "$(dirname "$dst")"
  if gitlink_at_base "$rel"; then
    gitlink_marker "$rel" "$dst"
  elif git -C "$REPO" cat-file -e "$BASE:$rel" 2>/dev/null; then
    git -C "$REPO" show "$BASE:$rel" > "$dst"
    if LC_ALL=C grep -Iq . "$dst" 2>/dev/null; then
      nl -ba "$dst" > "$dst.line-numbered"
    fi
  fi
}

# Keep forbidden paths out of every patch before Git writes its output. This
# matters even for a deliberately unignored .env file: redaction after the
# diff would already have exposed its bytes to the review process.
filtered_diff() {
  local kind=$1
  local -a paths=()
  local rel
  add_path() {
    local existing
    if [ "${#paths[@]}" -gt 0 ]; then
      for existing in "${paths[@]}"; do
        [ "$existing" = "$1" ] && return
      done
    fi
    paths+=("$1")
  }
  case "$kind" in
    base) while IFS= read -r -d '' rel; do
      if is_denylisted "$rel"; then record_redacted "$rel"; else add_path "$rel"; fi
    done < <({ git -C "$REPO" diff --name-only -z "$BASE" --; git -C "$REPO" diff --cached --name-only -z "$BASE" --; }) ;;
    staged) while IFS= read -r -d '' rel; do
      if is_denylisted "$rel"; then record_redacted "$rel"; else add_path "$rel"; fi
    done < <(git -C "$REPO" diff --cached --name-only -z --) ;;
    unstaged) while IFS= read -r -d '' rel; do
      if is_denylisted "$rel"; then record_redacted "$rel"; else add_path "$rel"; fi
    done < <(git -C "$REPO" diff --name-only -z --) ;;
    *) echo "review-bundle: invalid diff kind" >&2; return 2 ;;
  esac
  if [ "${#paths[@]}" -eq 0 ]; then return 0; fi
  case "$kind" in
    base)
      # A staged gitlink can be present without an initialized worktree. Git's
      # combined working-tree view omits that path, so use the index-vs-base
      # view for gitlinks and the assembled working-tree view for regular files.
      for rel in "${paths[@]}"; do
        if gitlink_in_index "$rel" || gitlink_at_base "$rel"; then
          git -C "$REPO" diff --binary --cached "$BASE" -- "$rel"
        else
          git -C "$REPO" diff --binary "$BASE" -- "$rel"
        fi
      done
      ;;
    staged) git -C "$REPO" diff --binary --cached -- "${paths[@]}" ;;
    unstaged) git -C "$REPO" diff --binary -- "${paths[@]}" ;;
  esac
}

append_untracked_diff() {
  local rel rc
  while IFS= read -r -d '' rel; do
    is_denylisted "$rel" && { record_redacted "$rel"; continue; }
    # --no-index returns 1 for a real diff; any other status is an error.
    if (cd "$REPO" && git diff --no-index --binary -- /dev/null "$rel"); then
      :
    else
      rc=$?
      [ "$rc" -eq 1 ] || return "$rc"
    fi
  done < <(git -C "$REPO" ls-files --others --exclude-standard -z)
}

# Validate untracked bytes before Git or a reviewer can consume them.
validate_untracked

# One assembled view: committed base through the current working tree. This
# includes staged and unstaged tracked changes exactly once.
filtered_diff base > "$OUT/01-the-diff.patch"
append_untracked_diff >> "$OUT/01-the-diff.patch"
# These views answer which index/worktree layer supplied a hunk. They are not
# appended to 01-the-diff.patch, so reviewers never see duplicate patches.
filtered_diff staged > "$OUT/02-staged.patch"
filtered_diff unstaged > "$OUT/03-unstaged.patch"

printf '\n[tracked]\n' >> "$OUT/00-manifest.txt"
declare -a SEEN_TRACKED=()
while IFS= read -r -d '' rel; do
  if is_denylisted "$rel"; then
    record_redacted "$rel"
    continue
  fi
  already_seen=0
  if [ "${#SEEN_TRACKED[@]}" -gt 0 ]; then
    for seen in "${SEEN_TRACKED[@]}"; do
      [ "$seen" = "$rel" ] && already_seen=1 && break
    done
  fi
  [ "$already_seen" -eq 1 ] && continue
  SEEN_TRACKED+=("$rel")
  printf '%s\n' "$rel" >> "$OUT/00-manifest.txt"
  copy_snapshot "$rel" "$REPO/$rel" "$OUT/files/after/$rel"
  copy_base_snapshot "$rel" "$OUT/files/before/$rel"
done < <({ git -C "$REPO" diff --name-only -z "$BASE" --; git -C "$REPO" diff --cached --name-only -z "$BASE" --; })

printf '\n[untracked]\n' >> "$OUT/00-manifest.txt"
while IFS= read -r -d '' rel; do
  if is_denylisted "$rel"; then
    record_redacted "$rel"
    continue
  fi
  printf '%s\n' "$rel" >> "$OUT/00-manifest.txt"
  copy_snapshot "$rel" "$REPO/$rel" "$OUT/untracked/after/$rel"
done < <(git -C "$REPO" ls-files --others --exclude-standard -z)

printf '%s\n' "$OUT"
# The caller must consume the immutable bundle. cleanup-review-bundle.sh owns
# deletion after the last review seat; this script only cleans failed builds.
KEEP=1
