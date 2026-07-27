---
title: "What Autism Taught Me About Systems Design"
author: Michael John Peña
draft: false
date: 2026-01-08
tags:
  - Personal
  - Parenting
  - Autism
  - Systems
---

Andriel needs structure. Not wants—needs. His autism means unpredictability causes genuine distress. Over the years, I've realized he's taught me more about good systems design than any tech book.

## The Morning Routine

Andriel's morning: wake up, bathroom, breakfast (same bowl, same spoon), get dressed (clothes laid out in order), check his train schedule, brush teeth, shoes, backpack. Every day. Same order.

Miss a step? He knows. Change the order? Meltdown.

At first, I saw this as rigidity. Now I see it as clarity.

## Systems Should Be Predictable

Good code is boring. It does what you expect. Every time.

Bad code surprises you. A function that sometimes returns null, sometimes throws, sometimes returns an empty array—that's the software equivalent of changing Andriel's morning routine without warning.

```python
# Bad: Unpredictable
def get_user(id):
    if id < 0:
        return None
    if id == 0:
        raise ValueError()
    user = db.query(id)
    return user if user else {}  # Sometimes None, sometimes empty dict

# Good: Predictable
def get_user(id: int) -> Optional[User]:
    if id <= 0:
        return None
    return db.query(id)  # Always Optional[User]
```

## Error Messages Should Be Clear

When something goes wrong in Andriel's routine, vague explanations don't work.

"We can't do that today" triggers panic.

"We can't go to the train station today because it's closed for repairs. We'll go on Saturday instead when it reopens" gives him the structure to understand and adjust.

Your error messages should do the same.

```python
# Bad
raise Exception("Invalid input")

# Good
raise ValueError(
    f"User ID must be positive integer, got {user_id}. "
    f"Valid range: 1 to {MAX_USER_ID}"
)
```

## Transitions Need Warnings

You can't just switch contexts on Andriel. "Five more minutes until we leave" gives him time to mentally prepare.

Your APIs should do the same. Deprecation warnings. Migration paths. Not just "this endpoint is gone."

## Documentation Is Not Optional

I can't assume Andriel knows the plan. I tell him. Every morning: "Today we're going to school, then after school we're coming home, then dinner, then bedtime."

Even though it's the same every day, the confirmation matters. It reduces anxiety.

Your team members aren't mind readers either. Document the obvious. Future you will thank present you.

## Change Requires Extra Communication

Want to change Andriel's routine? You need to:
1. Explain the change in advance
2. Explain why it's changing
3. Walk through the new routine
4. Check understanding
5. Provide support during the transition
6. Be patient with adjustment

Sounds familiar? That's a change management process. Most teams skip steps 1-4 and wonder why adoption fails.

## Consistency Builds Trust

Andriel trusts his routines because they're consistent. Break that consistency, and trust erodes.

Your system's behavior should be consistent. If an endpoint returns data one way, all endpoints should follow that pattern. Don't make users guess.

## The Gift of Clarity

Neurotypical people tolerate ambiguity. We fill in gaps, assume context, adapt on the fly.

Andriel can't. He needs clarity. Precision. Predictability.

And you know what? That's not a limitation. That's a feature.

My best code has come from asking "Would this make sense to Andriel?" If the behavior is clear enough for him, it's clear enough for any developer.

## What I've Learned

- **Explicit is better than implicit** - Don't make users guess
- **Consistency reduces cognitive load** - Patterns matter
- **Clear errors prevent panic** - Help people understand what went wrong
- **Transitions need support** - Change is hard, make it easier
- **Documentation isn't optional** - Reduce uncertainty
- **Predictability builds confidence** - Systems should be boring

## To Other Parent Developers

If you have a child with autism, you're learning systems thinking whether you realize it or not. The patience you develop, the clarity you practice, the structure you provide—these are all skills that make you a better developer.

Andriel has made me a better engineer. Not in spite of his autism, but because of it.

## The Broader Lesson

We build systems for humans. Humans want predictability, clarity, and consistency—even if they don't have autism.

Good design serves everyone. But designing for those with the greatest need for clarity creates systems that work better for all users.

Andriel taught me that. He teaches me something new every day.

And I'm grateful.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
