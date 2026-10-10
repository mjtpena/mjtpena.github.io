---
title: "What My Son's Autism Taught Me About Predictable Systems"
description: "Andriel needs routine, not just likes it. Living with that has changed how I design functions, error messages, API deprecations and team change."
author: Michael John Peña
draft: false
date: 2026-01-08
tags:
  - Personal
  - Parenting
  - Autism
  - Engineering
  - API Design
---

Andriel needs structure. Not wants it; needs it. His autism means unpredictability causes him genuine distress, and over the years I've realised that living with that has changed how I design software more than most of what I've read about it.

I'm not suggesting your users are autistic. This is about what designing a household for someone who can't fill in gaps has taught me, and why the same discipline helps everyone else.

## The morning routine

Andriel's morning goes like this: wake up, bathroom, breakfast (same bowl, same spoon), get dressed (clothes laid out in order), check his train schedule, brush teeth, shoes, backpack. Every day. Same order.

Miss a step? He knows. Change the order? Meltdown.

For a long time I saw this as rigidity. Now I see it as clarity. The routine is a contract. Each step has a defined input and a defined output, and he can rely on it. When the contract holds, he has the capacity for everything else the day throws at him. When it breaks, all his energy goes into coping with the break.

Most of the systems I've worked on behave the same way from the user's side. People can tolerate a lot of complexity if it's consistent. What wears them out is surprise.

## Predictable functions are boring, and that's the point

Good code is boring. It does what you expect, every time.

Bad code surprises you. A function that sometimes returns `None`, sometimes raises, and sometimes returns an empty dict is the software version of reshuffling Andriel's morning without warning. Every caller now has to handle three different kinds of nothing on top of the real result, and most will only handle one.

```python
from dataclasses import dataclass


@dataclass
class User:
    id: int
    name: str


USERS = {1: User(1, "Andriel"), 2: User(2, "Michael")}


# Unpredictable: three different "nothing" results depending on the input
def get_user_unpredictable(user_id):
    if user_id < 0:
        return None
    if user_id == 0:
        raise ValueError()
    user = USERS.get(user_id)
    return user if user else {}


# Predictable: one contract, stated in the signature
def get_user(user_id: int) -> User | None:
    """Return the user with this ID, or None if there isn't one."""
    if user_id <= 0:
        return None
    return USERS.get(user_id)


print(get_user(1))   # User(id=1, name='Andriel')
print(get_user(99))  # None
print(get_user(0))   # None
```

The second version isn't clever. It just makes one promise and keeps it, and the `User | None` union type (Python 3.10+) tells the caller what that promise is before they read a line of the body.

There is a trade-off. Collapsing every "not found" case into `None` can hide a genuine bug: a negative ID is probably a caller error, not a missing user. If that distinction matters in your system, raise a specific exception for invalid input and return `None` only for "valid but absent". What matters is that the rule is written down and never varies.

## Error messages should say what happens next

When something goes wrong in Andriel's routine, vague explanations don't work.

"We can't do that today" triggers panic.

"We can't go to the train station today because it's closed for repairs. We'll go on Saturday instead when it reopens" gives him enough structure to understand and adjust. It says what changed, why, and what the new plan is.

Error messages should do the same. The `int` annotation below documents the contract, but type hints aren't enforced at runtime, so the function still validates the type at the boundary (and rejects `bool`, which Python treats as a subclass of `int`).

```python
MAX_USER_ID = 1_000_000


# Vague: tells the caller something is wrong, not what or how to fix it.
#     raise Exception("Invalid input")


# Clear: what was wrong, what was received, what is valid
def validate_user_id(user_id: int) -> None:
    if not isinstance(user_id, int) or isinstance(user_id, bool):
        raise TypeError(f"User ID must be an int, got {type(user_id).__name__}.")
    if not 1 <= user_id <= MAX_USER_ID:
        raise ValueError(
            f"User ID must be an integer from 1 to {MAX_USER_ID}, got {user_id}."
        )


for value in (42, 3.5, -5):
    try:
        validate_user_id(value)
        print(f"{value!r}: ok")
    except (TypeError, ValueError) as exc:
        print(f"{value!r}: {type(exc).__name__}: {exc}")

# 42: ok
# 3.5: TypeError: User ID must be an int, got float.
# -5: ValueError: User ID must be an integer from 1 to 1000000, got -5.
```

