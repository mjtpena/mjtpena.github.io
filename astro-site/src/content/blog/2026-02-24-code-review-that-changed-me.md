---
title: "The Code Review Comment That Wasn't About the Code"
description: "Seven years ago a tech lead answered my pull request with one question about who it was for, and it still shapes how I review code."
author: Michael John Peña
draft: false
date: 2026-02-24
tags:
  - Career
  - Engineering
  - Code Review
  - Lessons
  - Personal
---

Seven years ago, a senior engineer reviewed my code and said nothing about the code. He asked one question about the person it was for, and I've thought about it almost every week since. Most review feedback I've received has been about naming, structure, or a missed edge case. That one comment was about whether I understood the job at all.

## The pull request

This was early in my career. I'd spent three days building a feature. It worked, the tests passed, and I was proud of it.

I opened the pull request. My tech lead, a quiet engineer who wrote maybe one comment a day, picked it up.

He left a single comment. Not on a line of code. On the PR description:

> "Who is this for and what problem does it solve for them?"

## How I took it

Badly, at first. I was confused and slightly defensive. The problem was obvious. It was in the ticket.

So I replied with the ticket number, a summary of the feature and the acceptance criteria.

He came back with:

> "I know what the ticket says. I'm asking if you know why it matters to the person who will use this."

## What he was actually asking

He wasn't really asking about users. He was asking whether I understood the difference between implementing requirements and solving problems.

I had built exactly what was specified. I had never asked whether what was specified was the right thing. That is a perfectly reliable way to deliver mediocre software forever: every ticket closed, every acceptance criterion ticked, and nobody's day noticeably better.

The uncomfortable part was that nothing in my process would have caught it. The tests passed because they tested the spec. The ticket was closed because the spec was met. The only check in the whole pipeline that looked past the spec was one person asking one question.

## The first time it paid off

I started asking "why" before writing a line. Not to second-guess the ticket, but to understand it well enough to make better decisions inside the implementation.

Two weeks later I was building a data export feature. Instead of going straight to the code, I talked to the person who had asked for it.

It turned out they needed the export to fit a specific format for a downstream tool. The format in the spec was wrong. As written, it would have meant manual reformatting every single time they used it.

Twenty minutes of conversation saved three hours of building the wrong thing, and an unhappy user.

That conversation only happened because someone had asked me who my work was for and why it mattered to them.

## What I took from it

**The spec is the minimum.** Meeting it is expected; understanding why it was written is what lets you make good calls on the hundred small decisions the spec never mentions: defaults, error messages, what happens when the input is ugly.

**Code is communication.** Not just to the compiler. To the next engineer who reads it, to the user it serves, and to the team that has to maintain it. A PR description that only restates the ticket is a missed chance to communicate the part that matters most.

**The best engineers I know are curious about people, not just technology.** Why does this person need this? What does success look like for them? What happens to them if it breaks?

None of this is unique to one tech lead. Google's published review guidance says much the same thing in more formal language. Its [guide to what reviewers look for](https://google.github.io/eng-practices/review/reviewer/looking-for.html) asks whether a change does what the developer intended *and* whether that is good for its users, and it counts both end users and future developers as users. Its [advice on change descriptions](https://google.github.io/eng-practices/review/developer/cl-descriptions.html) says a description should record why the change was made, not just what changed, because it becomes a permanent part of the history. My tech lead just compressed all of that into one sentence.

## How I review now

I still read the implementation. Correctness, security and maintainability matter, and I wrote about the [questions I ask before merging](/blog/2026-01-22-building-for-maintenance/) last month. But I also ask the question I was asked, in one form or another:

- "Walk me through how a user would hit this code path."
- "What happens if the upstream data is malformed?"
- "Who notices first if this breaks, and what do they see?"

I'm looking for the same thing he was: does the author understand what they're building and why?

A good answer usually fits in the PR description, in two or three lines. It names who the user is ("the finance analyst who runs the month-end report", not "users"), the outcome they need ("a file their reconciliation tool can import without editing"), and any choice the author made beyond the spec ("I defaulted empty dates to blank instead of 1900-01-01 because the import rejects that value"). If a description covers those three things, I rarely need to ask the question at all.

### When not to ask it

There's a way to get this wrong. The "who is this for" question is powerful because it's rare. If every PR gets a philosophical interrogation, it turns into a ritual people answer with boilerplate, and a dependency bump or a typo fix doesn't need a user story.

My rule of thumb: ask it when the change is user-facing, when the description only restates the ticket, or when the implementation makes a choice the spec didn't. Skip it for mechanical changes. And ask it as a genuine question, not a gotcha. The point is to get the author thinking, not to prove the reviewer is smarter. Tone decides whether a question like this lands or just stings.

It also matters more now than it did seven years ago. With coding assistants writing more of the first draft, producing code that meets a spec has become cheap. Knowing whether the spec is right hasn't.

## The quiet ones

I've noticed a pattern since. The engineers who give the most valuable feedback rarely say the most. They ask one question or point at one thing, and it's usually the right one.

My tech lead probably reviewed thousands of PRs. He knew which comments mattered and which were noise, so he left out the noise.

If you're reviewing code, ask the human question, not just the technical one. If your code is being reviewed, be ready to answer who it's for and why it matters to them. Everything else follows from that.
