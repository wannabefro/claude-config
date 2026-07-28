#!/usr/bin/env python3
"""Re-measure the claims in rules/pipeline.md + rules/orchestration.md against
the live transcript corpus.

Those rules are explicitly data-driven ("Measured over 31 sessions, corrections
per invocation: ce-plan 1.12 ... implementer 0.05"). This recomputes them so the
numbers can be refreshed instead of aging silently.

    python3 ~/.claude/scripts/audit-pipeline.py [--since 2026-07-25] [--model claude-opus-5]

CAVEAT ON METHOD: "correction" is a regex over user messages, not the original
audit's definition, so absolute rates are NOT comparable to the numbers written
into pipeline.md. The robust signal is the *ordering* between stages and the
*drift over time* when this script is re-run against itself.
"""
import argparse, collections, datetime, glob, json, os, re, statistics as st

CORR = re.compile(
    r"\b(no,|nope|actually|instead|don'?t |do not |wrong|not what|that'?s not|"
    r"stop |revert|undo|i said|i asked|why did you|you (should|shouldn'?t|were supposed)|"
    r"use .{1,30} instead|remember (that|to)|again,|never )", re.I)
APPROVE = re.compile(
    r"^(y|ya|yes|yep|yup|ok|okay|sure|go|go ahead|do it|proceed|continue|lgtm|"
    r"ship it|approved|sounds good|perfect|thanks|ty|\U0001f44d|\+1)[.! ]*$", re.I)

STAGES = ['ce-plan', 'ce-brainstorm', 'ce-work', 'ce-code-review', 'ce-debug',
          'build', 'council', 'sam-review', 'dogfood', 'verify-this',
          'best-of-n', 'self-consistency', 'codex']


def user_text(msg):
    """Return the human-authored text of a user record, or '' if it isn't one."""
    c = msg.get('content')
    if isinstance(c, list):
        if any(isinstance(x, dict) and x.get('type') == 'tool_result' for x in c):
            return ''
        t = ' '.join(x.get('text', '') for x in c if isinstance(x, dict))
    else:
        t = str(c)
    t = re.sub(r'<system-reminder>.*?</system-reminder>', '', t, flags=re.S).strip()
    return '' if t.startswith('<') or t[:60].startswith('Caveat:') else t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', help='ISO date, e.g. 2026-07-25')
    ap.add_argument('--model', help='substring filter, e.g. claude-opus-5')
    ap.add_argument('--root', default=os.path.expanduser('~/.claude/projects'))
    a = ap.parse_args()

    files = sorted(glob.glob(os.path.join(a.root, '**', '*.jsonl'), recursive=True))
    stage = collections.defaultdict(collections.Counter)   # stage -> inv/corr
    by_model = collections.defaultdict(collections.Counter)
    agent_disp, agent_corr = collections.Counter(), collections.Counter()
    skills, tools, models = collections.Counter(), collections.Counter(), collections.Counter()
    sessions, users, approvals, corrections = set(), 0, 0, 0

    for f in files:
        cur_stage = cur_agent = model = None
        try:
            lines = open(f, errors='replace').read().splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get('isSidechain'):
                continue
            if a.since and r.get('timestamp', '')[:10] < a.since:
                continue
            m = r.get('message')
            if not isinstance(m, dict):
                continue

            if r.get('type') == 'assistant':
                model = m.get('model') or model
                if model:
                    models[model] += 1
                if a.model and model and a.model not in model:
                    continue
                for c in m.get('content') or []:
                    if not isinstance(c, dict) or c.get('type') != 'tool_use':
                        continue
                    name, inp = c.get('name', '?'), c.get('input') or {}
                    tools[name] += 1
                    blob = json.dumps(inp)[:400]
                    if name == 'Skill':
                        skills[inp.get('skill', '?')] += 1
                    if name in ('Task', 'Agent'):
                        cur_agent = inp.get('subagent_type', '?')
                        agent_disp[cur_agent] += 1
                        if cur_agent == 'implementer':
                            cur_stage = 'implementer'
                            stage[cur_stage]['inv'] += 1
                            by_model[(model, cur_stage)]['inv'] += 1
                    elif name in ('Skill', 'SlashCommand'):
                        for s in STAGES:
                            if s in blob:
                                cur_stage = s
                                stage[s]['inv'] += 1
                                by_model[(model, s)]['inv'] += 1

            elif r.get('type') == 'user':
                if a.model and model and a.model not in model:
                    continue
                txt = user_text(m)
                if not txt:
                    continue
                users += 1
                sessions.add(r.get('sessionId'))
                if APPROVE.match(txt):
                    approvals += 1
                if CORR.search(txt[:600]):
                    corrections += 1
                    if cur_stage:
                        stage[cur_stage]['corr'] += 1
                        by_model[(model, cur_stage)]['corr'] += 1
                    if cur_agent:
                        agent_corr[cur_agent] += 1

    if not users:
        print('no matching user messages'); return
    print(f'sessions {len(sessions)}  user msgs {users}  '
          f'bare approvals {approvals} ({100*approvals/users:.1f}%)  '
          f'corrective {corrections} ({100*corrections/users:.1f}%)')

    print('\n== corrections per invocation ==')
    print(f"{'stage':22}{'inv':>6}{'corr':>6}{'rate':>8}")
    for k, v in sorted(stage.items(), key=lambda x: -x[1]['inv']):
        if v['inv']:
            print(f"{k:22}{v['inv']:>6}{v['corr']:>6}{v['corr']/v['inv']:>8.2f}")

    print('\n== agent dispatches (corr-after is loose attribution) ==')
    for k, v in agent_disp.most_common(12):
        print(f'{v:6d}  {k:34} corr-after={agent_corr[k]}')

    print('\n== model mix ==')
    for k, v in models.most_common(8):
        print(f'{v:8d}  {k}')

    print('\n== dead routes (named in rules, never invoked) ==')
    for s in STAGES:
        if not stage[s]['inv']:
            print(f'      0  {s}')

    print('\n== tool call mix (top 12) ==')
    tot = sum(tools.values()) or 1
    for k, v in tools.most_common(12):
        print(f'{v:7d} ({100*v/tot:4.1f}%)  {k}')


if __name__ == '__main__':
    main()
