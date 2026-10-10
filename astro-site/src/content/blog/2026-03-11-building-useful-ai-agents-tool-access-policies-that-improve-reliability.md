---
title: "Least-Privilege Tools for AI Agents: Four Layers of Control"
description: "Agent reliability depends on which tools a model can reach. Four layers of tool policy (surface, schema, approval, budget) with Agent Framework code."
author: Michael John Peña
draft: false
date: 2026-03-11
tags:
  - AI
  - AI Agents
  - Security
  - Architecture
  - Python
---

Most unreliable agent designs I see don't fail because the model is weak. They fail because the model can reach too much: thirty tools when the task needs three, a write operation with the same standing as a lookup, and a service credential that can touch everything the agent might one day need. Every extra tool is another wrong choice the model can make, and every broad permission makes that wrong choice more expensive. Tool access policy is where reliability and security turn out to be the same problem.

OWASP's 2025 Top 10 for LLM applications calls this [Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) and splits it into three root causes: excessive functionality, excessive permissions and excessive autonomy. That's a useful checklist, but it doesn't tell you where to put the controls. I think about it as four layers, and the rule is that each layer is enforced in code, not requested in the prompt.

## Layer 1: the tool surface

The cheapest reliability gain is giving the model fewer tools. OpenAI's [function calling guide](https://developers.openai.com/docs/guides/function-calling) suggests keeping fewer than 20 functions available at any one time and calls it a soft suggestion. My view is that the real problem starts well before 20 when tools overlap: `search_orders`, `find_order` and `get_order_by_customer` look obviously different to the person who wrote them and nearly identical to a model reading three one-line descriptions.

Three habits keep the surface small:

- **One agent, one job, one tool list.** An agent that answers invoice questions doesn't need the supplier onboarding tools just because they live in the same API. If two jobs need disjoint tool sets, that's often a sign you want a workflow with two steps rather than one agent with everything (I made that case in [Workflow First, Agent Inside](/blog/2026-02-11-agents-vs-workflows/)).
- **Filter MCP servers, don't import them whole.** An MCP server is written for every possible client, not for your agent. Connecting one exposes its whole catalogue unless you filter it. Both Agent Framework's MCP tools and the [MCP tool in Foundry Agent Service](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/model-context-protocol) take an `allowed_tools` list. Use it every time.
- **Separate reads from writes.** A single `manage_invoice(action, ...)` tool is convenient to build and impossible to govern, because the policy you want for "look it up" and "stop the payment" is different. Split them so each can carry its own approval rule.

## Layer 2: the schema

The second layer is what the model can say once it has picked a tool. A parameter typed as free text is an invitation to improvise. A parameter typed as an enum is a contract.

My rule of thumb: if a human operator would pick from a dropdown, the model should too. Hold reasons, status transitions, region codes and report names should all be `Literal` types or enums, and the tool should validate identifiers itself rather than trusting the model to have copied them correctly. The tool that should never exist is the "flexible" one: `run_sql(query)` or `call_api(path, body)`. They turn the model into the policy engine, and the model is the one component you can't unit test.

The second rule: authorisation happens inside the tool, against the caller's identity, not in the instructions. "Only look up invoices for the user's own cost centre" in a system prompt is a hope. The same check in the API behind the tool is a control.

## Layer 3: approval

Some calls should never run on the model's say-so alone. Microsoft Agent Framework, whose Python packages moved from weekly betas to release candidates on 20 February (`1.0.0rc3` is current as I write), lets you declare that on the tool itself with `approval_mode`. A tool marked `always_require` doesn't execute; the run comes back with a function approval request, and your code decides.

Here's a small accounts payable agent with one read tool and one write tool. The read runs freely, the write needs a person, the hold reason is an enum, and the loop has hard limits.

