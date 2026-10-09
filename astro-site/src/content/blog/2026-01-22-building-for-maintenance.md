---
title: "Boring Code on Purpose: Writing Software I Can Maintain at 2 AM"
description: "Why I now prefer explicit, predictable code over clever one-liners, the four questions I ask before merging, and when terse code is the better choice."
author: Michael John Peña
draft: false
date: 2026-01-22
tags:
  - Engineering
  - Quality
  - Python
  - Code Review
  - Opinion
---

I'm tired of clever code. Most of the cost of software arrives after it ships, when someone who didn't write it has to work out what it does, usually under pressure. Code written to impress its author is optimised for the one moment that matters least.

## Who the code is really for

Early in my career, the thing I was proudest of was the elegant one-liner. Now the question I ask is different: will I understand this at 2 AM when it breaks?

What changed is who I think the audience is. The interpreter doesn't care how short a line is. The next person reading it does, and that person is usually tired, missing context, and trying to answer one narrow question: why did this produce the wrong output? [PEP 8](https://peps.python.org/pep-0008/#a-foolish-consistency-is-the-hobgoblin-of-little-minds) puts the underlying fact plainly: code is read much more often than it is written. Once you accept that, "maintainable" stops being a matter of taste and becomes an economic argument.

## What I value now

**Explicitness over brevity.** I'd rather read ten clear lines than decode two clever ones. Brevity hides intermediate values, and intermediate values are exactly what you need when you're debugging.

**Predictability over flexibility.** A function should do one thing, the same way, every time. Every optional flag, every "smart" default and every branch that only triggers for certain inputs is a behaviour someone has to remember. Flexibility you don't need yet is complexity you're paying for now.

**Documentation over cleverness.** A good comment shows you were thinking about the next person. The useful ones explain *why*: why this order, why this edge case is skipped, why the obvious approach doesn't work.

**Tests over hope.** If you can't test it, simplify it. Code that is hard to test is almost always code that does too many things at once.

