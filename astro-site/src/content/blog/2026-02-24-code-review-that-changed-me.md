---
title: "The Code Review That Rewired How I Think"
author: Michael John Peña
draft: false
date: 2026-02-24
tags:
  - Career
  - Engineering
  - Lessons
  - Personal
---

Seven years ago, a senior engineer reviewed my code and said nothing about the code.

I've thought about that review almost every week since.

## The Setup

Early in my career. I'd spent three days building a feature. It worked. Tests passed. I was proud of it.

I submitted the pull request. My tech lead—a quiet engineer who wrote maybe one comment a day—reviewed it.

He left one comment. On the PR description, not the code.

"Who is this for and what problem does it solve for them?"

## My Reaction

Confused. Slightly defensive. The problem was obvious—it was in the ticket.

I wrote back explaining the feature. The ticket number. The acceptance criteria.

He replied: "I know what the ticket says. I'm asking if you know why it matters to the person who will use this."

## What He Was Really Asking

He wasn't asking about users. He was asking if I understood the difference between implementing requirements and solving problems.

I'd built exactly what was specified. I'd never asked whether what was specified was actually the right thing.

That's a fine way to deliver mediocre software indefinitely.

## What Changed

I started asking "why" before writing a single line. Not to question the ticket, but to understand it well enough to make better decisions in the implementation.

Two weeks later, I was building a data export feature. Instead of immediately writing the code, I talked to the person who'd requested it.

Turned out they needed the export to fit a specific format for a downstream tool. The format in the spec was wrong—it would have required manual reformatting every time.

Twenty minutes of conversation saved three hours of wrong implementation and an unhappy user.

That conversation happened because someone asked me "who is this for and why does it matter to them?"

## The Deeper Lesson

**Code is communication.** Not just to the machine. To the next engineer who reads it. To the user it serves. To the team that maintains it.

**The spec is the minimum.** Implementing what's written is table stakes. Understanding why it's written unlocks better solutions.

**The best engineers I know are curious.** Not about the technology. About the people. Why does this person need this? What does success look like for them? What will happen if this breaks?

## What I Try to Do in Reviews Now

When I review code, I still look at the implementation. But I also ask the question I was asked.

Not always explicitly. Sometimes it's "walk me through how a user would encounter this code path." Sometimes it's "what happens if the upstream data is malformed?"

I'm looking for the same thing my tech lead was looking for: does this person understand what they're actually building and why?

## The Quiet Engineers

I've noticed a pattern. The engineers who give the most valuable feedback rarely say the most. They ask one question. They point at one thing. And it's always the right one.

My tech lead reviewed probably thousands of PRs. He knew which comments mattered and which were noise.

One question. Changed how I approach everything.

## The Bottom Line

Good code solves a problem for a real person. The best reviews help you see that person clearly.

If you're reviewing code—ask the human question, not just the technical one.

If your code is being reviewed—be able to answer who it's for and why it matters.

Everything else follows from that.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
