---
title: "Agentic Workflows That Survive Restarts with Durable Functions"
description: "Run an LLM tool-calling loop inside Azure Durable Functions so it checkpoints each step, stays within a step budget and waits hours for human approval."
author: Michael John Peña
draft: false
date: 2025-01-03
tags:
  - AI
  - AI Agents
  - Azure OpenAI
  - Durable Functions
  - Azure Functions
---

The difference between a chatbot and an agentic workflow is that the workflow does the work: it calls tools, reacts to results and finishes a task rather than describing the steps. That shift creates problems a chat loop never had. A task can take minutes or days, it can need a person to sign off halfway through, and the process running it can restart at any moment. A `while` loop in a Python script handles none of that, and it is where most agent prototypes I review stop working once they leave a laptop.

The fix is to put the model and tool calls inside a Durable Functions orchestration, so every step is checkpointed, the loop has a hard budget and approvals can wait as long as they need to.

## The gap between a demo loop and a workflow

A typical agent demo looks like this: send messages to the model with tool definitions, run whatever tools it asks for, append the results, repeat until it stops asking. With [function calling in Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/function-calling) that is about thirty lines of code, and it works.

What it doesn't give you:

- **State that outlives the process.** If the container recycles after step four of seven, the task is gone, along with any side effects you can't easily see.
- **Long waits.** "Ask the on-call engineer before re-running the pipeline" can take an hour. You can't hold an HTTP request or a worker thread open for that.
- **A record of what happened.** Which tool was called, with which arguments, and who approved it.
- **Bounded cost.** A model that keeps asking for one more query keeps spending money.

None of these are AI problems. They are workflow problems, and Azure already has a mature answer for them.

## Why Durable Functions fits

[Durable Functions](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-overview) is an extension of Azure Functions that lets you write stateful orchestrations as ordinary code. Each time the orchestrator awaits an activity, the framework records the result in the orchestration history (a History table in the default Azure Storage provider) and unloads the orchestrator. When it resumes, it replays the history rather than re-running completed work. The Python v2 programming model (decorators instead of `function.json` files) is generally available for Durable Functions and needs [`azure-functions-durable` 1.2.2 or later](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-bindings).

That replay model maps neatly onto an agent loop:

| Agent concern | Durable Functions feature |
|---|---|
| Checkpoint after each model or tool call | Activity results stored in orchestration history |
| Wait for a human | `wait_for_external_event` plus a durable timer |
| Retry a throttled model call | `call_activity_with_retry` |
| Show progress to an operator | Custom status and the built-in status endpoint |
| Survive restarts and scale-out | Orchestrator replay from history |

The constraint you have to respect is that orchestrator code must be deterministic. It can't call the model, read the clock with `datetime.now()` or make network requests directly, because it is replayed many times. All non-deterministic work, including every LLM call, goes into activities. That turns out to be a useful discipline: the orchestrator holds the policy, the activities do the I/O.

## The pattern: a bounded loop with approval gates

The example below is a pipeline triage agent. It can read a pipeline's status freely, but re-running a pipeline needs a person's approval. It uses the `openai` 1.x Python library against the Azure OpenAI `2024-10-21` GA API version, keyless authentication through Entra ID, and `azure-functions-durable` on the Python v2 model. The two tool functions are placeholders for calls to your orchestrator's API.