```python
# pip install agent-framework-core==1.0.0rc3 openai==2.26.0 azure-identity==1.25.2
# Sign in with `az login`; your identity needs an Azure OpenAI user role on the resource.
import asyncio
from typing import Annotated, Any, Literal

from agent_framework import Agent, AgentResponse, Message, tool
from agent_framework.azure import AzureOpenAIChatClient
from azure.identity import AzureCliCredential

# Stand-in for your finance system's API. In production these calls go through
# a service with its own identity and its own authorisation checks.
INVOICES = {
    "INV-10423": {"supplier": "Contoso Freight", "amount": 18450.00, "status": "approved"},
    "INV-10431": {"supplier": "Fabrikam Office", "amount": 912.40, "status": "received"},
}


@tool(approval_mode="never_require")
def get_invoice(invoice_id: Annotated[str, "Invoice number, for example INV-10423"]) -> str:
    """Return the supplier, amount and status of one invoice."""
    invoice = INVOICES.get(invoice_id)
    if invoice is None:
        return f"No invoice found with id {invoice_id}."
    return f"{invoice_id}: {invoice['supplier']}, ${invoice['amount']:,.2f}, status {invoice['status']}."


@tool(approval_mode="always_require")
def place_invoice_on_hold(
    invoice_id: Annotated[str, "Invoice number, for example INV-10423"],
    reason: Annotated[Literal["disputed", "duplicate", "awaiting_po"], "Why the invoice is being held"],
) -> str:
    """Stop an approved invoice from being paid until someone releases the hold."""
    invoice = INVOICES.get(invoice_id)
    if invoice is None:
        return f"No invoice found with id {invoice_id}."
    invoice["status"] = f"on hold ({reason})"
    return f"{invoice_id} is now on hold: {reason}."


async def run_with_approvals(agent: Agent, query: str) -> AgentResponse:
    result = await agent.run(query)
    while result.user_input_requests:
        inputs: list[Any] = [query]
        for request in result.user_input_requests:
            call = request.function_call
            answer = await asyncio.to_thread(input, f"Approve {call.name} {call.arguments}? (y/n) ")
            inputs.append(Message("assistant", [request]))
            inputs.append(Message("user", [request.to_function_approval_response(answer.strip().lower() == "y")]))
        result = await agent.run(inputs)
    return result


async def main() -> None:
    client = AzureOpenAIChatClient(
        endpoint="https://<your-resource-name>.openai.azure.com/",
        deployment_name="<your-deployment-name>",
        credential=AzureCliCredential(),
        function_invocation_configuration={
            "max_iterations": 4,
            "max_function_calls": 6,
            "terminate_on_unknown_calls": True,
        },
    )
    agent = Agent(
        client=client,
        name="InvoiceDesk",
        instructions=(
            "You answer accounts payable questions about single invoices. "
            "Use get_invoice for facts. Only place an invoice on hold when the user asks for it."
        ),
        tools=[get_invoice, place_invoice_on_hold],
    )
    result = await run_with_approvals(agent, "INV-10423 looks like a duplicate of last month's bill. Please hold it.")
    print(result.text)


if __name__ == "__main__":
    asyncio.run(main())
```

The approval prompt shows the tool name and the exact arguments, which is the point: a person approves `place_invoice_on_hold` for `INV-10423` with reason `duplicate`, not a paraphrase the model wrote. In a real system the `input()` call becomes a Teams card or a queue item, and you persist the pending request so the approval can arrive minutes later. If you're on .NET, the same idea is `ApprovalRequiredAIFunction`, which I walked through in the [Agent Framework .NET field guide](/blog/2026-02-15-microsoft-agent-framework/).

For MCP servers, `approval_mode` also accepts a dictionary with `always_require_approval` and `never_require_approval` lists. Read the source before you trust it: a tool that appears in neither list falls back to the default, which is no approval. That's why I always pair it with `allowed_tools`, so nothing can arrive on the agent's tool list without me having decided its approval rule.

```python
# Fragment: an MCP server filtered to three tools, with approval on the one write.
from agent_framework import MCPStreamableHTTPTool

tickets = MCPStreamableHTTPTool(
    name="service-desk",
    url="https://<your-mcp-server>/mcp",
    allowed_tools=["search_tickets", "get_ticket", "add_ticket_comment"],
    approval_mode={
        "never_require_approval": ["search_tickets", "get_ticket"],
        "always_require_approval": ["add_ticket_comment"],
    },
)
```

The Foundry Agent Service MCP tool has the equivalent settings in `allowed_tools` and `require_approval`, with approval required for every call by default. That default is the right way round.

## Layer 4: budget

The last layer stops a confused agent from being an expensive one. Agent Framework's `function_invocation_configuration` gives you three settings I'd set on every agent:

| Setting | What it limits | Default in rc3 |
|---|---|---|
| `max_iterations` | Model round trips in one run | 40 |
| `max_function_calls` | Total tool executions in one run | No limit |
| `terminate_on_unknown_calls` | Whether a call to a tool not on the list raises an error | `False` |

Forty round trips is generous for a chat assistant and a long way from what an invoice lookup needs. Two caveats from the source: `max_function_calls` is checked after each batch of parallel calls, so a model that asks for ten calls at once will get all ten; and the per-tool `max_invocations` counter lives on the tool instance for its whole lifetime, so a module-level tool in a long-running service will eventually stop working. Use the per-request setting for request limits.

## Identity sits underneath all four

None of these layers matter if the tool runs with a credential that can do anything. The agent process should authenticate with a managed identity scoped to the APIs its tools call, and where the data is user-specific, the tool should act on behalf of the signed-in user so the downstream system applies its own permissions. The model never sees a key, a connection string or a token. If a prompt injection convinces the model to call `get_invoice` for someone else's cost centre, the API should say no, regardless of what the model believes.

## When this is too much

Not every agent needs all four layers at full strength. A read-only assistant over public documentation needs a small tool list and a budget; approval adds friction with nothing to protect. An internal prototype with no write tools can skip the approval loop entirely. The layers earn their keep in proportion to what a wrong call costs: money moving, records changing, messages leaving the organisation.

And if you find yourself requiring approval on most tool calls, the agent is the wrong shape. A human approving every step is a workflow with extra latency. Build the workflow and keep the model for the one step that needs judgement.

## The decision in one line

Start every agent with the smallest tool list that can finish the task, typed parameters, approval on every write, a low iteration cap and an identity that can't exceed the user's own rights. Then relax one control at a time, with an evaluation that shows the change didn't cost you accuracy. Loosening a policy you can measure is easy. Tightening one after an incident is a much harder conversation.
