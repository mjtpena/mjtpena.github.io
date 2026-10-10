---
title: "Completions Now, Chat Later: Keeping Azure OpenAI Code Portable"
description: "Azure OpenAI is GA with a Completions API only, and ChatGPT is coming soon. How to decide what needs chat and keep your prompt code ready for the change."
author: Michael John Peña
draft: false
date: 2023-01-17
tags:
  - Azure OpenAI
  - OpenAI
  - Architecture
  - Python
  - LLM
---

Azure OpenAI Service went generally available yesterday, and the same announcement said ChatGPT is coming to the service "soon", with no date. That leaves teams with a real design question this week: build on the Completions API that exists, or wait for a chat-style API that doesn't. My answer is to build now, but build so the decision about *how* you talk to the model sits in one small module rather than in every feature.

## What exists on 17 January 2023

Microsoft's [GA announcement](https://azure.microsoft.com/en-us/blog/general-availability-of-azure-openai-service-expands-access-to-large-advanced-ai-models-with-added-enterprise-benefits/) covers GPT-3.5 and Codex, with DALL-E 2 still invite-only, and access still gated by an application under the [Limited Access policy](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/limited-access). For text generation, the API surface is the completions endpoint (alongside embeddings and fine-tuning), on the GA `2022-12-01` API version. You send one string, `prompt`, to a deployment and get back the text the model predicts should follow.

The models you'll deploy are the GPT-3 family: `text-davinci-002` is the dependable instruction-following model, and `text-davinci-003` is being added in East US and West Europe this month, according to the [Azure OpenAI What's new page](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/whats-new), so check what your resource's region can actually deploy. Both davinci models have a context window of 4,097 tokens shared between prompt and completion.

What doesn't exist: a ChatGPT API on Azure or on OpenAI's own platform, a message list with roles, or a separate system instruction. The `openai` Python package is at 0.26.1 (released 13 January), and it exposes `openai.Completion`, `openai.Embedding` and friends. There is no chat class in it, because there is nothing to call.

So "completion vs chat" isn't an API choice today. It's a product choice about interaction shape, and an engineering choice about how much of your code knows that the transport is a single prompt string.

## Most workloads don't need chat

The demand I hear is "a ChatGPT for our data". When you list what people actually want, most items are single-shot tasks: summarise this incident, classify this ticket, extract fields from this email, draft a reply for a human to edit. None of those benefits from a conversation, and several get worse with one.

| Question | Single-shot completion | Conversational (multi-turn) |
|---|---|---|
| Who supplies context? | Your code, every call | Your code plus whatever the user said earlier |
| Token cost per request | Roughly fixed | Grows with every turn, because history is resent |
| Testability | Fixed input, comparable output | Depends on the path the user took |
| Prompt injection exposure | Whatever untrusted text you pass in (emails, documents) | Every turn is a new chance to override instructions |
| Fits | Extraction, classification, summarisation, drafting | Clarifying questions, exploratory Q&A, tutoring |

Single-shot narrows the attack surface, but it doesn't remove it. An email you ask the model to summarise can carry its own instructions, so treat the output as untrusted too: validate extracted fields against a schema or allow-list before anything downstream acts on them.

My rule of thumb: if the user's second message would usually be "no, try again", you don't need chat, you need a better single prompt and a regenerate button. Reach for multi-turn only when the user genuinely refines a request over several steps and the earlier steps change the answer.

Conversation on the Completions API is also more expensive than it looks. With a 4,097-token window, a preamble of a few hundred tokens and a 500-token answer budget, you have room for a handful of exchanges before you must summarise or drop history. I walked through transcript formats, truncation and streaming in [ChatGPT-Style Chat on Azure OpenAI Without a Chat API](/blog/2023-01-05-chatgpt-integration-patterns/), and the instruction block that stands in for a system prompt in [No System Prompt Yet](/blog/2023-01-15-system-prompts-azure-openai/). This post is about the seam between your features and that machinery.

## Separate the conversation from the prompt string

The mistake I see most often is prompt strings built inline in feature code: an f-string with `"Human:"` and `"AI:"` labels in a Flask route, another variant in a Teams bot, a third in a batch job. Each has its own idea of turn labels, stop sequences and truncation. When the service adds a chat-shaped API, every one of them has to be found and rewritten.

The fix is boring. Feature code works with structured data: instructions, and a list of turns with a speaker and text. One renderer turns that structure into whatever the current API wants. Today that's a completions prompt with stop sequences; if a chat API ships with a different request shape, you write a second renderer and switch deployments, and the features don't change.