For HTTP APIs, the same principle already has a standard. [RFC 9457, Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html) gives you a consistent JSON shape for errors with a type, title, status and detail. I'd use it rather than inventing yet another error envelope, because consistency across endpoints matters as much as the wording of any one message.

## Transitions need warnings

You can't just switch contexts on Andriel. "Five more minutes until we leave" gives him time to prepare mentally. Without the warning, the transition itself becomes the problem, regardless of where we're going.

APIs are no different. Removing an endpoint without notice is the "we're leaving now" of software. The tools for giving notice exist and are cheap:

- In Python libraries, emit a [`DeprecationWarning`](https://docs.python.org/3/library/warnings.html) with `warnings.warn(..., DeprecationWarning, stacklevel=2)` before you remove anything. Python hides `DeprecationWarning` by default unless the warning is triggered directly by code in `__main__`. Test runners such as pytest, or the `-W` flag, will show it. Library users often never see it, so call it out in release notes too. For warnings aimed at end users of an application, use `FutureWarning`, which is shown by default.
- In HTTP APIs, send the [`Deprecation` response header (RFC 9745, published March 2025)](https://www.rfc-editor.org/rfc/rfc9745.html) to say when a resource was or will be deprecated, and the [`Sunset` header (RFC 8594)](https://www.rfc-editor.org/rfc/rfc8594.html) to say when it will stop responding.
- Publish the migration path at the same time as the warning, not after.

One gotcha with the two headers: they don't use the same date format. `Deprecation` takes a Structured Fields date (an `@` followed by Unix seconds), while `Sunset` takes a classic HTTP-date. RFC 9745 also defines a `deprecation` link relation, which is where the migration path goes. Here are the relevant response headers:

```http
Deprecation: @1767225600
Sunset: Wed, 30 Jun 2027 23:59:59 GMT
Link: <https://example.com/docs/migrate-v2>; rel="deprecation"
```

That response says the endpoint was deprecated at midnight UTC on 1 January 2026, will stop responding after 30 June 2027, and points to the migration guide.

The warning alone isn't enough. "Five more minutes" works for Andriel because the next step is already known. A deprecation notice with no replacement is just a countdown to breakage.

## Say the plan out loud, even when it's obvious

I can't assume Andriel knows the plan, so I tell him. Every morning: "Today we're going to school, then after school we're coming home, then dinner, then bedtime."

It's the same every day, and the confirmation still matters. It reduces anxiety because it turns an assumption into a fact.

Teams need the same thing. The runbook step everyone "just knows", the reason a service is configured the way it is, the order in which things deploy: write them down. A "How this deploys" section in the README, or a short architecture decision record (ADR) explaining why a setting was chosen, is enough. The test is whether someone who joined last week could deploy on their own by following the page, without asking anyone what the "obvious" step is.

## Change needs more communication than you think

When we need to change Andriel's routine, the process looks like this:

1. Explain the change in advance.
2. Explain why it's changing.
3. Walk through the new routine.
4. Check he understands.
5. Support him during the transition.
6. Be patient while he adjusts.

That's a change management process. Most technology rollouts I see skip steps 1 to 4: they announce a go-live date and then wonder why adoption stalls. Steps 1 to 4 feel slow, but they're where trust is built. Skip them and you pay for it in support tickets and workarounds.

Here's how that maps onto retiring an API version, using the dates from the headers above. The intervals are my defaults for an internal or partner API; public APIs with slow-moving consumers deserve longer.

| When | What happens | Andriel's step |
|---|---|---|
| Day 0 (1 Jan 2026) | Changelog entry and email: what is being retired, why, and the sunset date. Migration guide published the same day. `Deprecation` and `Sunset` headers go live. | 1, 2, 3 |
| First month | Office hours or a short walkthrough of the migration guide; answer questions in one public thread. | 3, 4 |
| Every quarter | Check request logs for callers still on the old version and contact those owners directly. | 4, 5 |
| 3 months before sunset | Final reminder to remaining callers, with the date repeated. | 5 |
| 30 Jun 2027 | Sunset. The old version returns `410 Gone` with a Problem Details body pointing to the migration guide. | 6 |

The changelog entry itself can be three lines: "v1 `/users` is deprecated as of 1 January 2026 and will stop responding after 30 June 2027. Reason: v2 adds paging and consistent dates. Migrate with the guide at `/docs/migrate-v2`." What changed, why, and what to do next, the same shape as the train-station sentence.

Sometimes the full process is too much, such as a security fix that has to ship today. Then shorten it: skip the advance notice and the walkthrough if you must, but never skip explaining why (step 2) or supporting people through the change (step 5).

## Consistency is what builds trust

Andriel trusts his routines because they're consistent. Break that consistency often enough and the trust goes, and getting it back takes far longer than losing it.

Systems work the same way. If one endpoint paginates with `page` and another with `offset`, if one returns dates as ISO 8601 strings and another as epoch seconds, every consumer has to learn each endpoint separately. Pick a convention and hold to it. Write it in a shared API style guide, then enforce it with a linter such as [Spectral](https://github.com/stoplightio/spectral) that checks every OpenAPI definition, so the rule doesn't depend on reviewers remembering it. Spectral's built-in `spectral:oas` rules check general OpenAPI hygiene, not your house conventions, so the conventions need custom rules. Here's one that fails the build if any operation declares `offset` or `page_number` as a query parameter, whether on the operation itself or shared at the path level, assuming the house convention is `page` and `page_size`:

```yaml
# .spectral.yaml
extends: ["spectral:oas"]
rules:
  pagination-param-names:
    description: Paginate with page and page_size, never offset or page_number.
    message: "Query parameter '{{value}}' breaks the pagination convention; use page and page_size."
    severity: error
    given:
      - "$.paths[*].parameters[?(@.in == 'query')].name"
      - "$.paths[*][get,put,post,delete,options,head,patch,trace].parameters[?(@.in == 'query')].name"
    then:
      function: pattern
      functionOptions:
        notMatch: "^(offset|page_number)$"
```

Run against a definition with `?offset=` on `GET /users`, `spectral lint` reports `pagination-param-names` as an error on that parameter. A date-format rule works the same way: target the schema properties that hold timestamps and require `format: date-time`. Every inconsistency you don't catch becomes a special case in someone else's client code.

## When not to design for rigid predictability

I don't want to overstate this. Not every system should behave like a fixed morning routine. Exploratory tools, search, and anything built on a language model have useful variability by design, and forcing them into rigid determinism can make them worse.

The lesson I take is narrower: be predictable about the **contract**, even when the content varies. A search result can differ every time; the shape of the response, the error format and the deprecation policy shouldn't. Andriel's day isn't identical either. What stays fixed is the structure that tells him what to expect.

## What Andriel has taught me

A test I use on my own work is simple: would this make sense to Andriel? If the behaviour is clear enough for him, it's clear enough for any developer reading it at 2 am.

If you're a parent of an autistic child working in tech, you're probably already practising this: the advance warnings, the explicit plans, the patient walkthroughs of change. Those habits transfer directly. Andriel has made me a better engineer. Not in spite of his autism, but because of it. What looks like a limitation from the outside has turned out to be a feature: he needs the clarity that every user quietly benefits from. I wrote about the other side of the work-family balance in [The Tech Parent's Dilemma](/blog/2026-01-06-parenting-in-tech/).

Andriel taught me the principle underneath all of this: designing for the people with the greatest need for clarity produces systems that work better for everyone. He teaches me something new every day, and I'm grateful for it.
