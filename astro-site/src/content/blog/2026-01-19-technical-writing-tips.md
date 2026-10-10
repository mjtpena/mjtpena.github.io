---
title: "What Makes Technical Writing Actually Useful"
description: "Most technical posts fail readers with a job to do; here is a five-part template, the gotchas worth including, and when not to use it."
author: Michael John Peña
draft: false
date: 2026-01-19
tags:
  - Writing
  - Documentation
  - Technical Writing
  - Career
  - Communication
---

Most technical posts I read don't help, because they answer a question nobody reading them was asking. The reader usually has a deadline and a broken pipeline, and the post gives them three paragraphs of theory and a "Hello World" that stops working the moment real data shows up. The same thing happens inside teams: if the README, the runbook or the wiki page can't get someone unstuck, they message the one person who knows, and that person quietly becomes the bottleneck.

## Why most technical writing misses

The failures I see are consistent enough to name.

**Walls of theory without examples.** The author knows the concept well and wants to explain it properly. The reader wants to see it work first. Theory with nothing concrete to attach it to is hard to retain.

**"Hello World" tutorials that don't scale.** A five-line demo against a toy dataset proves the library installs. It says nothing about authentication, pagination, retries, or what happens at ten million rows. That last part is where the reader needs help.

**Copy-pasted API docs.** Restating every parameter of a method adds nothing the reference page didn't already say. Worse, it goes stale the moment the API changes, and nobody updates the copy.

**No context about when or why.** This is the most common failure. A post that shows *how* to use something but never says *when* you should, or when you shouldn't, leaves the hardest decision to the reader. That decision is usually the reason they went looking in the first place.

These failures have one root cause: the writer is writing for themselves, or for an imagined reader who wants to learn for the joy of it. Most readers of technical content are trying to get work done.

## What actually helps

**Show, then explain.** Put a working example near the top, then explain how it works. Once readers have seen it run, the explanation has something to attach to.

Show-first has a cost. On security-sensitive or conceptual topics, readers copy the snippet and stop reading before they reach the caveat, so an example that disables certificate validation or grants a broad role ends up in production. When the safe use depends on a warning, put the warning inside the snippet as a comment on the risky line, or lead with one sentence of context before the code.

**Use real problems.** Give the example the shape of real work: a realistic schema, a realistic error, a realistic constraint. Placeholder values are fine (`<your-resource-name>`). Toy scenarios that skip the hard part are not.

**Trade-offs.** Say when to use this approach and when to use something else. "Use X when you need A; use Y when B matters more" is worth more than any amount of feature description. If you can't name a case where your approach is the wrong choice, you don't understand it well enough to recommend it yet.

**Gotchas.** What will break and how to fix it. The error message the reader will hit, the default that surprises everyone, the limit nobody mentions until production. Writers leave this out most often, because by the time they write it up they've forgotten how much it hurt.

Here's what that looks like in a runbook entry for a data platform. A weak entry for a failed nightly refresh says "If the refresh fails, check the logs and rerun the pipeline." A useful one names the exact error, the default behind it, the fix and the check:

```markdown
### Nightly sales refresh fails with a SQL timeout

Error (copy into search as-is):
Execution Timeout Expired. The timeout period elapsed prior to completion
of the operation or the server is not responding.

Cause: the Power Query source uses Sql.Database without a CommandTimeout,
so each query is cancelled after the documented default of ten minutes.
The FactSales query crossed that once the table grew.

Fix: set the option in the source step, then republish:
Sql.Database("<your-server>.database.windows.net", "<your-database>",
    [CommandTimeout = #duration(0, 0, 30, 0)])

Confirm: after the refresh succeeds, run
SELECT COUNT(*) FROM dbo.FactSales WHERE LoadDate = CAST(GETDATE() AS date);
and check the count is in line with the previous night's load.
```

