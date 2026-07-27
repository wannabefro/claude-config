# Gotchas — rationale

Background and measurements behind the trimmed directives in `CLAUDE.md`'s Gotchas section.

## Symbol intelligence: LSP vs Serena

Serena was long configured only for Codex — if `mcp__serena__*` tools are absent, that is the
cause. The built-in `LSP` tool (definition, references, implementations, workspace symbols, call
hierarchy) is powered by the enabled `*-lsp` plugins and needs no setup. Serena adds symbol-level
*editing* — `rename_symbol`, `replace_symbol_body`, `safe_delete_symbol` — plus project memories;
its onboarding is one-time per project (`mcp__serena__onboarding`, then later sessions read
`.serena/memories/`).

## Codex as the cross-family lens

Codex runs on the `codex-companion` runtime and bills separately, so it's not for trivia. The
async rescue agent stalls in background mode, which is why a bounded foreground `codex exec` is
the right invocation. Its two no-output failure modes and the exact invocation live in the
`codex-exec-recovery` skill.

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

## fd -u vs find

`fd -u` is equivalent to `fd -H -I`, which restores the results `find` returns by default —
without `-u`, fd skips hidden and gitignored paths and silently misses most of a dotfile tree.
`fd -u` is also roughly 4x faster than `find` on the same search.
