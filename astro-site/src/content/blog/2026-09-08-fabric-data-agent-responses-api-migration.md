---
title: "Fabric Data Agents Move to the Responses API: What Consumers Must Change"
description: "Fabric data agents now use GPT-5.1 and a Responses API client. What notebook, Foundry and app callers must change, and why you need a full eval re-run."
author: Michael John Peña
draft: false
date: 2026-09-08
tags:
  - Microsoft Fabric
  - AI Agents
  - OpenAI
  - Evaluation
  - Python
---

The [Fabric August 2026 feature summary](https://community.fabric.microsoft.com/blog/fbc_fabricupdatesblogs/fabric-august-2026-feature-summary/5325824) packed two changes to data agents into one month: the orchestrator moved to GPT-5.1, and the layer that serves agent conversations started moving from the OpenAI Assistants API to the Responses API. OpenAI's Assistants API shut down on 26 August 2026, so this isn't optional housekeeping. Fabric's Assistants-shaped endpoint (`FabricOpenAI`) still answered requests on 8 September, which is why the SDK's evaluation helper still defaults to it, but Microsoft has tied the Assistants path to OpenAI's 26 August deprecation and its docs tell you to migrate, so treat any remaining `FabricOpenAI` code as on borrowed time. If you call a data agent from a notebook, a Foundry agent or your own application, your querying code and your confidence in its answers both need attention.

Most teams will treat this as one SDK upgrade. I'd split it into two separate pieces of work. One is a client migration you can finish in an afternoon. The other is a model change that silently invalidates whatever accuracy numbers you had before August.

## What actually changed

There are two changes, and they fail in different ways.

**The orchestrator model.** The data agent orchestrator is the component that rephrases the question, plans which data source and query to use, and writes the final answer. It now runs on GPT-5.1 in both the standard and preview runtimes. The August summary says outright that instructions tuned for the previous model may behave differently, and recommends re-running evaluations and revisiting agent instructions. That's Microsoft telling you this is a behaviour change, not a patch.

**The consumption API.** The [Fabric data agent Python SDK](https://learn.microsoft.com/en-us/fabric/data-science/fabric-data-agent-sdk) (still preview) now has two data-plane clients. `FabricOpenAI` is the Assistants-shaped client most notebooks were written against. `FabricOpenAIResponses`, added in 0.1.23a0 (May 2026) and extended through 0.1.30a0 (August), wraps the Responses and Conversations APIs. Microsoft's guidance was to start moving to the Responses client from 11 August, ahead of the 26 August Assistants deprecation, and it is explicit that only querying code changes. Creating, configuring and publishing the agent stays the same.

The release notes on the SDK's PyPI package page are the best running record. The relevant points as of 0.1.30a0 (20 August):

| Area | Assistants client (`FabricOpenAI`) | Responses client (`FabricOpenAIResponses`) |
|---|---|---|
| State | Thread, with messages appended | Conversation, holding items; or `previous_response_id` chaining |
| Unit of work | Run on a thread, polled to completion | `responses.create()` or `responses.stream()` |
| Assistant object | Created per session (`assistants.create`) | None; the agent is bound by `artifact_name` |
| Model | Not meaningful to the caller | Sends `gpt-5.1` by default (the SDK accepts `model=`, but Fabric doesn't let you change the data agent's LLM) |
| Evaluation default | Used by `evaluate_data_agent` by default | Opt in with `client_class=FabricOpenAIResponses` |

That last row is the trap, and I'll come back to it.

## Notebooks: threads become conversations

The Assistants-era pattern from the Fabric docs created a throwaway assistant, created a thread, appended a message, started a run and polled it. If you read run steps to pull out the generated SQL or DAX, you had code coupled to the run-step shape as well.

The Responses equivalent from the SDK documentation is shorter. The client defaults to the sandbox (draft) stage; pass `ai_skill_stage="production"` to query what you've actually published.

```python
from fabric.dataagent.client import FabricOpenAIResponses

client = FabricOpenAIResponses(
    artifact_name="<your-data-agent-name>",
    ai_skill_stage="production",
)

# A conversation replaces the thread as the durable unit of state
conversation = client.conversations.create()

first = client.responses.create(
    input="What was total revenue last quarter?",
    conversation=conversation.id,
)
print(first.output_text)

follow_up = client.responses.create(
    input="Which region contributed most of it?",
    conversation=conversation.id,
)
print(follow_up.output_text)

# Inspect what the agent actually did, rather than parsing run steps
for item in follow_up.output:
    print(item.type)
```

Three things to get right when you port code.

**Decide where state lives.** You can attach every turn to a conversation, or chain turns with `previous_response_id` and skip the conversation. A conversation is the closer match to a thread and the one I'd default to for anything a user comes back to. Chaining suits a scripted multi-step notebook where the whole exchange lives and dies in one cell run. Don't mix the two in one session: you'll end up with two sources of truth for what the agent "remembers".

**Old threads don't migrate themselves.** OpenAI provides no automated thread-to-conversation conversion, and nothing in the Fabric SDK notes suggests Fabric does either. The [Foundry migration guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/migrate) is explicit for its side: past threads, runs and messages aren't copied, and new conversations start fresh. If your app shows conversation history from a thread ID, plan for that history to stop at the cut-over. Store the transcript yourself if users depend on it.

**Tool-call shapes are different.** In the Assistants model, the agent's work was exposed as run steps with nested tool calls. In the Responses model, everything the agent did comes back as typed items in `response.output`, next to the final message. Any code that parsed run steps to log the generated query, or to show "here is the SQL I ran" in a UI, has to be rewritten against output items. Print the item types for a handful of real questions before you write the parser. Don't assume the shapes match what you saw in the Assistants payload.

## Instructions: put them in the agent, not the call

The other subtle shift is instruction handling. With OpenAI's Assistants API a run could carry its own instructions, and some Fabric callers tried the same trick, pushing extra guidance ("answer in AUD", "only use the finance model") in at call time. The Responses API does have an `instructions` parameter. OpenAI documents that instructions are not carried forward when you chain with `previous_response_id`, so a per-call instruction applies to that turn only.

For a Fabric data agent, I wouldn't rely on per-call instructions at all. The agent's instructions and the per-data-source instructions are configured and published in Fabric, and that's where the orchestrator expects them. If behaviour matters on every turn, it belongs in the published agent configuration, under version control alongside your semantic model. Now that the orchestrator is GPT-5.1, that configuration is exactly what you need to re-test.

## Foundry and custom apps

If a Foundry agent calls your data agent through the [Microsoft Fabric data agent tool](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/fabric), you have two layers of model and two layers of state. The Foundry agent's model only orchestrates and writes the response. It doesn't change the model the Fabric data agent uses internally. That means the GPT-5.1 swap happened underneath you even if you changed nothing in Foundry. If your Foundry code still uses the older threads-and-runs pattern, the Foundry migration guide maps it the same way: threads to conversations, runs to responses, with tool calls and outputs returned as conversation items. The guide also calls out verifying state, tool calls, outputs and error handling after you move. Treat that as the test plan, not a footnote.

Custom applications built on Microsoft's standalone [fabric_data_agent_client](https://github.com/microsoft/fabric_data_agent_client) call `beta.assistants`, `beta.threads` and `beta.threads.runs` directly. Its README says that code was supported until 26 August 2026 and recommends moving to the Fabric data agent MCP server. I agree with that direction for anything outside a Fabric notebook. An MCP endpoint is a cleaner contract than an Assistants-compatible shim, and it is what Copilot Studio and other agent hosts already speak.

If you also run your own agent runtime, this is the same state-ownership question I raised in [the hosted agents post](/blog/2026-08-12-foundry-hosted-agents-ga-when-to-stop-self-hosting/). Know which layer owns the conversation, because that layer's API just changed.

## Treat the model swap as a regression event

This is the part teams will skip. A data agent is a text-to-query system with a language model doing the planning. When the planner changes, the queries change. Different joins, different filters, a different reading of "last quarter" against your fiscal calendar, a different choice between two semantic models that both contain revenue. None of that shows up as an error. You get a confident, well-written answer with a different number in it.

So the GPT-5.1 move needs the same treatment I argued for with [model routing](/blog/2026-08-05-model-router-cross-provider-agent-routing/) and [GPT-5.6 tier selection](/blog/2026-08-01-gpt-5-6-sol-terra-luna-tiering/). Your last eval describes a system that no longer exists. Re-run the full evaluation set, compare question by question against the pre-August baseline, and read the failures before you touch any instructions.

The SDK's `evaluate_data_agent` makes this cheap, with one catch. As of 0.1.30a0 the evaluation helper still uses the Assistants path by default. If you want your evaluation to exercise the path your users now hit, pass the Responses client explicitly:

```python
import pandas as pd
from fabric.dataagent.client import FabricOpenAIResponses
from fabric.dataagent.evaluation import evaluate_data_agent

df = pd.DataFrame(
    {
        "question": [
            "What was total revenue last quarter?",
            "How many active customers were there in June 2026?",
        ],
        "expected_answer": [
            "<expected revenue figure>",
            "<expected customer count>",
        ],
    }
)

evaluate_data_agent(
    df,
    data_agent_name="<your-data-agent-name>",
    client_class=FabricOpenAIResponses,
)
```

My rule of thumb is that an evaluation run has to go through the same client, API and model as production, or it's measuring something else. Two more practical points:

- **Isolate the API change from the model change.** You can't roll the orchestrator back to the previous model, but both clients now run on GPT-5.1. Run the same evaluation set once with the default `FabricOpenAI` client and once with `client_class=FabricOpenAIResponses`. Differences between those two runs come from the API path, and differences from your pre-August baseline that appear in both runs come from the model.
- **Re-baseline, don't just compare.** Once the new results are reviewed and accepted, they become the baseline. If you keep comparing against the old numbers, every future change looks like noise.

## What I'd do this week

If you only have a day: switch notebook and app callers to `FabricOpenAIResponses` with conversations, rewrite any run-step parsing against output items, and move per-call instructions into the published agent. Then run your evaluation set through the Responses client and read every changed answer.

What you shouldn't do is treat a clean migration as proof of a correct agent. The code change is mechanical. The model change is the one that can put a wrong number in front of a finance team, and only your evaluation set will catch it.
