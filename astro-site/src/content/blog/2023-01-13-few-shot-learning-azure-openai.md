---
title: "Few-Shot Prompts on Azure OpenAI: Choosing and Ordering Examples"
description: "How to pick, order and budget few-shot examples for Azure OpenAI completion models, with the biases to watch for and when to stop adding examples."
author: Michael John Peña
draft: false
date: 2023-01-13
tags:
  - Azure OpenAI
  - Prompt Engineering
  - OpenAI
  - GPT-3
  - Python
---

Few-shot prompting is the cheapest way to make a completion model do a narrow task well: show it a handful of solved examples and let it continue the pattern. It's also the part of prompt design most prone to cargo-culting. Teams paste in three examples that happened to be lying around, get a good result on the input they tested, and never ask whether those examples are helping, hurting, or just burning tokens. The examples are the most influential part of a few-shot prompt, so they deserve the same scrutiny as the code around them.

This builds on yesterday's post, [Prompts Are Production Code](/blog/2023-01-12-prompt-engineering-fundamentals/), which covered instructions, output formats and delimiters. Here the focus is narrower: which examples to include, in what order, how many you can afford, and when few-shot is the wrong tool.

## What you're working with today

As of this week, Azure OpenAI Service is still a limited-access preview. The models you'll use for this are the completion models listed on the [Azure OpenAI models page](https://learn.microsoft.com/azure/ai-services/openai/concepts/models): use `text-davinci-003` where your region offers it and `text-davinci-002` otherwise, and the cheaper GPT-3 models such as `text-curie-001` for simple classification. Both Davinci models use the `p50k_base` encoding and a 4,097-token limit, so the code below works with either. There is no chat API, so a few-shot prompt is one block of text sent to the completions endpoint, and the model predicts what follows.

