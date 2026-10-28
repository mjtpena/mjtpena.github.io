---
title: "I Planted Five Bugs to Test Claude Code's Review Levels"
description: "I hid five bugs in a real change and ran /code-review at low, medium, high and xhigh. Medium found all five for 15 cents. Here's what each level adds."
author: Michael John Peña
draft: false
date: 2026-10-25
tags:
  - Claude
  - Claude Code
  - Code Review
  - Testing
  - Evaluation
---

**TL;DR:** I wrote a realistic change to this blog's content linter, hid five bugs in it, and ran Claude Code's `/code-review` at four levels on Opus 5.5. Low found three or four of the five. Medium, high and xhigh found all five every time. What the higher levels added wasn't more of my bugs. It was real problems I hadn't planted, and one of them I'd have missed in review myself.

AI code review is easy to demo and hard to trust, because you rarely know what it missed. The fix is old-fashioned: plant bugs you know about, then count. I did that for the [local `/code-review` command](https://code.claude.com/docs/en/code-review-local), which reviews the changes in your working tree from inside a Claude Code session. Anthropic's managed [Code Review for GitHub pull requests](https://code.claude.com/docs/en/code-review) is a separate Team and Enterprise service with its own levels (Quick, Standard and Deep), and I didn't test it here.

## The change and the five bugs

The blog has a small Node script that lints all 2,205 posts. I gave it a feature I actually want: warnings when a description falls outside 120 to 160 characters or a title runs past 70, plus a `--json` flag for CI. The diff is 35 lines added and 5 removed, in one file. Inside it are five bugs, each a common way this kind of change goes wrong:

| # | Bug | What it does |
|---|---|---|
| 1 | A module-level regular expression with the `g` flag, called with `.test()` per file | `lastIndex` carries from one file to the next, so posts that have a description get "no description" warnings |
| 2 | The description length includes its surrounding quotes | Every quoted description is measured two characters too long |
| 3 | The new checks run before the `draft` skip | Draft posts get warnings they were previously exempt from |
| 4 | `--json` always calls `process.exit(0)` | A CI job using `--json` can never fail |
| 5 | `for (const w in warnings)` in the verbose output | Prints array indices instead of the warnings |

Before reviewing anything, I ran the buggy script to make sure each bug was real. The verbose listing printed `warn 0`, `warn 1`, `warn 2`. The warning count jumped from 387 to 1,574, almost all of it from bug 1. And `--json` exited 0. Bug 3 is the honest exception: the repo has no drafts today, so it changes no output yet. It's still a behaviour change nobody asked for, and I wanted to see who'd notice.

## The runs

Each review was one headless call from a fresh worktree holding the uncommitted diff:

```bash
claude -p "/code-review medium" --model opus --output-format json --max-budget-usd 8
```

I ran low, medium and high twice each, and xhigh once, all on Opus 5.5. Then I read every finding and scored it against my list. I also ran a medium review in a terminal I could watch, shown below.

![A terminal running /code-review medium on the lint script diff. Claude runs git diff, reads the script, greps for the lint command, checks for a CLAUDE.md, greps descriptions in the posts, then reports nine issues: false "no description" warnings, --verbose printing numbers, --json never failing CI, descriptions measured two characters too long, drafts getting warnings, title escapes, and three cleanups. Done in 40 seconds, 8 turns, US$0.368.](/posts/2026/2026-10-25-code-review-levels-planted-bugs/01-medium-review-run.webp)

That run is worth a closer look. Before judging the length check, Claude grepped the posts for how descriptions start, and its finding cites the writing guide's rule that descriptions are double-quoted, which is exactly what makes bug 2 bite. None of the reviews ran the script. In a `claude -p` run, any command that needs approval is denied, as the [headless docs](https://code.claude.com/docs/en/headless) explain. One review said running the script needed approval, and another said the sandbox blocked it. Everything they found came from reading the diff and the files around it. That watched run also cost US$0.37, more than twice the headless medium runs, so budget for that range.

## The scores

![A table of seven review runs. Low run 1 finds 3 of 5 and misses the quotes and drafts bugs. Low run 2 finds 4 of 5 and misses the quotes bug. Both medium runs, both high runs and the xhigh run find 5 of 5. Extra real findings rise from 0 at low to 4 at xhigh. Costs run from US$0.08 at low to US$0.65 at xhigh, and times from 14 seconds to 142 seconds.](/posts/2026/2026-10-25-code-review-levels-planted-bugs/02-scores-by-level.webp)

| Level | Planted bugs found | Extra real issues | Cost per run | Time per run |
|---|---|---|---|---|
| low | 3 and 4 of 5 | 0 | US$0.08–0.09 | 14–21 s |
| medium | 5 of 5, both runs | 0–2 | US$0.14–0.17 | 35–42 s |
| high | 5 of 5, both runs | 1–2 | US$0.24–0.25 | 42–59 s |
| xhigh | 5 of 5 | 4 | US$0.65 | 142 s |

Low caught the three bugs that make loud noise: the global regex, the `for...in` loop and the exit code. Both low runs missed the quote-counting bug, which needs you to know how the posts are written. One low run also gave me the most human moment of the week. Its whole output began:

```text
(none)

Wait, there are real bugs. Revised:
```

and then listed four of the five. Fast, cheap, and briefly overconfident.

## What the higher levels added

I counted an "extra" only when it was a separate finding, confirmed real, and not one I planted. A problem folded into a planted-bug finding didn't count. The extras across medium and above were:

- **`\s*` can cross a newline.** An empty `description:` line captures the next frontmatter field and measures that instead of reporting a missing description.
- **Folded YAML descriptions.** `description: >-` gets measured as two characters.
- **Escaped quotes in titles count towards the length.** Minor, but real.
- **`process.exit()` straight after a large `console.log`.** On platforms where pipe writes are asynchronous, the JSON can be cut off before it drains.

The xhigh run raised most of those and one more that I hadn't thought about. This repo has two Claude Code workflows that write and rewrite posts, and both run the linter without `--verbose` or `--json`, then tell the agent to "fix anything it reports". The new length checks are warnings, and warnings only list with `--verbose`. So the agents that write posts would never see the limits the change was meant to enforce. I checked: both workflow files run the bare command. That's a design flaw in my feature, not a bug in the code, and it's exactly what I'd want a senior reviewer to say.

It also quantified the escaped-quote problem: 93 posts have a `\"` in their description. I counted, and it's 93.

None of the extra findings were wrong. A couple were minor enough that I'd skip them, which is the false-positive cost you pay at the higher levels: more to read, not more noise.

## What I'm doing with this

1. **Medium is my default for my own changes.** It found every planted bug in both runs for about 15 cents and 40 seconds, and its extras were real.
2. **Low is a smoke test, not a review.** It reliably found the bugs that make noise, and missed the one that depends on how the data looks.
3. **xhigh for changes other things depend on.** The workflow finding only came from looking past the diff to who calls the script. That's worth 65 cents on shared tooling, and not worth it on a one-off.
4. **Keep your tests either way.** In headless runs no review executed the script, because nothing approved the command. Treat the review as the colleague who reads the diff, not the CI job.
5. **Plant your own bugs once.** One short session of seeding bugs in a real change told me more about where these levels sit than any benchmark would. Do it on your own codebase before you decide which level runs on every PR.

The [az-guard mod from Friday](/blog/2026-10-23-az-guard-claude-code-mod/) makes the same point from the other side: whatever you're trusting Claude with, test it with cases where you already know the answer.