```python
import json
import os
from datetime import timedelta

import azure.durable_functions as df
import azure.functions as func
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
import openai
from openai import AzureOpenAI

app = df.DFApp(http_auth_level=func.AuthLevel.FUNCTION)

MAX_STEPS = 8
APPROVAL_TIMEOUT = timedelta(hours=4)
NEEDS_APPROVAL = {"rerun_pipeline"}

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_pipeline_status",
            "description": "Get the latest run status and error message for a data pipeline.",
            "parameters": {
                "type": "object",
                "properties": {"pipeline_name": {"type": "string"}},
                "required": ["pipeline_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rerun_pipeline",
            "description": "Trigger a new run of a data pipeline. Only use for transient errors.",
            "parameters": {
                "type": "object",
                "properties": {"pipeline_name": {"type": "string"}},
                "required": ["pipeline_name"],
            },
        },
    },
]
ALLOWED_TOOLS = {t["function"]["name"] for t in TOOLS}

SYSTEM_PROMPT = (
    "You triage failed data pipelines. Check the status first, explain the likely cause, "
    "and request a re-run only if the error looks transient. Finish with a short summary."
)

openai_client = AzureOpenAI(
    azure_endpoint="https://<your-resource-name>.openai.azure.com",
    azure_ad_token_provider=get_bearer_token_provider(
        DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
    ),
    api_version="2024-10-21",
    max_retries=0,  # Durable Functions owns retries; see below.
)


# Placeholder tools: replace with calls to your orchestrator's REST API.
def get_pipeline_status(pipeline_name: str, idempotency_key: str) -> dict:
    return {"pipeline": pipeline_name, "status": "Failed", "error": "Source timeout after 3600s"}


def rerun_pipeline(pipeline_name: str, idempotency_key: str) -> dict:
    # Send idempotency_key to the downstream API so a repeated activity can't start a second run.
    return {"pipeline": pipeline_name, "run_id": "<new-run-id>"}


TOOL_IMPLEMENTATIONS = {"get_pipeline_status": get_pipeline_status, "rerun_pipeline": rerun_pipeline}


@app.route(route="triage/{pipeline_name}", methods=["POST"])
@app.durable_client_input(client_name="client")
async def start_triage(req: func.HttpRequest, client) -> func.HttpResponse:
    pipeline_name = req.route_params["pipeline_name"]
    instance_id = await client.start_new("triage_orchestrator", client_input={"pipeline_name": pipeline_name})
    return client.create_check_status_response(req, instance_id)


@app.route(route="approve/{instance_id}/{tool_call_id}", methods=["POST"])
@app.durable_client_input(client_name="client")
async def submit_approval(req: func.HttpRequest, client) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse("Expected JSON body", status_code=400)
    if not isinstance(body, dict):
        return func.HttpResponse("Expected JSON object", status_code=400)
    await client.raise_event(
        req.route_params["instance_id"],
        f"Approval_{req.route_params['tool_call_id']}",
        {"approved": bool(body.get("approved")), "approver": body.get("approver", "unknown")},
    )
    return func.HttpResponse(status_code=202)


@app.orchestration_trigger(context_name="context")
def triage_orchestrator(context: df.DurableOrchestrationContext):
    goal = context.get_input()
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"The {goal['pipeline_name']} pipeline failed. Investigate and act."},
    ]
    retry = df.RetryOptions(first_retry_interval_in_milliseconds=5000, max_number_of_attempts=3)
    audit = []

    for step in range(MAX_STEPS):
        reply = yield context.call_activity_with_retry("call_model", retry, messages)
        if "error" in reply:
            return {"status": "model_error", "steps": step + 1, "error": reply["error"], "audit": audit}
        messages.append(reply)

        tool_calls = reply.get("tool_calls") or []
        if not tool_calls:
            return {"status": "completed", "steps": step + 1, "summary": reply.get("content"), "audit": audit}

        for call in tool_calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"]["arguments"])
            except json.JSONDecodeError:
                args = None
            tool_request = {"name": name, "args": args, "idempotency_key": f"{context.instance_id}:{call['id']}"}

            if name not in ALLOWED_TOOLS or not isinstance(args, dict):
                decision = None
                result = {"error": f"Invalid tool call: {name}"}
            elif name in NEEDS_APPROVAL:
                context.set_custom_status(
                    {"waiting_for": "approval", "tool": name, "arguments": args, "tool_call_id": call["id"]}
                )
                timeout_task = context.create_timer(context.current_utc_datetime + APPROVAL_TIMEOUT)
                approval_task = context.wait_for_external_event(f"Approval_{call['id']}")
                winner = yield context.task_any([approval_task, timeout_task])

                if winner == approval_task:
                    timeout_task.cancel()
                    decision = approval_task.result or {}
                else:
                    decision = {"approved": False, "approver": "timeout"}
                context.set_custom_status({"waiting_for": None})

                if decision.get("approved"):
                    result = yield context.call_activity("run_tool", tool_request)
                else:
                    result = {"status": "rejected", "reason": f"Not approved ({decision.get('approver')})"}
            else:
                decision = None
                result = yield context.call_activity("run_tool", tool_request)

            audit.append({"tool_call_id": call["id"], "tool": name, "arguments": args, "decision": decision})
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})

    return {"status": "step_budget_exhausted", "steps": MAX_STEPS, "audit": audit}


@app.activity_trigger(input_name="messages")
def call_model(messages: list) -> dict:
    try:
        response = openai_client.chat.completions.create(
            model="<your-deployment-name>",
            messages=messages,
            tools=TOOLS,
            temperature=0,
        )
    except openai.BadRequestError as exc:
        # A 400 (bad request, content filter) won't succeed on retry, so return it instead of raising.
        return {"error": f"Model request rejected: {exc.message}"}
    return response.choices[0].message.model_dump(exclude_none=True)


@app.activity_trigger(input_name="request")
def run_tool(request: dict) -> dict:
    implementation = TOOL_IMPLEMENTATIONS[request["name"]]
    return implementation(**request["args"], idempotency_key=request["idempotency_key"])
```

To run it, put the code in `function_app.py` with extension bundle 4.x in `host.json`, install `azure-functions`, `azure-functions-durable` (1.2.2 or later), `azure-identity` and `openai` 1.x, and give the Function App's managed identity the Cognitive Services OpenAI User role on the Azure OpenAI resource.

Start a run with a POST to `/api/triage/sales_ingest`. The response includes the standard status URLs, so an operator or a Teams card can poll the custom status, see that the orchestration is waiting on `rerun_pipeline` for `sales_ingest` along with the tool call ID, and POST a decision such as `{"approved": true, "approver": "<name>"}` to `/api/approve/<instance-id>/<tool-call-id>`.

## The design decisions that matter

**The policy lives in the orchestrator, not the prompt.** The allow-list, the approval list and the step budget are code. The system prompt says "only re-run for transient errors", but that is a hint to the model. The thing that actually prevents a re-run is the `NEEDS_APPROVAL` check, and it can be reviewed and unit tested like any other code.

