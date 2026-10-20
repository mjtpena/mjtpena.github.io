---
title: "AI Agents in 2025: What You Can Actually Ship on Day One"
description: "A practical look at the agent tooling that really exists on 1 January 2025, what is still preview, and where to draw the line on autonomy."
author: Michael John Peña
draft: false
date: 2025-01-01
tags:
  - AI
  - AI Agents
  - Azure AI Agent Service
  - Copilot Studio
  - Governance
---

Every vendor keynote in late 2024 told us 2025 is the year of autonomous agents. That may turn out to be true, but on 1 January the tooling that exists is mostly in preview, the patterns are still settling, and the gap between a demo and something you can put in front of an auditor is wide. If you are planning agent work this year, the useful question isn't "how autonomous can we go?" but "what is real today, and which actions should never run without a person?"

## What actually exists on 1 January 2025

Here is the landscape as it stands, with release status, because the status matters more than the marketing.

| Option | What it is | Status today |
|---|---|---|
| Azure AI Agent Service | Managed agent runtime in Azure AI Foundry: threads, runs, tool calling, built on the Assistants API wire protocol | Announced at Ignite in November 2024, in preview; Python SDK is `azure-ai-projects` 1.0.0b4 (beta) |
| Azure OpenAI Assistants API | The underlying threads/runs/tools API | Preview |
| Copilot Studio autonomous agents | Low-code agents that fire on event triggers instead of waiting for a chat message | Public preview since Ignite 2024 |
| Semantic Kernel Agent Framework | `ChatCompletionAgent`, `AgentGroupChat` and friends in SK | Experimental |
| AutoGen | Microsoft Research multi-agent framework | 0.2 is the stable line; the 0.4 rewrite is still in dev builds |
| LangGraph / CrewAI | Open-source orchestration frameworks | Shipping regularly, pre-1.0 |

Microsoft's [Ignite announcement of Azure AI Agent Service](https://techcommunity.microsoft.com/blog/azure-ai-services-blog/introducing-azure-ai-agent-service/4298357) positions it as the enterprise runtime: bring your own storage and networking, use tools such as file search, code interpreter, Bing grounding, Azure AI Search, OpenAPI specs and Azure Functions, and run models beyond GPT-4o. The [Agent Service "What's new" page](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/whats-new) records the preview starting in December 2024. I covered the service itself in [an earlier post](/blog/2024-11-10-azure-ai-agent-service/), so I won't repeat the tour here.

On the low-code side, Copilot Studio's [event-triggered agents](https://learn.microsoft.com/en-us/power-platform/release-plan/2024wave2/microsoft-copilot-studio/create-automated-copilots-triggered-events) let an agent react to a new email, a new file or a Dataverse row change without a user starting the conversation. That is the most "autonomous" thing most organisations can switch on today, and it is in preview.

Notice what is missing from that table: nothing is GA. That doesn't mean you shouldn't build. It means you should design for API changes, keep the agent logic thin and replaceable, and avoid committing a business process to a preview SLA.

## Things no SDK gives you, whatever the slides imply

A lot of agent content I read in December described capabilities that don't exist in any shipping SDK. It's worth being blunt about them, because they shape architecture decisions.

- **Calibrated confidence.** There is no `confidence` score on a tool call that you can threshold at 0.7 and trust. Models don't produce calibrated probabilities for "should I restart this job". If you want escalation rules, base them on the *action*, not on the model's self-assessment.
- **Long-term memory as a product feature.** Agent Service persists threads, so a conversation can resume. Remembering facts across threads, deciding what to forget, and handling a user's request to delete what you hold about them are still yours to build, usually on Azure AI Search or Cosmos DB.
- **Agents that learn new tools on their own.** An agent uses the tool definitions you give it, described by a JSON schema or an OpenAPI spec. Adding a tool is a deployment, and it should go through the same review as any other code change.
- **Multi-agent consensus that improves correctness for free.** Several agents voting is several model calls with correlated errors. It can help, but it multiplies cost and latency, and it is not a substitute for deterministic validation. I go into orchestration options in [multi-agent orchestration patterns](/blog/2025-01-02-multi-agent-orchestration-patterns/).

