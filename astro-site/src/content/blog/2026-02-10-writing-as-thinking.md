---
title: "Writing as Thinking: Forty-One Days and the Delete Step"
description: "Forty-one days of daily blogging taught me I write to find ideas, not share them, and that cutting half the draft is where the thinking happens."
author: Michael John Peña
draft: false
date: 2026-02-10
tags:
  - Personal
  - Writing
  - Career
  - Reflection
---

Forty-one days of daily blogging, and the main thing I've learned is that I don't write to share ideas. I write to find them. Most of what I believed I already knew turned out to be a feeling of knowing, and the page is where that feeling gets tested.

## The challenge wasn't what I expected

When I started blogging daily in January (the [January retrospective](/blog/2026-01-31-january-retrospective/) counts 31 posts in 31 days), I assumed the hard part would be volume: finding enough to say every single day.

It wasn't. There is always something to say. The hard part is thinking clearly enough to say it well. A topic that feels obvious in my head ("RAG needs evaluation", "keep deployments simple") falls apart the moment I try to write the second paragraph, because I have to decide what I actually mean.

Paul Graham makes the same point in [Putting Ideas into Words](https://paulgraham.com/words.html): writing about something you know well usually shows you that you didn't know it as well as you thought. Six weeks of writing daily is the most convincing evidence for that essay I've seen.

## What the page does to an idea

### Vague ideas become concrete

"AI security is important" is a sentence nobody can disagree with, which is exactly why it's useless. Writing [AI Security Basics](/blog/2026-01-28-ai-security-basics/) forced that sentence into a specific list: keys, quotas, logs, and only then prompt-level defences. Vagueness doesn't survive the writing process, because a reader can't act on it and I can't fill a section with it.

### Contradictions surface

I've written myself into corners where two things I believed contradicted each other. A paragraph arguing for simplicity can sit right above one that assumes a complex platform. That's uncomfortable, and it's also the cheapest place to find the problem. I'd much rather catch a contradiction in a draft blog post than in a production system or an architecture review.

### Lessons transfer between domains

Writing about parenting changed how I think about AI. Explaining ChatGPT to my sons in [Teaching Kids About AI](/blog/2026-01-03-teaching-kids-about-ai/) forced me into plainer language about what a model does: very good guessing, not thinking, and sounding confident isn't the same as being right. I now reach for that framing with adults too.

Writing about [deployment](/blog/2026-01-30-simple-deployment/) changed how I think about writing: add complexity only in response to a pain you can name. A post doesn't need the extra section, the caveat or the polish until a reader shows it's missing.

## The process, and the step that matters

My process is deliberately simple:

1. Notice something during the day.
2. Ask: "Why is this interesting?"
3. Write the answer.
4. Delete half of it.
5. Publish.

Step 4 is where the real thinking happens. The first draft is me finding out what I think. The cut is me deciding what I think. Every sentence I delete is a small judgement call: is this the point, or is it me circling the point? Once half the words are gone, the argument that's left is usually the one I should have started with.

Skip the cut and the post gets longer and worse.

## What I've learned about my own thinking

**I think in analogies.** Almost every post connects two different domains. That's how my brain works, and I didn't know it before writing daily. The catch is that an analogy has to hold, not just sound neat.

**I hold strong opinions loosely.** Writing makes me examine my opinions instead of just carrying them around. Some survive the examination. Some don't. That's the point of the exercise.

**I process emotions through ideas.** My "personal" posts are really about running experiences through a framework. The parenting posts, like [The Five-Minute Father](/blog/2026-01-24-present-moment-parenting/), aren't only about parenting. They're about presence, attention and intention, which turn out to matter just as much in a design review.

## The audience doesn't matter (yet)

My blog gets modest traffic. That's fine.

I'm not writing for an audience. I'm writing for clarity, and if others find it useful, that's a bonus. The primary reader is future me: every post is a dated snapshot of what I was thinking and why. I wrote more about owning that record in [Why I Still Blog in 2026](/blog/2026-01-10-why-i-still-blog/). This year I'm testing a daily cadence, which is a change from the write-when-I-have-something approach I described there.

This has a practical upside. Because I'm not chasing reach, I don't have to write the safe version of an opinion. I can write the version I actually hold and find out later whether it was right.

## The habit

Forty-one days in, it's a habit. Missing a day feels wrong, like forgetting to brush my teeth.

Some days the post is short. Some days it's technical and long. Consistency matters more than any individual post, because the thinking compounds: today's half-formed idea becomes next week's clear argument only if I keep showing up.

## If you're an engineer who doesn't write

**Start with what you learned today.** Every working day teaches something: a bug, a design trade-off, a meeting that went sideways. Write it down while it's fresh.

**Aim for published, not perfect.** A finished 400-word post beats a brilliant draft that never leaves your notes folder.

**Write for yourself first.** If you write to impress, you'll produce filler. If you write to understand, you'll produce something useful, and readers can tell the difference. (For writing aimed squarely at other people, I've put a template in [What Makes Technical Writing Actually Useful](/blog/2026-01-19-technical-writing-tips/).)

**Expect the first ten posts to be hard.** The next ten are easier. After thirty, it flows.

**Don't use this as a substitute for doing the work.** Writing clarifies thinking about real problems. It won't replace building the thing, running the test or talking to the user. A post that keeps stalling can be a sign the work behind it isn't done yet.

## Why I'll keep doing it

Writing is the cheapest, most effective thinking tool I've found. Just me, a blank page and whatever I half-believe that morning.

Engineers already know how to debug: reproduce the problem, narrow it down, remove what isn't essential. Writing is the same loop applied to your own reasoning, and skipping it means shipping thoughts you've never tested. Start with one post about something you learned this week, and cut it in half before you publish.
