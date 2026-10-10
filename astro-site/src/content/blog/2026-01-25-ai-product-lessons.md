---
title: "AI Product Lessons: Users Want Augmentation, Not Automation"
description: "What building AI features for six products taught me: users want their existing tasks done faster, visible uncertainty and easy overrides, not chat."
author: Michael John Peña
draft: false
date: 2026-01-25
tags:
  - AI
  - Product Strategy
  - UX
  - Lessons Learned
---

I've built AI features into six different products, and most of those features failed. Not because the models were weak, but because we built what we assumed users wanted instead of what they actually needed. If you're about to put a large language model in front of real users, that gap is where I've seen the most effort wasted.

## What we assumed versus what users wanted

The assumptions were the ones most teams make when a capable model lands on their desk:

- Chat interfaces for everything
- AI-generated content as the end product
- Automated decision-making
- Conversation as the primary UI

What users actually asked for was more modest and more useful:

- Faster ways to do the tasks they already do
- A reason to trust a suggestion before acting on it
- An easy way to override the AI when it's wrong
- An obvious answer to "what does this do for me?"

We were designing for the model's capabilities. Users were judging us on their own workflow.

## The pattern that works: assistant, not replacement

My rule of thumb is that the AI proposes and the person decides.

| Instead of | Build |
|---|---|
| "AI writes your code" | AI suggests completions; you accept, edit or ignore them |
| "AI generates your report" | AI drafts the report; you edit and approve it |
| "AI decides which claims to pay" | AI flags and ranks; a person makes the call |

It follows from how these systems fail. A language model is wrong some of the time, and it's wrong with the same fluent confidence it uses when it's right. If the product design removes the human from the loop, every one of those errors ships straight to the outcome. Keep the human as the decision-maker and the same error becomes a rejected suggestion that costs a few seconds.

None of this is new. Microsoft Research published the [Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) at CHI 2019, years before the current wave of copilots. Guidelines like "make clear what the system can do", "support efficient dismissal" and "support efficient correction" read like a checklist of the mistakes that sank our failed features. The [HAX Toolkit](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/) turns them into design patterns, and I'd make it required reading before anyone sketches an AI feature.

## The features that flopped

**Fully automated workflows.** Users didn't trust them, and they were right not to. Without a human checkpoint, nobody can see what the automation did until something downstream breaks. Once you add checkpoints back in, the "automation" tends to become a slower version of a suggestion feature. What I'd build instead is automation that shows its work: a run that stages its changes and presents them as a diff, record by record, so the user can approve the batch, reject individual items, or roll the lot back.

**Chat for everything.** Most tasks are faster with a traditional UI. If a user knows they want last quarter's figures filtered by region, two dropdowns beat typing a sentence and waiting for a model to interpret it. Chat adds friction whenever the user already knows exactly what they want. It earns its place when the request is genuinely open-ended.

**AI-generated content with no editing step.** Users wanted control over the final output. People are reluctant to put their name to content they can't adjust, and output that goes straight out the door takes every hallucination with it. The fix is a draft-then-approve flow: the AI produces a draft in an editable state, the user changes what they need, and nothing is sent or published until a person explicitly approves it. It also gives you a useful signal, because how much people edit a draft tells you how good the drafts really are.

## The features that worked

**Smart suggestions.** The AI proposes, the user accepts or rejects. It's fast, the cost of a wrong answer is small, and the user stays in charge. Code completion in tools like GitHub Copilot is the best-known example of the shape, and it works for the same reason: ignoring a bad suggestion costs almost nothing.

**Context-aware assistance.** Help that understands what you're doing now, rather than waiting for you to open a chat pane and explain yourself. Pre-filling a form from the document the user already has open, or suggesting the next step on a support ticket from its status and history: that's the kind of help I mean.

The cost is real, though. Gathering context means the feature reads more data, so it needs a permissions and privacy review, and every call carries more tokens, which adds latency and spend. It isn't worth it when the context is cheap for the user to supply: if one dropdown tells you what you need, ask for it rather than building a pipeline to infer it.

Proactive help can also become noise. A suggestion that fires on every keystroke or every ticket update, and is usually wrong or irrelevant, trains people to dismiss it without reading, which is alert fatigue by another name. If a proactive suggestion's acceptance rate stays low, I'd make it on-demand rather than keep interrupting people.

**Automating the busy work.** Repetitive tasks people dislike, where the time saving is obvious and the stakes of an occasional miss are low: classification, extraction, first-pass tagging, summarising long threads for triage. Low stakes still needs checking: sample outputs regularly against a small labelled set, and route low-confidence items to a person instead of guessing. It stops being busy work when the output feeds something that matters: extraction that drives payments or populates compliance records needs the same review step as any other decision.

## Lessons I'd apply to the next one

### Start with the pain point, not the model

Don't add AI because it's interesting. Find the task users complain about, measure how long it takes today, and ask whether a model makes it meaningfully shorter. If you can't name the pain point in one sentence, you're building a demo.

