---
title: "Building Software I Want to Maintain"
description: "I'm tired of clever code. I want boring, maintainable code. Early career: \"Look at this elegant one-liner!\""
author: Michael John Peña
draft: false
date: 2026-01-22
tags:
  - Engineering
  - Career
  - Code-Quality
  - Opinion
---

I'm tired of clever code. I want boring, maintainable code.

## The Shift

Early career: "Look at this elegant one-liner!"

Now: "Will I understand this at 2 AM when it breaks?"

## What I Value Now

**Explicitness over brevity.** I'd rather read 10 clear lines than decode 2 clever ones.

**Predictability over flexibility.** Your function should do one thing, the same way, every time.

**Documentation over cleverness.** Comments aren't a sign of bad code. They're a sign you're thinking about the next person.

**Tests over hope.** If you can't test it, simplify it.

## Code I Want to Maintain

```python
# Not this
result = [x for x in data if validate(x) and transform(x)["valid"]]

# This
validated_items = []
for item in data:
    if not validate(item):
        continue
    
    transformed = transform(item)
    if transformed["valid"]:
        validated_items.append(transformed)

result = validated_items
```

Is the second version longer? Yes.
Will I understand it in 6 months? Also yes.

## The Questions I Ask

Before merging code:

**Will this make sense to someone who didn't write it?**

**Can I debug this at 2 AM?**

**What happens when this breaks?**

**Is this the simplest solution that works?**

## The Reminder

You'll spend more time reading code than writing it. Write code you want to read.

Future you will thank you. So will your team.