I'm deliberately not guessing what a future chat API will look like. Nobody outside Microsoft and OpenAI knows yet, and designing for an imagined request format is how you end up with an abstraction that fits nothing. Keeping the conversation as data is useful regardless, because it's also what you need for logging, truncation and evaluation.

### A renderer for the Completions API

This is complete and runs against `openai==0.26.1` with the `2022-12-01` API version. It keeps the conversation as dataclasses, renders it to a prompt in one place, trims old turns to fit a budget, and uses stop sequences so the model doesn't write the user's next line.

```python
import os
from dataclasses import dataclass, field
from typing import List, Literal

import openai

openai.api_type = "azure"
openai.api_base = "https://<your-resource-name>.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

DEPLOYMENT = "<your-davinci-deployment>"
USER_LABEL = "User"
ASSISTANT_LABEL = "Assistant"


@dataclass
class Turn:
    speaker: Literal["user", "assistant"]
    text: str


@dataclass
class Conversation:
    instructions: str
    turns: List[Turn] = field(default_factory=list)

    def add(self, speaker: str, text: str) -> None:
        if speaker not in ("user", "assistant"):
            raise ValueError(f"speaker must be 'user' or 'assistant', not {speaker!r}")
        self.turns.append(Turn(speaker, text.strip()))


def render_completion_prompt(convo: Conversation, max_chars: int = 6000) -> str:
    """Render structured turns into a single completions prompt.

    Character budget is a rough proxy for tokens (about 4 characters per
    token for English). Oldest turns are dropped first; instructions and
    the newest turn always stay, and an oversized prompt raises ValueError.
    """
    lines = []
    for turn in convo.turns:
        label = USER_LABEL if turn.speaker == "user" else ASSISTANT_LABEL
        lines.append(f"{label}: {turn.text}")

    header = convo.instructions.strip() + "\n\n"
    footer = f"\n{ASSISTANT_LABEL}:"
    def size() -> int:
        return len(header) + len("\n".join(lines)) + len(footer)

    while len(lines) > 1 and size() > max_chars:
        lines.pop(0)
    if size() > max_chars:
        raise ValueError("Instructions plus the latest turn exceed the prompt budget")
    return header + "\n".join(lines) + footer


def reply(convo: Conversation, max_tokens: int = 400) -> str:
    response = openai.Completion.create(
        engine=DEPLOYMENT,
        prompt=render_completion_prompt(convo),
        max_tokens=max_tokens,
        temperature=0.3,
        stop=[f"\n{USER_LABEL}:", f"\n{ASSISTANT_LABEL}:"],
    )
    text = response["choices"][0]["text"].strip()
    convo.add("assistant", text)
    return text


if __name__ == "__main__":
    convo = Conversation(
        instructions=(
            "You are an internal IT helpdesk assistant. Answer briefly. "
            "If you are not sure, say so and suggest raising a ticket."
        )
    )
    convo.add("user", "My laptop can't reach the VPN since this morning.")
    print(reply(convo))
    convo.add("user", "I already restarted it. What next?")
    print(reply(convo))
```

Notice what the feature code at the bottom touches: `Conversation`, `add` and `reply`. It never sees a label, a stop sequence or a truncation rule. That's the whole point.

### Single-shot tasks use the same seam

A classification or extraction call is just a conversation with one user turn and no history. Routing it through the same renderer means one place to change, but it's fine for single-shot tasks to have their own small function too, as long as it lives in the same module and not in a controller. What matters is that prompt construction has one owner.

## Where this abstraction is the wrong call

Don't build a provider-agnostic "LLM client" with interfaces, factories and plug-in model registries. With one API and one model family available, that's speculative architecture, and it tends to leak the Completions API's assumptions anyway (a `prompt: str` parameter on the base class is the usual giveaway). A plain module with a data structure and one render function is enough.

Don't force structure where there is no conversation. A batch job that summarises 50,000 documents doesn't need turns; it needs a tested prompt template, a token check and retry handling.

And don't hold a project waiting for ChatGPT on Azure. "Soon" has no date attached, and the instruction-following davinci models already handle the single-shot work that makes up most enterprise backlogs.

## The decision

Build on the Completions API now. Decide per feature whether it's really conversational, and default to single-shot when in doubt, because it's cheaper, easier to test and harder to hijack. For the features that are conversational, keep turns as data and render the prompt in one place. When a chat-style API does arrive on Azure OpenAI, you'll evaluate it against your own logged conversations and swap a renderer, instead of hunting for f-strings across three codebases.