## Workflow or agent? Decide this first

Anthropic's December write-up, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), draws a distinction I agree with: a *workflow* runs LLM calls along a path you defined in code, while an *agent* lets the model decide its own steps and tool use in a loop. Their advice is to use the simplest option that works and only add autonomy when it clearly pays for itself.

In data and platform work, most of what gets pitched as an agent is a workflow. "When a pipeline fails, summarise the error, look up the runbook and open a ticket" has a fixed shape. Write it as a Logic App, a Durable Function or a Fabric pipeline with one or two LLM calls inside, and you get retries, monitoring and predictable cost from tooling your operations team already understands.

An agent earns its place when the path genuinely can't be known in advance: triaging an unfamiliar failure across several systems, answering open-ended questions over a mix of documents and data, or investigating an anomaly where the next query depends on the last result.

My rule of thumb: if you can draw the flowchart on a whiteboard in five minutes, it's a workflow.

## Where to draw the autonomy line

Once you've decided you need an agent, the most important design decision is which tools it can call without a human. I sort tools into three tiers:

| Tier | Examples | Default policy |
|---|---|---|
| Read | Query run history, read logs, search documentation | Autonomous |
| Reversible write | Re-run a failed pipeline, create a draft ticket, post to a channel | Autonomous with logging, or approval in production |
| Irreversible or costly | Delete data, change permissions, scale up capacity, email a customer | Always requires approval |

This is a policy on *tools*, so it is enforced in your code rather than requested in the prompt. Instructions like "only restart jobs when necessary" are a hint to the model, not a control.

Agent Service makes this straightforward because function tools don't execute on the service side. When the model wants to call one of your functions, the run pauses with status `requires_action` and waits for your code to submit the output. That pause is the natural place for an approval gate.

The example below uses `azure-ai-projects` 1.0.0b4, the current beta. The two functions are placeholders standing in for calls to your orchestrator's API; everything else is the real SDK surface. Expect method names to shift before GA.

