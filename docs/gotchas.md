# Gotchas — rationale

Background and measurements behind the tool directives in `CLAUDE.md` and `rules/`.

## Symbol intelligence: LSP vs Serena

Serena was long configured only for Codex — if `mcp__serena__*` tools are absent, that is the
cause. The built-in `LSP` tool (definition, references, implementations, workspace symbols, call
hierarchy) is powered by the enabled `*-lsp` plugins and needs no setup. Serena adds symbol-level
*editing* — `rename_symbol`, `replace_symbol_body`, `safe_delete_symbol` — plus project memories;
its onboarding is one-time per project (`mcp__serena__onboarding`, then later sessions read
`.serena/memories/`).

## Codex as the cross-family lens

Codex runs on the `codex-companion` runtime and bills separately, so it is not for trivia. Its
async rescue agent stalls in background mode; a bounded foreground `codex exec` is the right
invocation, and the Bash tool's own `timeout` bounds it without a wrapper.

`codex exec review --uncommitted | --base <branch> | --commit <sha>` reads the repository itself,
so a review needs no assembled diff bundle. Always redirect stdin — `codex exec` blocks on a TTY
waiting for more input. For a plan, carry the text on stdin with a trailing `-`; naming a file
path in the prompt makes Codex explore instead of review.

Two failure modes produce no output and neither is a review: an empty assistant pass, and a
provider capacity refusal. Report either as a gap rather than substituting another model.

## rtk lossiness

`rtk` proxies dev commands for token savings and a hook rewrites them transparently. Its rewrites
are lossy summaries, not compact equivalents. If `rtk gain` errors, a different tool named rtk is on
PATH.

`find`, `grep` and `rg` are excluded from the rewrite (machine-local
`~/Library/Application Support/rtk/config.toml`, `[hooks] exclude_commands` — repeat it on each
machine). Measured 2026-07-27 on `~/.claude`:

| command | rewritten | direct |
|---|---|---|
| `find . -name '*.md'` | 16ms, **23** results | 634ms, 5,770 results (`fd -u`: 168ms, 5,770) |
| `grep -r 'ce-work'` | 2330ms, 13,340 matches truncated at ~200 lines | `rg`: 11ms, 18 matches |

Opposite failures, same conclusion. `find` is rewritten *lossily* — 23 of 5,770, so "no results"
stops meaning "not present". `grep` is rewritten *over-broadly* — rtk ignores .gitignore, so it
searches vendored plugin locales and backups, then truncates; 212x slower for a worse answer. A
summary is the right trade for `ls`/`cat`; it is the wrong one for a search whose whole value is
being exhaustive.

## ripgrep's -r is --replace, not --recursive

ripgrep recurses by default, so `-r` is `--replace`. The muscle-memory
`rg -rn PATTERN src` clusters as `-r n` and prints every match replaced by the
literal "n". `hooks/bash-safety.sh` denies the clustered form because the failure
is silent and the output looks plausible.

Measured 2026-07-29: five occurrences in one session. Searching for a symbol
reported `export { n } from "./n"`, which read as a mangled file; an alternation
containing "ready" turned "already provisioned" into "aln provisioned". Two led to
wrong conclusions stated out loud — first that the file was corrupt, then that
another tool's hook was rewriting output. Nothing was wrong except the flag.

Only the clustered form is denied. A genuine replacement is written with a
separate value or the long form, neither of which puts a bare letter straight
after the flag. It is denied rather than auto-corrected, because silently
dropping the flag would break a real replacement. The pattern's middle group is
optional because the clustered form leaves no second space to match, and it is
bounded by `| ; &` so another tool's `-r` (`sort -rn`, `xargs -r`) cannot trip it.

Writing about this gotcha in a shell command trips the guard: the rg and
`curl | sh` rules match the raw command text, so a heredoc or a quoted example
containing the clustered form is denied as if it were a real invocation. Only
`rm-guard.py` strips heredoc bodies first. Edit such text with the file tools.

## fd -u vs find

`fd -u` is equivalent to `fd -H -I`, which restores the results `find` returns by default —
without `-u`, fd skips hidden and gitignored paths and silently misses most of a dotfile tree.
`fd -u` is also roughly 4x faster than `find` on the same search.
