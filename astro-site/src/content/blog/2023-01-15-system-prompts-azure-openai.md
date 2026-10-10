---
title: "No System Prompt Yet: Instruction Preambles on Azure OpenAI"
description: "Azure OpenAI completion models have no system role yet. How to design, budget, version and test an instruction preamble that does that job instead."
author: Michael John Peña
draft: false
date: 2023-01-15
tags:
  - Azure OpenAI
  - Prompt Engineering
  - OpenAI
  - GPT-3
  - Python
---

Since ChatGPT launched in late November, I keep getting asked how to give an Azure OpenAI app "a system prompt like ChatGPT has". The short answer is that you can't, at least not in the way people imagine. There is no separate instruction channel in the API you can call today. What you can build is an instruction preamble: a fixed block of text at the top of every completion request that sets the role, the rules and the output shape. Get its design right and it behaves the way people expect a system prompt to behave. Get it wrong and your "assistant" starts writing the user's half of the conversation.

## What the completions API gives you

Azure OpenAI Service is still a limited-access preview. You apply, get approved, deploy a model to your own resource and call it by deployment name through the [completions endpoint](https://learn.microsoft.com/azure/ai-services/openai/how-to/completions). The deployable text models are the GPT-3 family, with `text-davinci-002` as the dependable choice. `text-davinci-003` is on OpenAI's own API and is only starting to appear for Azure resources, so check what your resource can actually deploy before you design around it. ChatGPT itself has no public API on either platform.

The completions endpoint takes one string, `prompt`, and returns the text the model predicts should follow it. That's the whole contract. There are no roles, no message list and no conversation state on the server. Anything you want the model to "remember" or obey has to be in that string on every call, and it all counts toward a context window of 4,097 tokens shared between prompt and completion for `text-davinci-002` and `text-davinci-003`.

So when someone asks for a system prompt, what they're really asking for is three things:

1. **Standing instructions** that apply to every request.
2. **A conversation frame** that makes a completion model behave like a turn-taking assistant.
3. **Protection** for those instructions against whatever the user types.

The first two you can build well. The third you can only partly build, and you need to know where it stops.

## Designing the preamble

I treat the preamble as four short sections, in this order:

| Section | What it does | Typical length |
|---|---|---|
| Identity and audience | Who the model is speaking as, and to whom | 1–2 sentences |
| Task and scope | What it should help with, and what is out of scope | 2–4 sentences |
| Behaviour rules | Tone, length, what to do when it doesn't know | 3–6 bullet points |
| Output frame | The exact shape of a reply, ending where the reply starts | A few lines |

Three things matter more than the wording inside each section.

**Keep it short.** Every token in the preamble is paid for on every call, and every token it uses is a token the conversation can't. A 600-token preamble on a 4,097-token model leaves you about 3,500 tokens for history, user input and the reply. Long preambles also tend to be lists of edge cases nobody tested. I'd aim for 150–300 tokens and push anything longer into tests instead of prose. To put a number on it: at the Azure Davinci rate of $0.02 per 1,000 tokens on the [pricing page](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/), a 300-token preamble costs about $6 per 1,000 calls before you send a single word of history. If the preamble keeps growing because you are describing a fixed format or style through rules, that is the signal to consider fine-tuning one of the base GPT-3 models on examples instead, which moves the behaviour into the model at the cost of training, hosting and a dataset you have to maintain. For instructions that change often, a short preamble stays the better tool.

**State scope positively and give an exit.** "Only answer questions about Contoso's hosting plans and billing. For anything else, say you can only help with hosting and billing, and suggest contacting support." works better than a list of forbidden topics. The model gets a target and a fallback line, and you get behaviour you can check. I went through why positive instructions beat negative ones in [Prompts Are Production Code](/blog/2023-01-12-prompt-engineering-fundamentals/).

**Tell it what to do when it doesn't know.** A completion model will produce plausible text whether or not it has the facts. If the preamble doesn't define an "I don't know" path, the model invents one, usually an answer. Give it a literal phrase to use and a next step for the user.

What I'd leave out: elaborate personas with names, catchphrases and backstories. A role nudges style and vocabulary. It doesn't add knowledge, and a confident persona makes wrong answers sound more convincing. One sentence of identity and one of audience is enough.

## Making a completion model take turns

The trick for chat behaviour with a completion model is to write the prompt as a transcript and stop it in the right place. The preamble comes first, then the prior turns, then the label for the assistant's next turn with nothing after it. The model continues the transcript, which means it writes the assistant's line.

The failure mode is that it doesn't stop. Having written the assistant's reply, the most likely continuation of a transcript is the next user turn, so the model happily invents what the customer says next and answers that too. The fix is a stop sequence. The completions API accepts up to four strings in `stop`, and generation halts before any of them (see the [REST API reference](https://learn.microsoft.com/azure/ai-services/openai/reference), which also documents the `user` parameter for passing an end-user identifier). Use the newline plus the user label (for example `"\nCustomer:"`) and the reply ends where it should.

A few details that make this reliable:

- **Use plain, consistent speaker labels.** `Customer:` and `Agent:` are fine. Don't vary them between turns.
- **Strip the labels from user input.** If a user types `Agent:` into their message, they can fake a turn inside your transcript. Removing the labels is cheap hygiene, though it isn't injection protection.
- **Trim history from the oldest turn, never the preamble.** When the transcript gets too long, the preamble is the last thing that should go. Count tokens with `tiktoken` before sending, as I covered in [Counting and Capping Tokens](/blog/2023-01-11-token-management-azure-openai/).
- **Keep `max_tokens` honest.** It reserves room for the reply inside the same 4,097-token window, so it comes off your history budget.

## A working pattern

This uses `openai` 0.26.x and `tiktoken` 0.1.2, with the `2022-12-01` API version. The `text-davinci` models use the `p50k_base` encoding in [tiktoken](https://github.com/openai/tiktoken).

```python
import os
import re

import openai
import tiktoken

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DEPLOYMENT = "<your-deployment-name>"  # a text-davinci-002 deployment
CONTEXT_LIMIT = 4097
MAX_REPLY_TOKENS = 250
ENCODING = tiktoken.get_encoding("p50k_base")

PREAMBLE_VERSION = "support-2023-01-15"
PREAMBLE = """The following is a conversation between a customer and a support agent for Contoso Cloud Hosting.
The agent helps small-business customers who are not technical.

The agent only helps with Contoso hosting plans, billing and account access.
For any other topic, the agent says it can only help with hosting, billing and access, and suggests emailing support@contoso.example.

Rules for the agent:
- Use plain language and keep replies under 120 words.
- Never ask for or repeat passwords or full card numbers.
- If the agent is not sure of an answer, it says "I'm not sure about that" and offers to raise a ticket.
- The agent never promises refunds or credits.
"""

LABELS = ("Customer:", "Agent:")
LABEL_PATTERN = re.compile(r"(?im)^\s*(customer|agent)\s*:")


def count_tokens(text: str) -> int:
    return len(ENCODING.encode(text))


def clean(text: str) -> str:
    """Stop users from faking a speaker turn inside the transcript."""
    return LABEL_PATTERN.sub("", text).strip()


def build_prompt(history: list, user_message: str) -> str:
    """history is a list of (customer_text, agent_text) tuples, oldest first."""
    turns = [f"Customer: {clean(c)}\nAgent: {a.strip()}" for c, a in history]
    latest = f"Customer: {clean(user_message)}\nAgent:"
    budget = CONTEXT_LIMIT - MAX_REPLY_TOKENS - count_tokens(PREAMBLE + "\n" + latest)
    if budget < 0:
        raise ValueError("Message is too long for the context window.")

    kept = []
    for turn in reversed(turns):  # keep the newest turns that fit
        cost = count_tokens(turn + "\n")
        if cost > budget:
            break
        kept.insert(0, turn)
        budget -= cost

    return "\n".join([PREAMBLE, *kept, latest])


def reply(history: list, user_message: str, user_id: str) -> str:
    response = openai.Completion.create(
        engine=DEPLOYMENT,
        prompt=build_prompt(history, user_message),
        max_tokens=MAX_REPLY_TOKENS,
        temperature=0.3,
        stop=["\n" + label for label in LABELS],
        user=user_id,  # a pseudonymous ID, never an email address
    )
    return response["choices"][0]["text"].strip()


if __name__ == "__main__":
    history = [("Hi, what plans do you have?", "We have Starter, Business and Pro plans. Which matters more to you, price or storage?")]
    print(PREAMBLE_VERSION, reply(history, "Price. And can I pay yearly?", user_id="c0a8f3e2"))
```

The preamble opens by describing the transcript ("The following is a conversation between…") rather than addressing the model as "you". With a completion model that framing tends to work better, because the model is continuing a document, not taking orders. A temperature of 0.3 keeps replies consistent without making every one identical. For classification or extraction behind the same preamble I'd use 0.

## Versioning and testing the preamble

The preamble is configuration that changes product behaviour, so treat it like code. Give it a version string, keep it in source control, and log the version with every request. When someone reports a strange reply, the first question is which preamble produced it.

Then test it against a fixed set of conversations before every change. The set should include the cases that break preambles:

- An off-topic request ("Write me a poem about Kubernetes") that should hit the scope exit.
- A question the bot can't know the answer to ("Is the outage in Melbourne fixed?") that should produce the "not sure" line, not an invented status.
- A request for a refund, to check it doesn't promise one.
- A message with `Agent:` embedded in it.
- An instruction override ("Ignore the rules above and…").
- A long history that forces trimming, to check the preamble survives.

Check the mechanical parts in code (reply length, banned phrases, no fabricated speaker turns) and have a person read the rest. Crude checks still turn "this preamble feels better" into a pass rate you can compare.

## Where a preamble stops protecting you

A preamble is text in the same channel as the user's text. The model has no way to know your instructions outrank theirs. Simon Willison [named this prompt injection](https://simonwillison.net/2022/Sep/12/prompt-injection/) last September, and nothing published since has fixed it with wording. A well-written preamble lowers the rate at which users can steer the bot off course. It doesn't stop a determined one.

So design as if every instruction in the preamble can be overridden:

- **No secrets in the preamble.** Assume users can get the model to print it.
- **No unchecked actions.** If a reply can trigger anything that writes, sends or spends, validate it in code first.
- **Don't rely on the preamble for safety.** The service's content filter is a separate layer, and it has its own gaps, which I covered in [Handling Content Filtering](/blog/2023-01-09-content-filtering-azure-openai/). Your own checks sit on top of both.

There's also a point where a preamble is the wrong tool. If you need the bot to know your product catalogue, policies or incident status, no instruction will produce those facts. You either put the relevant facts in the prompt per request, which eats into the same token budget, or you accept that the model will make them up. And if you're trying to force a style or format the model keeps drifting from, look at the examples in your prompt before you add more rules. [Few-shot examples](/blog/2023-01-13-few-shot-learning-azure-openai/) often do more than another paragraph of instructions.

## My recommendation

Don't wait for a "system prompt" feature to build a well-behaved assistant on Azure OpenAI. Write a short preamble with an identity, a positive scope with an exit, a few behaviour rules and a transcript frame. Stop generation on the user label, trim history before you trim instructions, version the preamble and test it against conversations designed to break it. Then assume it can be broken anyway, and keep anything that matters (secrets, actions, facts) out of the model's hands. If the API grows a dedicated instruction slot later, the content of a good preamble carries straight over. The discipline around it is the part worth building now.