```python
import json
import os
import time

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    FunctionTool,
    RequiredFunctionToolCall,
    SubmitToolOutputsAction,
    ToolOutput,
)
from azure.identity import DefaultAzureCredential


def get_pipeline_status(pipeline_name: str) -> str:
    """
    Get the latest run status and error message for a data pipeline.

    :param pipeline_name (str): The name of the pipeline.
    :return: Run status as a JSON string.
    :rtype: str
    """
    # Placeholder: call your orchestrator's REST API here.
    return json.dumps({"pipeline": pipeline_name, "status": "Failed", "error": "Source timeout after 3600s"})


def rerun_pipeline(pipeline_name: str) -> str:
    """
    Trigger a new run of a data pipeline.

    :param pipeline_name (str): The name of the pipeline.
    :return: The new run ID as a JSON string.
    :rtype: str
    """
    # Placeholder: call your orchestrator's REST API here.
    return json.dumps({"pipeline": pipeline_name, "run_id": "<new-run-id>"})


# Tools that change state must be approved by a person before they run.
NEEDS_APPROVAL = {"rerun_pipeline"}

functions = FunctionTool(functions={get_pipeline_status, rerun_pipeline})

project_client = AIProjectClient.from_connection_string(
    credential=DefaultAzureCredential(),
    conn_str=os.environ["PROJECT_CONNECTION_STRING"],
)

with project_client:
    agent = project_client.agents.create_agent(
        model=os.environ["MODEL_DEPLOYMENT_NAME"],
        name="pipeline-triage",
        instructions=(
            "You triage failed data pipelines. Check the status first, explain the likely cause, "
            "and propose a re-run only if the error looks transient."
        ),
        tools=functions.definitions,
    )

    thread = project_client.agents.create_thread()
    project_client.agents.create_message(
        thread_id=thread.id,
        role="user",
        content="The nightly sales_ingest pipeline failed. What happened, and should we re-run it?",
    )

    run = project_client.agents.create_run(thread_id=thread.id, assistant_id=agent.id)

    while run.status in ["queued", "in_progress", "requires_action"]:
        time.sleep(1)
        run = project_client.agents.get_run(thread_id=thread.id, run_id=run.id)

        if run.status == "requires_action" and isinstance(run.required_action, SubmitToolOutputsAction):
            tool_outputs = []
            for tool_call in run.required_action.submit_tool_outputs.tool_calls:
                if not isinstance(tool_call, RequiredFunctionToolCall):
                    continue

                name = tool_call.function.name
                if name in NEEDS_APPROVAL:
                    print(f"Agent wants to call {name} with {tool_call.function.arguments}")
                    if input("Approve? [y/N] ").strip().lower() != "y":
                        tool_outputs.append(
                            ToolOutput(
                                tool_call_id=tool_call.id,
                                output=json.dumps({"status": "rejected", "reason": "Operator declined"}),
                            )
                        )
                        continue

                tool_outputs.append(ToolOutput(tool_call_id=tool_call.id, output=functions.execute(tool_call)))

            project_client.agents.submit_tool_outputs_to_run(
                thread_id=thread.id, run_id=run.id, tool_outputs=tool_outputs
            )

    print(f"Run finished with status: {run.status}")
    if run.status == "failed":
        print(f"Error: {run.last_error}")

    messages = project_client.agents.list_messages(thread_id=thread.id)
    for msg in reversed(messages.data):
        for text in msg.text_messages:
            print(f"{msg.role}: {text.text.value}")

    project_client.agents.delete_agent(agent.id)
```

Two details matter here. First, a rejection is returned to the model as a tool output rather than cancelling the run, so the agent can explain what it would have done and the operator still gets a useful summary. Second, the approval list lives in code, next to the tool definitions, where it can be reviewed and tested. In a real deployment the `input()` call becomes an adaptive card in Teams or an approval step in a Logic App, and the run waits until someone answers. I wrote about other approval patterns in [human-in-the-loop agents](/blog/2024-07-17-human-in-the-loop-agents/).

Note what this example does *not* do: it doesn't let the model decide whether approval is needed. That decision belongs to the person who owns the system.

## The unglamorous work that decides success

The model is rarely the reason an agent project fails. These are:

- **Identity.** Give the agent its own managed identity with the narrowest roles that work. If it can only read run history and trigger one pipeline, a prompt injection can only do that much damage.
- **Tracing.** Log every tool call, its arguments, its result and who approved it. The SDK has tracing support; use it from the first prototype, because reconstructing "why did it do that?" after an incident without traces is guesswork.
- **Evaluation.** Build a small set of realistic scenarios (a transient timeout, a schema change, a permissions error) and check the agent's choices against them before every prompt or model change. Agents regress quietly.
- **Cost ceilings.** An agent loop can call the model many times per task. Cap the number of tool-call rounds you'll accept, and alert on runs that exceed it.
- **Preview risk.** Wrap the SDK behind your own interface so the inevitable breaking changes before GA touch one module, not your whole codebase.

## When not to build an agent

Skip it when the process is regulated and needs a deterministic, explainable path; when the cost of a wrong action is high and you can't make it reversible; when a rules engine or a well-written runbook already handles 95% of cases; or when your team has no capacity to own evaluation and tracing. An agent you can't observe is a liability, not automation.

## My take for the year

I expect 2025 to be the year agents move from demos to narrow production use, but the winners will be boring: read-heavy agents that investigate and summarise, with every state-changing action behind an approval gate that a person controls. Start with one well-scoped problem, pick a runtime whose preview status you can live with, enforce autonomy limits in code, and earn the right to remove an approval step with evidence from your traces rather than a feeling that the model is good enough now.
