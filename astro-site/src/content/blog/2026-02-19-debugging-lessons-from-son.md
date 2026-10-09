---
title: "What My Son Taught Me About Debugging"
description: "My son Andriel is nine. Last weekend he was building a LEGO set and got stuck. I watched him work through it for twenty minutes without knowing he was…"
author: Michael John Peña
draft: false
date: 2026-02-19
tags:
  - Personal
  - Parenting
  - Engineering
  - Reflection
---

My son Andriel is nine. Last weekend he was building a LEGO set and got stuck. I watched him work through it for twenty minutes without knowing he was teaching me something.

## The Problem

A section wouldn't line up. He'd followed the instructions. The pieces were right. But the structure sat at a slight angle and wouldn't sit flat.

His first move: flip to the previous page and recheck the last ten steps.

## What He Didn't Do

He didn't start over. He didn't give up. He didn't ask me to fix it.

He went back to the last known good state.

## The Debugging Instinct

He found it three pages back. One piece was rotated 90 degrees. Looked almost identical in the diagram if you weren't careful. Everything after that point was technically correct—just built on a slightly wrong foundation.

He pulled back to that step. Fixed it. The rest snapped together in minutes.

## The Lesson I'd Forgotten

I've watched senior engineers make this mistake constantly. When something is broken, the instinct is to look at the last thing you changed. But sometimes the problem is further back.

The best debuggers I've worked with share a discipline:
1. Define when it last worked correctly
2. Identify what changed between then and now
3. Narrow from there

Not "what did I just do wrong?" But "what's the last known good state and how did I get here from there?"

## Kids Don't Have Learned Helplessness

Andriel didn't need me. He had the instructions, the pieces, and enough patience to backtrack.

Somewhere in adult professional life, we learn to panic faster, second-guess more, and ask for help before fully engaging with the problem ourselves.

He just worked the problem.

## Why This Hit Different

I'd been debugging a Fabric pipeline failure the day before. Spent an hour trying things before I stepped back, traced the lineage, and found a schema change from three weeks earlier that nobody had flagged.

I found it the same way Andriel found his LEGO mistake. Go back far enough. Find the divergence point.

It took me an hour. He'd have found it in twenty minutes.

## The Parenting Part

I'm trying to raise kids who can think through hard things without immediately outsourcing the discomfort.

Watching him refuse to give up—not because I told him to keep going, but because he genuinely wanted to solve it himself—that was better than anything I could teach directly.

He didn't need a debugging lesson. He already had the instincts.

I needed the reminder.

## The Bottom Line

The next time you're stuck debugging something at work, ask yourself: when did this last work correctly?

Don't look at the last change first. Look at the last good state.

My nine-year-old figured that out with LEGO. The principle scales.