**Each approval event is keyed to its tool call.** Durable Functions buffers external events that arrive before the orchestrator waits for them. With one shared event name, a late approval (posted after the timeout won) or a duplicate POST would sit in that buffer and silently approve the next, different re-run. Naming the event `Approval_<tool-call-id>` means a decision can only answer the call it was made for.

**Every tool call goes into the audit list.** Gated and ungated calls alike are recorded with their call ID, arguments and, for gated calls, the decision and approver, and the list is returned in the orchestration output. The orchestration history holds the same detail, but it is easier to query a result than to replay history.

**A rejection is a tool result, not a crash.** When approval is declined or times out, the model gets told so and can still produce a useful summary ("the source timed out; re-run was declined, recommend checking the source system"). Failing the whole orchestration would throw away the investigation.

**One layer owns retries.** The `openai` client retries throttled and failed requests twice by default, and stacked under three Durable attempts that is up to nine calls for one step. The sample sets `max_retries=0` so `call_activity_with_retry` is the only retry policy, and it is visible in the orchestration history. A 400 is different: a bad request or a content filter hit fails the same way every time, so `call_model` catches `BadRequestError` and returns it as a result, and the orchestrator ends with a `model_error` status rather than burning attempts.

**The step budget is a hard stop.** Eight rounds is arbitrary, but some number has to be there. Without it, a confused model and a tool that keeps returning ambiguous results make an open-ended bill. When the budget runs out, return a distinct status so you can alert on it and look at the trace.

**Replay gives you checkpoints for free, and that changes the cost of failure.** If the host restarts after the model has asked for a re-run but before anyone approves, the orchestration replays from history. The completed model calls are not repeated, so you don't pay for them twice, and the model doesn't get a chance to change its mind on replay.

**Activities can run more than once.** Durable Functions guarantees at-least-once execution for activities. A model call repeated on retry is just cost; a pipeline re-run triggered twice is an incident. Make state-changing tools idempotent. The sample builds a key from the orchestration instance ID and the tool call ID, which stays the same on replay and retry, and hands it to every tool so `rerun_pipeline` can pass it to the downstream API as a deduplication key.

**Trust the approver's identity from authentication, not the request body.** The sample takes `approver` from the JSON body to keep it short. In a real deployment, put the approval endpoint behind Entra ID authentication and read the identity from the validated token, or route approvals through a Logic App or Teams adaptive card that already knows who clicked.

**Watch the history size.** The full message list is an activity input every round, and inputs and outputs are stored in the orchestration history. Keep tool outputs small and summarised. If a tool returns a 5 MB log file, store it in Blob Storage and pass a reference. If a loop could legitimately run longer than a small `MAX_STEPS` allows, cap the message window you send to the model, or call `continue_as_new` with a summarised state so the history restarts instead of growing without limit.

## Where this sits next to Azure AI Agent Service

[Azure AI Agent Service](https://learn.microsoft.com/en-us/azure/ai-services/agents/overview), announced at Ignite in November 2024, is in preview and manages threads and runs for you. It already pauses a run with `requires_action` when it needs one of your functions, which is a natural approval point, as I showed in [what you can actually ship on day one](/blog/2025-01-01-ai-agents-2025-the-year-of-autonomous-systems/). It does not orchestrate a four-hour wait for a person or retry your downstream systems, and while it records run steps (tool calls and their outputs) on the service side, approvals, who made them and the waits around them are yours to build. You can combine the two: a Durable orchestration that drives an Agent Service run and owns the waits and approvals.

For a GA production dependency in January 2025, I'd rather own the loop with Azure OpenAI chat completions and Durable Functions, both generally available, than put a business process on a preview SLA. The loop is not the hard part; the policy around it is.

If you don't want code at all, a Logic Apps Standard workflow with an approval step and the [built-in Azure OpenAI connector](https://learn.microsoft.com/en-us/azure/logic-apps/connectors/azure-ai) (announced in public preview in February 2024, so check its status before you build on it) gives you similar durability, at the price of less control over the loop itself.

## When this is overkill

If the steps are known in advance, you don't need a model choosing them. "When a pipeline fails, fetch the error, summarise it and open a ticket" is a fixed sequence: write it as an ordinary orchestration with one LLM call for the summary. Anthropic's [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) makes the same point: use a predefined workflow where you can, and only hand the model control of the path when the path genuinely can't be known up front. The [Durable Functions patterns post](/blog/2021-04-01-azure-durable-functions-orchestration-patterns/) covers those fixed shapes.

It is also overkill for interactive assistants where a person is in the chat and every action is already supervised. Durability matters when nobody is watching.

## The takeaway

An agentic workflow is still a workflow. Give the model the narrow job of choosing the next step, and give everything else (state, retries, timeouts, approvals, budgets and audit) to an engine built for it. On Azure today, Durable Functions does that job well, and it keeps the decisions that matter most in code your team can review. For more on approval design itself, see [human-in-the-loop agents](/blog/2024-07-17-human-in-the-loop-agents/).