The term itself comes from the GPT-3 paper, ["Language Models are Few-Shot Learners" (Brown et al., 2020)](https://arxiv.org/abs/2005.14165). Its key point is easy to forget: the model doesn't learn anything from your examples in the training sense. No weights change. The examples condition a single prediction, and they're gone on the next call. That's why "in-context learning" is the more accurate name, and why everything below is about what you put in the context.

The vocabulary is simple:

| Style | What's in the prompt | When I reach for it |
|---|---|---|
| Zero-shot | Instructions only | The task is common and the format is easy to describe |
| One-shot | Instructions plus one example | You mainly need to show the output format |
| Few-shot | Instructions plus several examples | Labels or style are hard to describe in words but easy to show |

My rule of thumb: start zero-shot with a strict output format. Add examples only when you can point to a specific failure they fix.

## What the model actually takes from examples

The useful research here is recent and a little humbling. [Min et al. (2022)](https://arxiv.org/abs/2202.12837) found that replacing the correct labels in demonstrations with random ones barely hurt performance on many classification tasks. What mattered was that the examples showed the label space, the format, and the kind of input the model should expect.

That changes how you should write examples. Their main job is to show *shape*: what an input looks like, what the allowed outputs are, and exactly how an answer is laid out. A perfectly labelled example that looks nothing like real traffic teaches less than a plain one drawn from your actual data. It doesn't mean labels are irrelevant. Later work, [Yoo et al. (2022), "Ground-Truth Labels Matter"](https://arxiv.org/abs/2205.12685), found that the effect of correct labels varies a lot by task and setting, and you don't want to find out which kind yours is in production.

## The biases you're introducing

[Zhao et al. (2021), "Calibrate Before Use"](https://arxiv.org/abs/2102.09690) measured three biases in GPT-3 few-shot prompts, all worth checking in every few-shot prompt you write:

- **Majority label bias.** If three of your four examples are `negative`, the model leans towards `negative`. Keep the label counts balanced, or deliberately match the distribution you expect in production.
- **Recency bias.** The label of the last example has an outsized pull on the answer. If your last example is always the same class, you've built in a thumb on the scale.
- **Common token bias.** Labels that are frequent words in general text get predicted more often. My reading of this is that short, distinctive labels (`billing`, `outage`) are safer than vague, common ones (`other`, `general`), though you still need an escape hatch.

Order matters more than people expect too. [Lu et al. (2021), "Fantastically Ordered Prompts and Where to Find Them"](https://arxiv.org/abs/2104.08786), showed that the same set of examples in a different order can swing accuracy from near state of the art to near random on some tasks. You can't fix that by intuition. You fix it by testing orderings against a labelled set and keeping the one that's stable, or by rotating the order so no single permutation dominates.

## Choosing examples per request

A fixed example set is fine when inputs are homogeneous. When they vary a lot (support tickets about billing, access, outages and feature requests), the closest examples help more than a generic set. [Liu et al. (2021)](https://arxiv.org/abs/2101.06804) showed that retrieving the examples most similar to the query improved GPT-3 results over random selection.

The cleanest version uses embeddings to find nearest neighbours, which I'll cover when I get to [embeddings](/blog/2023-01-23-embeddings-introduction/). You don't need them to start, though. A simple word-overlap score, plus a rule that every label appears at least once, is a reasonable first step with no extra model calls; check it against your test set before assuming it matches embedding retrieval. That's what the code below does.

## A complete example

This classifies support tickets with `text-davinci-002` on Azure OpenAI using `openai` 0.26.0 and `tiktoken` 0.1.2. It picks the most similar example for each label, puts the most similar example first and the least similar last, so the recency-biased final slot doesn't always go to the likeliest label, checks the token budget before sending, retries briefly when throttled, and validates the answer.

```python
import logging
import os
import time

import openai
import tiktoken

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DEPLOYMENT = "<your-text-davinci-002-deployment>"
CONTEXT_LIMIT = 4097
MAX_ANSWER_TOKENS = 5
LABELS = ["billing", "outage", "access", "feature"]

INSTRUCTIONS = (
    "Classify each support ticket into exactly one category: "
    + ", ".join(LABELS)
    + ". Answer with the category only.\n\n"
)

EXAMPLE_BANK = [
    ("I was charged twice for the January invoice.", "billing"),
    ("Can we pay annually instead of monthly?", "billing"),
    ("The portal returns a 503 error for everyone in our team.", "outage"),
    ("Reports have not refreshed since 6am and the status page is green.", "outage"),
    ("My account is locked after the password reset.", "access"),
    ("New starters cannot see the finance workspace.", "access"),
    ("Please add an export to Excel button on the dashboard.", "feature"),
    ("It would help to schedule reports for Monday mornings.", "feature"),
]

encoding = tiktoken.get_encoding("p50k_base")
logger = logging.getLogger(__name__)


def overlap(a: str, b: str) -> float:
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    union = words_a | words_b
    return len(words_a & words_b) / len(union) if union else 0.0


def select_examples(ticket: str) -> list:
    """Pick the closest example for each label, so every label is shown once."""
    # Score each bank example once. max() and sort() are stable, so ties
    # (including the common 0.0 score) keep EXAMPLE_BANK order.
    scored = [(overlap(ticket, text), text, label) for text, label in EXAMPLE_BANK]
    best = [
        max((item for item in scored if item[2] == label), key=lambda item: item[0])
        for label in LABELS
    ]
    # Most similar first: the last slot carries recency bias, so give it
    # to the least similar example rather than the likeliest label.
    best.sort(key=lambda item: item[0], reverse=True)
    return [(text, label) for _, text, label in best]


def build_prompt(ticket: str, examples: list) -> str:
    shots = "".join(f"Ticket: {text}\nCategory: {label}\n\n" for text, label in examples)
    return f"{INSTRUCTIONS}{shots}Ticket: {ticket}\nCategory:"


def classify(ticket: str) -> str:
    prompt = build_prompt(ticket, select_examples(ticket))
    prompt_tokens = len(encoding.encode(prompt))
    if prompt_tokens + MAX_ANSWER_TOKENS > CONTEXT_LIMIT:
        raise ValueError(f"Prompt is {prompt_tokens} tokens; shorten the ticket or examples")

    for attempt in range(3):
        try:
            response = openai.Completion.create(
                engine=DEPLOYMENT,
                prompt=prompt,
                max_tokens=MAX_ANSWER_TOKENS,
                temperature=0,
                stop=["\n"],
            )
            break
        except (openai.error.RateLimitError, openai.error.ServiceUnavailableError):
            # Preview quotas are tight; back off briefly, then give up.
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    raw = response["choices"][0]["text"]
    answer = raw.strip().lower()
    if answer not in LABELS:
        # Log format failures (including an empty answer when the model
        # starts with a newline) so they show up in testing.
        logger.warning("Unexpected completion: %r", raw)
        return "unclassified"
    return answer


if __name__ == "__main__":
    print(classify("Our finance team gets access denied on the cost report."))
```

A few choices in there are deliberate. `temperature=0` because a classifier should return its most likely answer, not a creative one. The `stop` sequence ends the completion at the newline, so the model can't wander off and invent a fifth ticket. The answer is checked against the label list, and anything else becomes `unclassified` rather than flowing downstream. The ordering heuristic is a starting point, not a law. The catch: if recency bias is strong for your task, the last slot now nudges towards the least likely label. Compare it against a random or rotated order on your test set before keeping it. The retry loop is deliberately small: three attempts with a short backoff on throttling (`RateLimitError`) or a busy service (`ServiceUnavailableError`), then the error goes to the caller.

## How many examples you can afford

Every example is paid for on every call. A short classification example is 20 to 30 tokens; a document-summarisation example can be several hundred. At Azure OpenAI's Davinci list price of $0.02 per 1,000 tokens (January 2023), an extra 400 tokens of examples on a million calls a month is $8,000 that buys you nothing if zero-shot was already accurate. I went through counting and capping tokens in [the token management post](/blog/2023-01-11-token-management-azure-openai/), and the same budget applies here: examples share the 4,097-token Davinci window ([quotas and limits](https://learn.microsoft.com/azure/ai-services/openai/quotas-limits)) with the input and the answer.

The trade-offs look like this:

| Lever | Helps with | Costs |
|---|---|---|
| More examples | Rare labels, tricky formats | Tokens on every call, less room for input |
| Longer examples | Generation tasks where style matters | Tokens, and the model copies length as well as style |
| Per-request selection | Varied inputs | Code to maintain, harder to reproduce a given prompt |
| Smaller model plus examples | Cost on simple, high-volume tasks | Lower ceiling on hard inputs |

For classification I usually land on one or two examples per label. For extraction into a fixed structure, two or three well-chosen examples. Past five or six, I'd want test-set evidence that each extra example earns its tokens, because the bill keeps climbing either way.

## Test the examples, not just the prompt

Because examples move accuracy so much, treat the example set as something you evaluate. Keep a labelled test set of real inputs (50 to 100 is enough to see big swings), and run it whenever you change an example, the order, or the model deployment. This is the fragment I'd bolt on to the script above:

```python
TEST_SET = [
    ("Invoice shows the wrong ABN.", "billing"),
    ("Dashboard has been timing out for an hour.", "outage"),
    ("I can't sign in since my email changed.", "access"),
]

correct = sum(classify(text) == label for text, label in TEST_SET)
print(f"{correct}/{len(TEST_SET)} correct")
```

Watch the confusion between specific labels, not just the overall score. If `access` tickets keep landing in `outage`, add a contrasting example that sits right on that boundary. One well-placed boundary example usually does more than three easy ones.

## When few-shot is the wrong tool

Few-shot prompting has limits, and I'd rather name them than stretch it:

- **The task needs knowledge the model doesn't have.** Examples teach format, not facts about your products or policies. Put the relevant facts in the prompt, or retrieve them.
- **You need hundreds of examples to cover the cases.** That's a sign the task belongs in [fine-tuning](https://learn.microsoft.com/azure/ai-services/openai/how-to/fine-tuning), which Azure OpenAI's preview supports for the base GPT-3 models. A fine-tuned model also removes the per-call example cost.
- **The examples contain real customer data.** Every example goes to the service on every call. Write synthetic examples that keep the shape of real data without the personal details.

## What I'd do on Monday

Start zero-shot with a strict format and a labelled test set. Add one example per label when the test set shows the model confusing labels, balance the classes, and put the most likely label somewhere other than last. Measure every change. If you find yourself past half a dozen examples and still chasing accuracy, stop tuning the prompt and look at fine-tuning or retrieval instead. The [OpenAI best-practice guide](https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering-with-the-openai-api) puts the same ladder simply: zero-shot first, then few-shot, then fine-tune.