The ten-minute default is in the [Sql.Database reference](https://learn.microsoft.com/en-us/powerquery-m/sql-database), which is exactly the kind of fact nobody reads until the refresh breaks. Raising the timeout is the quick fix; if the query keeps growing, the better fix is incremental refresh or a smaller query, and the entry should say that too.

**Explain the reasoning.** A reader who understands why a step exists can adapt it to their situation. A reader who only has the steps is stuck the moment their environment differs from yours.

## My template

When I sit down to write something technical, I use the same five-part structure:

1. **Problem:** What are we solving, and why does it matter?
2. **Solution:** A short, working example.
3. **Explanation:** How it works and why it's built that way.
4. **Gotchas:** What can go wrong, and how to recognise and fix it.
5. **Alternatives:** When to use something else instead.

As a Markdown skeleton, it looks like this:

```markdown
## The problem

Two to four sentences: what breaks or slows down without this, and who feels it.

## A working example

The smallest complete example that solves the real problem, with placeholder values.

## How it works

Walk through the example. Explain each decision, not each line.

## What will go wrong

- The error message readers will hit, what causes it, and the fix.
- The default that surprises people.
- The limit that only shows up at scale.

## When to use something else

A short comparison: this approach versus the main alternative, and the deciding factor.
```

Problem first, so the reader can decide in ten seconds whether they're in the right place. Solution second, because most readers who are in the right place want to see it working before they commit to reading the rest. Gotchas and alternatives come last, but I'd cut the explanation before I cut either of them.

## Know which kind of document you're writing

The template above suits one specific job: helping a practitioner solve a problem and understand the decision behind it. It's not the only kind of documentation, and forcing everything into it is a mistake.

The [Diátaxis framework](https://diataxis.fr/), created by Daniele Procida, is the clearest model I know for this. It splits documentation into four types, each serving a different need:

| Type | Reader's need | What it looks like |
|---|---|---|
| Tutorial | Learning by doing | A guided lesson with a guaranteed successful outcome |
| How-to guide | Completing a specific task | Numbered steps for someone who already knows the basics |
| Reference | Looking up facts | Parameters, limits, schemas: neutral and complete |
| Explanation | Understanding why | Background, design decisions and trade-offs |

My template is mostly a how-to guide with an explanation section attached. That's the right shape for a blog post aimed at practitioners. It's the wrong shape for a reference page, which should be scannable and complete rather than opinionated: keep gotchas and recommendations out of the parameter tables and put them in a linked guide instead. It's also wrong for a beginner tutorial, where gotchas and alternatives overwhelm someone who just needs one thing to work.

The most common failure in mixed documents is explanation leaking into a how-to guide. You're halfway through a numbered procedure and step four turns into three paragraphs on the history of the protocol. The fix is simple: move the explanation to its own page or section and link to it.

## Writing so people can actually scan it

Most readers skim before they read. A few habits make that work:

- **Lead with what matters most.** The [Microsoft Writing Style Guide's top 10 tips](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice) put this well: front-load the important information and keywords so people can scan. Its page on [scannable content](https://learn.microsoft.com/en-us/style-guide/scannable-content) covers headings, lists and tables in more detail. Put the answer before the backstory.
- **Make headings carry meaning.** "Configuration" tells me nothing. "Set the retry policy before you deploy" tells me what to do and when. See the before and after below.
- **Keep it short.** Cut every sentence that doesn't help the reader do or understand something. Shorter is almost always clearer.
- **Write the way you'd explain it to a colleague.** Plain words, contractions, no jargon you wouldn't use out loud. If you wouldn't say "leverage" in a conversation, don't write it.
- **Use tables for comparisons, lists for steps, and prose for reasoning.** Each format does one job well. A trade-off squeezed into a bullet point loses the "because" that makes it useful.

Here's a typical section before:

```markdown
## Configuration

The client supports a retry policy. You can configure the number of retries
and the delay between them. See the reference for all options.
```

And after:

```markdown
## Set the retry policy before you deploy

Set `maxRetries` and `retryDelaySeconds` in `appsettings.json` before the first
deployment. If the defaults are too short to ride out a throttled API during a
bulk load, the first big run fails.

Gotcha: retries apply to every request, including writes. Make sure the
operation is safe to repeat before you raise the retry count.
```

The second version tells the reader what to do, when to do it, and the one thing that will bite them. The setting names are placeholders. The shape is what matters.

## What data and AI docs need that generic advice misses

Style guides tell you how to write. They don't tell you what a README for a data pipeline or a model deployment has to contain, and that's where I see the most gaps. My checklist:

- **The data contract.** Source tables, the columns downstream reports depend on, who owns the source, and what happens when a column is renamed.
- **The refresh schedule and its time zone.** "Runs nightly" is not enough when the source system is in UTC and the business reads the report in Sydney.
- **Model and deployment versions.** For an Azure OpenAI workload, the model name, model version and deployment name, plus where to check its retirement date. "We use GPT-4o" doesn't tell the next engineer which version is in production.
- **Quotas and capacity.** The tokens-per-minute quota on the deployment, or the capacity SKU the semantic model runs on, and what the reader will see when they hit it.

None of this is prose craft. It's the operational context that lives only in the original builder's head, and it's the first thing the next person needs.

## When the template is the wrong tool

I like this structure, but I don't use it everywhere.

- **Incident runbooks** need the steps first and nothing else at the top. The person reading at 2 am needs the command, not the problem statement.
- **Architecture decision records** have their own well-established format (title, context, decision, status, consequences, from [Michael Nygard's original ADR format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)), and it's better to follow it than invent a new one.
- **Quick answers** don't need five sections. If the honest answer is one paragraph and a code snippet, write that.

A template is there to prompt your thinking. If a section has nothing useful in it, delete it rather than padding it out.

## Where AI drafting fits

AI writing tools are now part of how many teams produce documentation. They're good at first drafts, docstrings and keeping a structure consistent. I covered that side in [Documentation with AI](/blog/2025-01-24-documentation-with-ai/). They're poor at the parts this post argues matter most: the gotcha you only learn by hitting it, and the judgement about when not to use something. Those still have to come from someone who has done the work, so use AI for the scaffolding and spend your own time on the gotchas and the trade-offs.

## The test

Before you publish anything technical, ask one question: could someone use this to solve their problem without asking me?

If the answer is no, find the gap. It's usually a missing example, a missing gotcha, or a missing "use something else when…". Write for people who need to get work done.
