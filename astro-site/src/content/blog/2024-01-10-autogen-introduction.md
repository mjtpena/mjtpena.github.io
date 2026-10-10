---
title: "AutoGen 0.2 on Azure OpenAI: Termination, Code Execution and Tools"
description: "A practical look at AutoGen 0.2 with Azure OpenAI: wiring the config, stopping runaway conversations, sandboxing generated code and registering tools."
author: Michael John Peña
draft: false
date: 2024-01-10
tags:
  - AutoGen
  - AI Agents
  - Multi-Agent
  - Azure OpenAI
  - Python
---

AutoGen makes a multi-agent demo look effortless: two agents, one `initiate_chat` call, and code appears, runs and gets fixed. The hard part is everything the demo hides: when the conversation stops, where the generated code runs, and what the agents are allowed to touch. If you take an AutoGen prototype anywhere near real data, those three decisions matter more than how many agents you have.

Everything here applies to the `pyautogen` 0.2.x line (0.2.5 on [PyPI](https://pypi.org/project/pyautogen/0.2.5/) as of early January 2024) running against Azure OpenAI.

## What AutoGen actually is

AutoGen came out of Microsoft Research and the FLAML project. The team describe it in their [September 2023 announcement](https://www.microsoft.com/en-us/research/blog/autogen-enabling-next-generation-large-language-model-applications/) as a framework of "conversable" agents. Each agent is backed by an LLM, a human, tools, or a mix, and they solve tasks by sending messages to each other. It is open source, it is still moving fast, and the 0.2 releases are where most of the breaking changes have landed.

The core class is `ConversableAgent`. Two subclasses cover most use cases:

| Agent | Default behaviour | Typical role |
|---|---|---|
| `AssistantAgent` | Has an LLM, does not execute code, system message tells it to write code and reply `TERMINATE` when done | The "thinker" that plans and writes code |
| `UserProxyAgent` | No LLM by default (`llm_config=False`), executes code blocks it receives, asks a human for input on every turn by default (`human_input_mode="ALWAYS"`) | The "doer" that runs code and tools, and the place a human can step in |

Everything else, including group chat, is built from these message-passing loops. That is the mental model to hold on to: **AutoGen is a loop of auto-replies between agents, and your job is to bound that loop.**

## Version 0.2 changed the config

Version 0.2.0 (November 2023) moved AutoGen onto the `openai` Python library v1, and 0.2.5 requires `openai>=1.3`. If you are following a blog post from October 2023, the config keys will be wrong. Per the [0.2 migration guide](https://microsoft.github.io/autogen/0.2/docs/Migration-Guide), `api_base` became `base_url`, `request_timeout` became `timeout`, and `seed` became `cache_seed`.

For Azure OpenAI there is one more trap. AutoGen builds the URL as `{base_url}/openai/deployments/{model}`, so `model` must be your **deployment name**, not the model family. If you name deployments after the model (for example `gpt-4-1106` for the GPT-4 Turbo preview), this is invisible. If you don't, you get a 404 that looks like an auth problem.

```python
import os

config_list = [
    {
        "model": "<your-gpt4-deployment-name>",
        "api_type": "azure",
        "base_url": "https://<your-resource-name>.openai.azure.com/",
        "api_version": "2023-12-01-preview",
        "api_key": os.environ["AZURE_OPENAI_API_KEY"],
    }
]

llm_config = {
    "config_list": config_list,
    "temperature": 0,
    "timeout": 120,
    "cache_seed": None,  # disable the on-disk response cache
}
```

Two settings in that block are deliberate:

- **`api_version: 2023-12-01-preview`.** AutoGen 0.2 registers functions as OpenAI *tools* (`tool_calls`), not the older `functions` parameter. Azure OpenAI only accepts the `tools` shape from the `2023-12-01-preview` API version, so older versions break function calling. Microsoft has also notified customers that the `2023-03-15-preview` to `2023-09-15-preview` versions retire on 2 April 2024 (see the [API version lifecycle](https://learn.microsoft.com/en-us/azure/ai-services/openai/api-version-deprecation)), so pin a version deliberately and plan to move it.
- **`api_key` from the environment.** AutoGen's examples load an `OAI_CONFIG_LIST` JSON file, which nudges people into keeping keys in a file on disk that ends up in a repo or a container image. Read the key from an environment variable, and in Azure populate that variable from Key Vault rather than committing a config file.
- **`cache_seed: None`.** By default AutoGen caches completions on disk under `.cache/41`. For reproducible experiments that is useful. When you are iterating on prompts, it is confusing: an identical request returns the old answer and you think your change did nothing. I turn it off while developing and turn it back on for evaluation runs.

## Bounding the conversation

Three settings decide when a two-agent chat stops, and you want all three set explicitly.

```python
from autogen import AssistantAgent, UserProxyAgent


def is_done(message: dict) -> bool:
    # content is None on tool-call messages, so guard before calling string methods
    content = message.get("content") or ""
    return content.rstrip().endswith("TERMINATE")


assistant = AssistantAgent(
    name="assistant",
    llm_config=llm_config,
)

user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=8,
    is_termination_msg=is_done,
    code_execution_config={
        "work_dir": "workspace",
        "use_docker": True,
        "timeout": 120,
    },
)

user_proxy.initiate_chat(
    assistant,
    message="Download the CSV at <your-public-csv-url>, print the column names and row count.",
)

# The last message is usually just "TERMINATE"; the answer is the one before it
history = user_proxy.chat_messages[assistant]
print(history[-2]["content"] if len(history) > 1 else history[-1]["content"])
```

- **`is_termination_msg`** checks each incoming message. The default `AssistantAgent` system message asks the model to end with `TERMINATE`, so a suffix check works. Guard against `None` content: tool-call messages have no text, and the common `x.get("content", "").rstrip()` one-liner throws when the key is present but `None`.
- **`max_consecutive_auto_reply`** is your hard stop. Without it, a model that never says `TERMINATE` keeps going, and each turn re-sends the growing history, so cost grows faster than the turn count. GPT-4 Turbo on Azure OpenAI bills per input and output token, so a rough worst case per run is `max_consecutive_auto_reply` × the full history size × the token price. Work that number out before you set the limit, not after the first invoice.
- **`human_input_mode`** is `"ALWAYS"` by default on `UserProxyAgent`, which is why a first run often sits waiting at a prompt. `"TERMINATE"` asks a human only when the conversation would end. `"NEVER"` is fully automatic and should only be paired with a sandbox.

My rule of thumb: start with `"TERMINATE"` while you learn how the agents behave on your task, then move to `"NEVER"` with a low reply limit once you trust the loop.

## Where generated code runs

This is the decision I would not leave to defaults. In 0.2.5, `use_docker` defaults to `None`, which means: use Docker if the `docker` Python package is installed, otherwise **run the code natively on your machine** and print a warning. Plenty of people never notice the warning. The generated code then runs with your user's file system, network and credentials.

Setting `"use_docker": True` makes the intent explicit and fails loudly if Docker isn't available. You can also pass an image name (for example `"python:3.11-slim"`) to control what is installed. `work_dir` is mounted into the container, so treat it as the only folder the agent should be able to write to. `timeout` caps each execution; the default is 600 seconds, and on Windows the timeout is not enforced for native execution.

If an agent doesn't need to run code at all, set `code_execution_config=False`. A tool-calling agent that only queries an API has no reason to also run arbitrary Python.

## Tools instead of free-form code

Free-form code execution is powerful and hard to govern. For anything touching business systems, I prefer registering narrow functions. In 0.2 that means two decorators: `register_for_llm` advertises the function's schema to the agent that decides, and `register_for_execution` lets the proxy run it. The schema comes from type hints and `Annotated` descriptions.

```python
# Continues from the llm_config and is_done() defined above
from typing import Annotated

from autogen import AssistantAgent, UserProxyAgent

analyst = AssistantAgent(
    name="analyst",
    llm_config=llm_config,
    system_message=(
        "You answer questions about orders using the provided tools only. "
        "Reply TERMINATE when the question is answered."
    ),
)

executor = UserProxyAgent(
    name="executor",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=5,
    is_termination_msg=is_done,
    code_execution_config=False,
)


@executor.register_for_execution()
@analyst.register_for_llm(description="Return the status of a single order by its ID.")
def get_order_status(order_id: Annotated[str, "Order ID, for example ORD-1001"]) -> str:
    # Placeholder: replace with a call to your order API
    fake_orders = {"ORD-1001": "shipped", "ORD-1002": "awaiting payment"}
    return fake_orders.get(order_id, "not found")


executor.initiate_chat(analyst, message="What is the status of ORD-1002?")
```

The split between "who can request" and "who can execute" is the useful part. The LLM-backed agent never holds credentials; the executor does, and only for the functions you registered on it. That is a boundary you can explain to a security team. "The agent writes Python and we run it" is not.

## Group chat: use it sparingly

`GroupChat` plus a `GroupChatManager` lets several agents share one conversation. In 0.2.5 the manager picks the next speaker using one of four strings: `"auto"` (the LLM chooses), `"round_robin"`, `"random"` or `"manual"`. You can also stop an agent speaking twice in a row with `allow_repeat_speaker=False`, and `max_round` (default 10) caps the whole chat.

`"auto"` costs an extra LLM call every turn and makes the flow hard to predict. If you already know the order (plan, implement, review), you don't need an LLM to choose the next speaker. Sequential `initiate_chat` calls in plain Python are cheaper, easier to test, and give you a place to check each output before the next step. I reach for group chat only when the order genuinely depends on the content of the conversation.

## When not to use AutoGen

- **Deterministic workflows.** If the steps are fixed, a pipeline of single LLM calls with validation between them beats a conversation between agents on cost, latency and debuggability.
- **Untrusted input plus code execution.** A prompt-injected document plus an agent that runs code is the worst combination in this space. Use tools with narrow permissions, or don't execute at all.
- **Things you need to be stable for a year.** AutoGen renamed core config keys between 0.1 and 0.2 (two months apart), and 0.2.x patch releases still change behaviour; the code executor itself warns that its Docker fallback is subject to change. Pin the exact version in `requirements.txt` and read the release notes before upgrading.

I'd use it for exploratory, code-heavy work: data analysis, generating and testing scripts, and research prototypes where a human is watching. The [AutoGen paper](https://arxiv.org/abs/2308.08155) is worth reading for the conversation patterns it was designed around.

## Where I would start

Begin with one `AssistantAgent` and one `UserProxyAgent`. Set the reply limit, a `None`-safe termination check and Docker explicitly before your first run, not after. Add tools before adding agents. Only reach for group chat once a two-agent loop is reliable and you can say why the speaker order can't be fixed in code.

For how AutoGen compares with role-based frameworks, see my posts on [CrewAI](/blog/2024-01-11-crewai-introduction/) and the [agent frameworks comparison](/blog/2024-01-12-agent-frameworks-comparison/).