None of these are new ideas. [PEP 20](https://peps.python.org/pep-0020/) says "explicit is better than implicit" and "readability counts", and Google's published [code review guidance](https://google.github.io/eng-practices/review/reviewer/looking-for.html) asks reviewers whether code is more complex than it needs to be, where "too complex" usually means it can't be understood quickly by code readers. Knowing the principles is easy; the hard part is choosing them when the clever version is sitting right there.

## A one-liner that isn't what it looks like

Here's the kind of line I used to be pleased with:

```python
result = [x for x in data if validate(x) and transform(x)["valid"]]
```

And here's the version I'd rather maintain:

```python
validated_items = []
for item in data:
    if not validate(item):
        continue

    transformed = transform(item)
    if transformed["valid"]:
        validated_items.append(transformed)

result = validated_items
```

The usual argument is that the second version is longer but easier to read. That's true, but there's a better argument hiding in this example: **the two versions don't do the same thing.** The comprehension calls `transform`, checks the result, then throws it away and returns the *original* `x`. The loop returns the *transformed* item. One of them is wrong for whatever the caller expects, and in the one-liner you can't see it without reading very slowly.

That's the real problem with dense code: it's slower to read, and it makes bugs look like style. In the explicit version, the variable `transformed` has a name, the thing being appended is right there, and a reviewer can ask "is it right to keep the transformed value?" In the comprehension, the question never comes up.

### The fix depends on what you meant

If you wanted the transformed values, there are two honest ways to write it. Python 3.8 added [assignment expressions](https://docs.python.org/3/whatsnew/3.8.html#assignment-expressions), so a comprehension can capture the intermediate value:

```python
result = [
    transformed
    for item in data
    if validate(item) and (transformed := transform(item))["valid"]
]
```

This is correct and still compact, but it's at the edge of what I'd accept in review. The walrus inside a condition inside a comprehension is three ideas in one expression. It also has a scoping quirk: under [PEP 572](https://peps.python.org/pep-0572/#scope-of-the-target), the walrus target binds in the enclosing scope, so `transformed` stays bound after the comprehension finishes, holding the last item it saw. That's one more surprise for the 2 AM reader. I'd usually pull it into a named function instead:

```python
from collections.abc import Iterable
from typing import Any


def validate(item: dict[str, Any]) -> bool:
    """Placeholder rule: an item needs an 'id' to be processed."""
    return "id" in item


def transform(item: dict[str, Any]) -> dict[str, Any]:
    """Placeholder transform: normalise the name and flag empty ones."""
    name = str(item.get("name", "")).strip()
    return {"id": item["id"], "name": name.title(), "valid": bool(name)}


def valid_transformed_items(data: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return transformed items, skipping items that fail validation or whose transform is marked invalid."""
    results = []
    for item in data:
        if not validate(item):
            continue

        transformed = transform(item)
        if transformed["valid"]:
            results.append(transformed)
    return results


if __name__ == "__main__":
    sample = [
        {"id": 1, "name": "  ada lovelace "},
        {"name": "missing id"},
        {"id": 3, "name": "   "},
    ]
    print(valid_transformed_items(sample))
    # [{'id': 1, 'name': 'Ada Lovelace', 'valid': True}]
```

The function name now carries the intent, the docstring states the contract, and the body is boring. Boring is the goal.

### Pin the behaviour before you refactor

Whichever version you pick, write down what it's supposed to return before you touch it. Two small tests are enough to pin the contract:

```python
from pipeline import valid_transformed_items


def test_returns_transformed_items_not_originals():
    result = valid_transformed_items([{"id": 1, "name": "  ada lovelace "}])
    assert result == [{"id": 1, "name": "Ada Lovelace", "valid": True}]


def test_skips_items_that_fail_validation_or_transform():
    data = [{"name": "no id"}, {"id": 2, "name": "   "}]
    assert valid_transformed_items(data) == []
```

This assumes the previous snippet is saved as `pipeline.py` and run with `pytest`. Run against the original comprehension, the first test fails immediately, because it returns the untransformed item. Whatever framework you use, treat "refactor for readability" as a behaviour change until a test says otherwise. I've written more about choosing what to test, and where, in [Testing AI Systems](/blog/2026-01-21-ai-testing-strategies/); the same layering applies to ordinary code.

## The questions I ask before merging

These are the four I keep coming back to, in my own pull requests and in reviews:

| Question | What it catches |
|---|---|
| Will this make sense to someone who didn't write it? | Hidden context, unnamed intermediate values, "you had to be there" logic |
| Can I debug this at 2 AM? | Nowhere to put a breakpoint, no useful log line, errors swallowed or re-raised without context |
| What happens when this breaks? | Missing failure paths, retries without limits, partial writes |
| Is this the simplest solution that works? | Abstractions built for requirements nobody has asked for |

The second question is the one people underrate. A useful test: imagine the function returned the wrong answer in production. Where would you set the breakpoint, and what would you inspect? If the honest answer is "I'd rewrite it into a loop first so I could see what's happening", rewrite it now while nobody's waiting on you.

Questions alone rely on reviewers remembering to ask them, so I back the last one with tooling. Ruff's [`C901` complex-structure rule](https://docs.astral.sh/ruff/rules/complex-structure/) is opt-in and flags any function whose McCabe complexity exceeds [`lint.mccabe.max-complexity`](https://docs.astral.sh/ruff/settings/#lint_mccabe_max-complexity) (10 by default). Turn it on in CI and "more complex than it needs to be" becomes a failing check that someone has to justify, not a matter of taste in a review thread.

## When clever is fine

I don't want to overstate this. Not all short code is clever, and not all long code is clear.

- **Idiomatic is not clever.** `[line.strip() for line in lines]` is a comprehension every Python developer reads at a glance. Turning it into a four-line loop makes the code worse, not better. The test is whether a competent reader of that language would pause, not whether the line is short.
- **Hot paths are a real exception.** If profiling shows a tight loop matters, a less obvious but faster version is justified. Leave a comment saying why, and keep the benchmark.
- **Throwaway code has a different audience.** A notebook cell you'll delete tomorrow doesn't need a docstring. The trouble is that a lot of "throwaway" code ends up in a scheduled job six months later, so be honest about which one you're writing.
- **Verbose can be its own kind of clever.** Five layers of abstraction, a factory for one implementation, and an interface nobody else implements are just as hard to maintain as a dense one-liner. Explicit means the reader can see what happens; it doesn't mean more code.

The same logic applies outside code. I made a similar case for documentation in [What Makes Technical Writing Actually Useful](/blog/2026-01-19-technical-writing-tips/): write for the reader who has a job to do, not for the author who wants to look smart.

## The rule I actually use

You'll spend more time reading code than writing it, so write the version you'd want to read at 2 AM. In practice that means naming intermediate values, keeping functions predictable, explaining the why in comments, and pinning behaviour with tests before anyone "tidies it up".

If a reviewer has to slow down to work out what a line returns, that line is a candidate for rewriting, even if it's correct. Especially if it's correct, because the next change to it might not be.
