---
title: "The Expert Trap: When Knowing the Pattern Stops You Listening"
description: "Hired for my Azure expertise on a Fabric migration, I found the client's engineers knew more than I did, and learned why that was exactly the point."
author: Michael John Peña
draft: false
date: 2026-02-17
tags:
  - Career
  - Consulting
  - Leadership
  - Lessons
---

A client hired me for my Azure expertise. Six weeks in, I realised I was the least knowledgeable person in the room about the thing that actually mattered: their system. The telling moment came in week two; it took me until week six to see what it meant, and that it was exactly as it should be.

Most consultants, architects and senior engineers fall into this at some point. I think of it as the expert trap: the point where knowing the usual answer stops you hearing the right one.

## The setup

The client was an enterprise running a large data platform migration to Microsoft Fabric. I came in with what you'd expect from someone brought in for platform expertise: patterns and reference architecture diagrams.

They had twelve engineers who had been maintaining that specific system for five years. Between them they knew every edge case, every undocumented quirk, and every reason the previous three attempts to modernise it had failed.

I walked in ready to teach. I should have walked in ready to listen.

## How the trap springs

Expertise is pattern recognition. You've seen a problem shaped like this before, you know how it usually plays out, and you reach for the answer that worked last time. Most of the time that's what clients pay for, and it's genuinely useful.

The problem is that "usually" is not "always", and the client's context can't be replaced by anything you bring with you.

I caught myself doing it in week two. One of their data engineers described an approach that looked wrong against the standard patterns I knew. I started explaining why it wouldn't work.

Then she showed me the edge case: the specific characteristics of their data, and the business constraint that turned the standard approach into a liability for them.

Constraints like that rarely show up in a reference architecture. They look like late-arriving source data, or a downstream extract that someone outside IT quietly depends on. You only learn about them from the people who have been burned by them.
To illustrate with a made-up example rather than this client's specifics: a nightly batch window that looks inefficient against every modern pattern, until you learn a regulator receives the output file at 6am and the whole schedule is built backwards from that deadline. Swap it for near-real-time streaming and you've optimised the wrong thing.

She was right. I was pattern-matching. She was problem-solving.

What stings about moments like that isn't being wrong. It's how quickly and confidently I was wrong. I started correcting her before I'd asked enough questions. That reflex is the trap, and seniority makes it worse, because the more often your pattern-matching has been right, the less you feel the need to check it.

## What the expertise was actually for

Once I stopped trying to have the answer first, my role got much clearer.

My job was to translate their deep knowledge of the system into platform patterns that would preserve it, rather than to transfer my Azure knowledge into their heads. Many of the quirks they had spent five years learning were the business rules, encoded in data.

| What I brought | What they brought |
|---|---|
| How the platform behaves and where it is heading | Why the current system behaves the way it does |
| Patterns that have worked across other organisations | Which of those patterns their data and constraints break |
| A fresh view of the architecture | The history of what had already been tried and why it failed |

**I knew the platform. They knew the problem.** Good engagements need both, and neither is enough on its own. A team with deep domain knowledge and no platform expertise rebuilds the old system on new infrastructure. An expert with platform knowledge and no domain knowledge builds a clean architecture that quietly drops the edge cases, and you find out in production.

The cost of the trap is rarely one bad meeting. It shows up later as rework, with edge cases found by users in production instead of by engineers in a workshop. Worse is the lost trust: once a team has watched you dismiss something they knew to be true, they stop volunteering the next thing.

The migration was successful, and the architecture that got it there was one we built together: their domain knowledge, my platform expertise. They could eventually have built it without me. I couldn't have built it without them, and I think that's the right outcome for a consultant.

## What I changed

### Ask before advising

My default question is now: "Before I share how I usually approach this, what have you tried before, and why didn't it work?"

That one question has saved me from recommending things that had already failed. With a team that had three failed attempts behind them, that question matters even more. Every failed attempt is a set of lessons someone paid for, and they're usually sitting in people's heads rather than in a document.

The practical version I'd recommend: before drawing a single box, ask for the runbook, the last few incident write-ups, and the list of things the team would never touch. The runbook and incident write-ups show how the system is really operated and where it breaks. The never-touch list is usually where the undocumented business rules live.

### Name what you don't know

"I know Fabric well. I don't know your business logic. Help me understand it."

Saying that out loud is efficient: it tells people exactly where you can help and where you need them, and it builds trust faster than pretending.

### Let them teach you

A domain expert who teaches you something is now invested in the solution. That ownership is worth more than being right in a meeting, because they're the ones who will run the platform long after you leave.

### Hold your patterns loosely, but don't drop them

This is the one I'd add for anyone senior. Listening doesn't mean abandoning what you know. There will be times when the team's way really is a workaround for a constraint that no longer exists, and part of your job is to say so. The difference is order: understand why something is the way it is before you argue it should change. Then argue it with specifics, not with "this is best practice".

## When expertise should win

I don't want to overcorrect. Humility can become its own trap, where the expert defers on everything and the client pays senior rates for a note-taker.

Push your view firmly when:

- **It's a platform fact, not a judgement call.** How a service behaves, what it supports, and what it costs are things you should know better than the team. Say so clearly. For example, if a design assumes a feature works the way it did on the old platform, check the current docs and show the team rather than debating it. If the team is coming from Synapse Spark, for instance, Microsoft's [comparison of Fabric Data Engineering and Azure Synapse Spark](https://learn.microsoft.com/en-us/fabric/data-engineering/comparison-between-fabric-and-azure-synapse-spark) settles most of these questions quickly, and the [Fabric what's new page](https://learn.microsoft.com/en-us/fabric/fundamentals/whats-new) is worth a look too, because features change month to month.
- **The team's habit comes from an old constraint.** Workarounds outlive their reasons. Ask what the reason was, then check whether it still applies on the new platform. A hypothetical case: a file split into small chunks because an old tool choked on large files, carried forward long after the tool was retired.
- **Security or data protection is at stake.** "We've always done it this way" isn't a reason to keep a risky pattern, such as a shared service account with broad access that everyone knows the password to.

The test I use: am I disagreeing because I understand their context and still see a better option, or because their approach doesn't match the shape I expected? Only the first one earns the argument.

## What I'd tell a new consultant

Before you take an engagement, ask who holds the domain knowledge and make sure they will be in the room, not just the sponsor (I wrote about how I filter projects in [Three Filters I Use Before Saying Yes to a Project](/blog/2026-02-12-saying-no-to-projects/)). If you're on the technical side of a similar move, the practical lessons are in [Synapse to Fabric Migration: 5 Things I Wish I'd Known](/blog/2026-01-23-fabric-migration-lessons/).

Expert knowledge is a tool, not an identity. The consultants clients remember are the ones who made the client's people feel smart by drawing out what those people already knew and putting it to work. Ask before you advise, and name your limits out loud. Save your certainty for the places where you've earned it.