### Make the AI optional

Some users won't trust it, at least at first. That's fine. Keep the traditional path working and let the AI path prove itself. In my view, forcing everyone through an AI flow on day one is the fastest way to turn sceptics into opponents.

### Be honest about uncertainty, carefully

When the system is unsure, say so. Users appreciate it, and it helps them calibrate how much to rely on it, which Microsoft's [literature review on overreliance on AI](https://www.microsoft.com/en-us/research/publication/overreliance-on-ai-literature-review/) names as an important design goal: appropriate reliance, neither blind trust nor blanket dismissal.

The trap is showing a number that looks precise but isn't. A raw token probability from a language model is not a reliable confidence score for whether a claim is correct, and a "92% confident" badge invites exactly the overreliance you're trying to avoid. I'd rather use signals that mean something: "no matching source document found", "this field was inferred, not extracted", or an evaluated classifier whose scores you've actually checked against labelled data. If you can't back a confidence indicator with evidence, show the source instead and let the user judge.

The [HAX Design Library](https://www.microsoft.com/en-us/haxtoolkit/library/) files this under Guideline 11, "Make clear why the system did what it did", with pattern G11-A, "Local explanations", covering the case of explaining one specific output. For a generated answer, the practical version is an inline citation next to each claim that opens the passage it came from, so checking a claim takes one click instead of a search.

### Make overrides trivial

The AI will be wrong sometimes. Correcting it should take one click or one keystroke, not a support ticket. Capture those corrections too. Every override is free labelled data about where your feature fails, and it's the best input you'll get for your [testing strategy](/blog/2026-01-21-ai-testing-strategies/).

### Measure time saved, not sophistication

Users don't care about your model's benchmark scores. They care whether their task got faster. The metrics I'd track from day one are:

- **Task completion time**, with and without the feature.
- **Suggestion acceptance rate**: accepted divided by shown.
- **Edit and undo rate**: how often users change or reverse what the AI produced

A high acceptance rate with heavy editing tells a different story from a high acceptance rate with none. Read all three against a baseline, either a control group without the feature or the task time you measured before launch, and treat a falling acceptance rate or a rising undo rate over successive weeks as the signal to retune the feature or pull it.

### Instrument outcomes, not just model calls

Wire these metrics into your [LLM observability](/blog/2026-01-16-llm-observability/) from the start. If you already trace model calls with OpenTelemetry, the cheapest way I know is one extra counter, say `app.suggestion.outcome`, incremented from the UI's backend when a suggestion is shown and again when a user accepts, edits, undoes or dismisses it, with `outcome` and `feature` as attributes. Counting `shown` matters: a suggestion the user simply ignores never produces another event, so without it the acceptance rate has no true denominator. Emit task start and finish events (form opened to form submitted) from the same backend, so task time shares the feature attribute.

Keep the trace ID off the metric, because it would create a time series per request. Instead, log each outcome with the trace ID of the model call that produced the suggestion, so you can go from a spike in undos straight to the prompts and responses behind it.

With the Azure Monitor OpenTelemetry Distro, counters arrive as custom metrics, which you query from the `customMetrics` table (`AppMetrics` in a workspace-based resource), and the docs [recommend the Sum aggregation for counters](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-add-modify). The rates then become a query rather than an analytics project:

```kusto
customMetrics
| where timestamp > ago(7d) and name == "app.suggestion.outcome"
| extend outcome = tostring(customDimensions["outcome"]), feature = tostring(customDimensions["feature"])
| summarize shown = sumif(valueSum, outcome == "shown"),
            accepted = sumif(valueSum, outcome == "accepted"),
            undone = sumif(valueSum, outcome == "undone") by feature
| extend acceptance_rate = iff(shown > 0, accepted / shown, real(null)),
         undo_rate = iff(accepted > 0, undone / accepted, real(null))
```

## When full automation is the right call

Augmentation isn't a universal answer. Full automation makes sense when the volume is too high for human review, each individual error is cheap and reversible, and you've measured the error rate against a labelled set and the business has accepted it. Spam filtering and routing low-risk tickets fit that description. Approving payments, sending customer communications and changing access rights generally don't.

Even then, design the escape hatch: sampling for human audit, a way to reverse decisions, and alerts when the error rate drifts. For agent-style systems specifically, I've written about [human-in-the-loop patterns for agents](/blog/2024-07-17-human-in-the-loop-agents/) and the [gap between agent demos and production reality](/blog/2026-01-02-ai-agents-reality-vs-hype/).

## Four questions before you build

Before committing to an AI feature, answer these:

1. **Does it save time** on a task users already do?
2. **Is the value obvious** without a tutorial?
3. **Can users tell when to trust it** and when not to?
4. **Is there an escape hatch** that's faster than the AI path?

If any answer is "no", rethink the feature before writing code. The products that worked for me made users more effective at their own job. The ones that failed tried to do the job for them and asked users to trust the result.
