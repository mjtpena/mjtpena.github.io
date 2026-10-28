---
title: "What xhigh Effort Bought Me on Short Tasks: Tokens, Not Answers"
description: "ultrathink now runs at xhigh effort in Claude Code. I ran six exact-answer tasks 96 times from low to max: every level got them right; higher just cost more."
author: Michael John Peña
draft: false
date: 2026-10-27
tags:
  - Claude
  - Claude Code
  - Anthropic
  - Cost Optimization
  - Evaluation
---

**TL;DR:** Yesterday's Claude Code release made `ultrathink` in the interactive terminal run at `xhigh` effort on the Claude 5.5 models and Fable 5.1. I wanted to know what that level buys on the questions I actually ask, so I ran six tasks with exact answers across all five levels on Haiku 5.5 and three on Opus 5.5: 96 batch runs, all correct. Going from low to max on Haiku cost three times as much and took three times as long, for no gain I could measure.

The [Claude Code changelog for 2.1.311](https://code.claude.com/docs/en/changelog) says `ultrathink` in the interactive terminal now runs its turn at `xhigh` effort on Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 through Anthropic's API. I tested the level rather than the keyword, setting it with `--effort` in headless runs. That's a meaningful change to a habit. Plenty of people, me included, type "ultrathink" when a question feels hard, the way you'd tap a lift button twice. Before I make it a habit on the new models, I want to know what it does on ordinary questions.

## What effort is supposed to do

Anthropic's [effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort) describes five levels, from `low` to `max`. It's worth reading before you touch the dial, because two lines in it explain everything that follows:

- **Opus 5.5 and Haiku 5.5 default to `medium`,** not `high`. If you never set effort, you're already one level below what earlier models used by default.
- **`xhigh` is described as being for "long-running agentic and coding tasks (over 30 minutes) with token budgets in the millions".** It isn't pitched as a "think harder about this one question" switch.

The docs also say effort is "a behavioral signal, not a strict token budget". Claude still thinks on hard problems at low effort, just less than it would at higher effort.

## The test

I picked six tasks with one exact answer each, so a script could mark them without me:

| Task | What Claude had to do | Answer |
|---|---|---|
| Digit count | How many integers from 1 to 10,000 contain a 7 and are divisible by 3 | 1,150 |
| Distinct digits | How many four-digit numbers have a digit sum of 20 and four different digits | 360 |
| Divisible by 7 | How many integers up to 100,000 have a digit sum of 25 and are divisible by 7 | 804 |
| Regex trace, short | What a six-line Node.js program using a global regular expression prints | six booleans |
| Regex trace, long | The same trap with ten inputs, mixed keys and a case-insensitive flag | ten booleans |
| Repo count | How many 2025 posts in this blog's repository have no `description` | 8 |

For the first five, I ran `claude -p` with `--tools ""`, so Claude couldn't run code and had to reason the answer out. The regex traces are the nasty ones. A global regular expression keeps `lastIndex` between calls, so whether each `.test()` call matches depends on the exact length of the previous string. That's the same bug from my [code review experiment on Sunday](/blog/2026-10-25-code-review-levels-planted-bugs/). For the repo count, Claude could read and search files. Each run set the level explicitly:

```bash
claude -p "<task>" --model haiku --effort xhigh --tools "" --output-format json
```

Haiku 5.5 ran every task at all five levels, two or three times each. Opus 5.5 ran every task at low and xhigh, and the digit count, short regex trace and repo count at high. I took tokens and cost from the JSON result and timed each run.

## One puzzle, five levels

To see it happen, I ran the long regex trace on Haiku at each level, one after another, in a terminal.

![A terminal running the long regex trace on Haiku 5.5 at five effort levels. Low, medium, xhigh and max each print the expected ten booleans, using 2,481, 3,442, 4,977 and 13,751 output tokens and taking 15, 19, 24 and 56 seconds. The high run ended with a sentence of explanation instead of the answer, so it shows in red. Costs run from US$0.0016 at low to US$0.0073 at max.](/posts/2026/2026-10-27-claude-effort-levels-xhigh/01-same-puzzle-five-levels.webp)

Low got it right in 15 seconds with about 2,500 output tokens. Max got the same answer in 56 seconds with 13,751. The red row is the only miss across all my effort runs. At `high`, Haiku finished with a sentence about the regex flags instead of putting the answer on the last line as asked, so I can't tell whether it got there. Two other runs prefixed the answer with "Output:", one at `low` and one at `high`. I counted both as correct because the answer itself was right. The docs specifically recommend `high` on Haiku for strict instruction following. In my runs, more effort didn't buy better formatting.

## The batch

![A terminal table of effort results. Haiku 5.5 is 15 of 15 correct at every level, with average output tokens rising from 6,033 at low to 22,307 at max, average cost from US$0.0042 to US$0.0129 and average time from 28 to 92 seconds. Opus 5.5 is 9 of 9 at low and xhigh and 3 of 3 at high, with average cost rising from US$0.069 at low to US$0.156 at xhigh.](/posts/2026/2026-10-27-claude-effort-levels-xhigh/02-results-table.webp)

| Model and effort | Correct | Average output tokens | Average cost | Average time |
|---|---|---|---|---|
| Haiku 5.5, low | 15 of 15 | 6,033 | US$0.0042 | 28 s |
| Haiku 5.5, medium | 15 of 15 | 7,734 | US$0.0051 | 34 s |
| Haiku 5.5, high | 15 of 15 | 8,372 | US$0.0053 | 36 s |
| Haiku 5.5, xhigh | 15 of 15 | 13,369 | US$0.0081 | 53 s |
| Haiku 5.5, max | 15 of 15 | 22,307 | US$0.0129 | 92 s |
| Opus 5.5, low | 9 of 9 | 1,530 | US$0.069 | 20 s |
| Opus 5.5, high (three tasks) | 3 of 3 | 1,828 | US$0.094 | 37 s |
| Opus 5.5, xhigh | 9 of 9 | 6,536 | US$0.156 | 60 s |

In the batch, every level answered every task correctly, including Haiku at low on the divisible-by-7 count, which I'd picked expecting it to fail. Three things stood out instead.

**The spend was steep and the return flat.** Haiku's tokens went up almost fourfold from low to max, and time and cost roughly tripled. Opus at xhigh used more than four times the tokens it used at low. None of it changed an answer.

**Within one level, the spread was as large as the gap between neighbouring levels.** On the divisible-by-7 task, Haiku at low used anywhere from 10,000 to 28,000 output tokens across three runs. At high it ranged from 8,000 to 51,000. The problem set the scale of the work, and the dial only nudged it. That's what "a behavioral signal, not a strict token budget" looks like in practice.

**Model choice moved cost more than effort did.** Haiku at max averaged about a cent and a quarter per task. Opus at low averaged about seven cents. If your task is one Haiku can do, turning Haiku up is still far cheaper than reaching for Opus.

## What this doesn't show

These are short, closed problems with one right answer, finished in seconds to a few minutes. That's the kind of question people actually ultrathink, which is why I tested it. It's also exactly the work Anthropic says `xhigh` isn't for. I didn't test a 30-minute agentic task with a million-token budget, where the extra effort should earn its keep, so nothing here says `xhigh` is useless. It says it's wasted on a quick question. Every run was a single headless `claude -p` call with a short prompt. An interactive session with a long context might behave differently.

## How I'm setting effort now

For questions, I'm leaving the default alone. `medium` on Haiku 5.5 got everything right here, and Opus 5.5 was right even at `low`, so I won't ultrathink a sum. I'll save `xhigh` for the long jobs it's documented for, such as an agent refactoring a module or a migration that runs for half an hour, because my results give no reason to use it anywhere else.

When a smaller model struggles, I'll try a higher level on it before paying for a bigger one. Here, Haiku at max cost about a fifth of what Opus cost at low, and it was just as accurate.

The method matters more than my numbers. Pick ten questions from your own work with known answers, run them at two levels, and compare cost per correct answer. All 96 runs above cost under three US dollars in total.
