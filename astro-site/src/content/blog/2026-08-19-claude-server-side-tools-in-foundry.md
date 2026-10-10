---
title: "Claude's Server-Side Tools in Foundry: What to Let the Provider Run"
description: "Claude hosted on Azure in Foundry now runs web fetch, web search, tool search and an MCP connector for you. Decide which belong behind your own gateway."
author: Michael John Peña
draft: false
date: 2026-08-19
tags:
  - Microsoft Foundry
  - Anthropic
  - Claude
  - AI Agents
  - MCP
  - Security
---

On 17 August 2026 Microsoft [announced five Claude capabilities for deployments hosted on Azure](https://devblogs.microsoft.com/foundry/five-new-claude-capabilities-now-available-in-foundry/) in Microsoft Foundry: structured outputs, web search, web fetch, tool search and the MCP connector. Until then these were only available on "Hosted on Anthropic" deployments, so teams that needed prompts and completions to stay inside Azure had to build the plumbing themselves. With that gap closed, the new question is which of these tools you should actually let the provider run, because a server-side tool makes its network calls from the model service, not from your virtual network, and your firewall never sees them.

My position: structured outputs everywhere, tool search when your tool catalogue outgrows the context window, and web fetch and remote MCP behind your own gateway whenever data classification or audit requirements say so. The rest of this post is the reasoning.

## What "hosted on Azure" does and doesn't cover

Microsoft's [Claude hosting comparison on Learn](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models-hosting-comparison) describes two options. In both, Anthropic operates the models. Hosted on Azure runs on Azure infrastructure and is offered as Global Standard or US Data Zone Standard. Hosted on Anthropic runs on Anthropic's infrastructure and only offers Global Standard. Anthropic's own Claude in Microsoft Foundry page puts the Azure-hosted data position plainly: "prompts and completions remain within Azure. Only usage metadata and content flagged by Anthropic's safety systems egress to Anthropic."

That statement is about the inference path. It says nothing about where a web fetch goes, because a web fetch has to go to the public internet. Once you enable a server tool, the model service makes an outbound call on your behalf, gets content back, and puts it into the conversation before your application sees anything. You can configure the tool, but you can't put a proxy, a DLP inspection point or an NSG flow log between the model and the destination.

Anthropic's Foundry page also lists what Azure-hosted deployments still don't support: code execution, Agent Skills, programmatic tool calling, the Files API, and web search and web fetch versions later than `web_search_20250305` and `web_fetch_20250910`. So on Azure you get the basic versions only, without dynamic filtering. Requests that use the unsupported features return a `400` by design.

## The five tools, sorted by what leaves your boundary

| Capability | Who executes it | New outbound traffic | My default |
|---|---|---|---|
| Structured outputs | Constrained decoding inside the model service | None | Use everywhere |
| Tool search | Model service searches definitions you already sent | None | Use when the catalogue is large |
| Web search | Model service queries a search provider | Search queries | Use for public-information agents only |
| Web fetch | Model service fetches URLs | Full HTTP GET to arbitrary hosts | Gateway it for classified data |
| MCP connector (beta) | Model service calls your MCP server | Tool arguments and results to a public endpoint | Gateway it, or keep MCP client-side |

Two of these tools change the shape of the output or the context window and send nothing anywhere new. The other three are egress, and you should treat them like any other egress decision.

## Structured outputs: no reason not to

Structured outputs constrain decoding to a JSON Schema you supply, either as a response format through `output_config.format` or as `strict: true` on a tool definition. Anthropic's structured outputs docs now list Foundry alongside the Claude API (it was in public beta on Foundry when it went GA on the Claude API in January). Nothing new leaves your boundary, and it removes a whole class of parse-retry code.

Know the schema limits before you lean on it. Numeric constraints (`minimum`, `maximum`), string length constraints and recursive schemas aren't supported, and `additionalProperties` must be `false`. Constrained decoding guarantees the shape. It doesn't guarantee a value is in range, so keep your validation for business rules. The Python SDK's `parse()` helper moves unsupported Pydantic constraints into descriptions and validates them on the response, so a range check fails in your code rather than silently passing. What constrained decoding does enforce well is a closed set of values, which is why the example below uses `Literal` types: the model can't invent a fifth severity. Also, the docs note the schema is cached for up to 24 hours after last use. Don't put anything sensitive in field descriptions.

Here is a minimal Python example against an Azure-hosted deployment using Entra ID, with a Pydantic model as the schema:

```python
from anthropic import AnthropicFoundry
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from typing import Literal

from pydantic import BaseModel


class TicketTriage(BaseModel):
    category: Literal["data-pipeline", "access", "reporting", "other"]
    severity: Literal["low", "medium", "high", "critical"]
    needs_human: bool
    summary: str


token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://ai.azure.com/.default"
)

client = AnthropicFoundry(
    resource="<your-foundry-resource-name>",
    azure_ad_token_provider=token_provider,
)

response = client.messages.parse(
    model="<your-claude-deployment-name>",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": "Triage this ticket: the nightly export to the data lake failed twice and finance reports are stale.",
        }
    ],
    output_format=TicketTriage,
)

triage = response.parsed_output
print(triage.category, triage.severity, triage.needs_human)
```

The SDK converts `output_format` into `output_config.format` on the request. The `model` value is your deployment name, not necessarily the model ID.

## Tool search: a context problem, not a security one

Tool search lets you send every tool definition with `defer_loading: true` and have Claude search them (regex or BM25 variants, both `_20251119`) instead of loading all of them into context. Anthropic's docs give the reasons: a multi-server setup can spend around 55k tokens on definitions before doing any work, and tool selection accuracy degrades past roughly 30 to 50 tools.

From a security view, tool search is boring, which is good. You still send every definition on every request, the search runs over what you sent, and the tools Claude finds are still your client-side tools that your code executes. No new egress.

The question is whether you need it. Anthropic suggests it at 10 or more tools or more than 10k tokens of definitions. I'd set the bar higher. With a dozen well-named tools, I'd rather fix the descriptions than add a search step that can miss. Tool search earns its place when you're aggregating several MCP servers or a catalogue that grows without anyone curating it, which is exactly when you're tempted to switch on the MCP connector too. Keep your three to five most-used tools non-deferred, as the docs advise, and log which tools get discovered so you can see what the model is actually choosing from.

## Web search and web fetch: decide by data class

The [web fetch docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) are direct about the risk: "Enabling the web fetch tool in environments where Claude processes untrusted input alongside sensitive data poses data exfiltration risks." The mitigations are real. Claude can only fetch URLs that already appeared in the conversation (user messages, client tool results, earlier search or fetch results), not URLs it made up. Anthropic still calls out "residual risk".

Think about the attack path. A user asks your agent to summarise a supplier's page. That page contains injected instructions and a list of URLs. Those URLs are now in context and fetchable. If the same conversation also holds a customer record, you are relying on the model to refuse to put that record into a query string. I don't want an audit finding to depend on that.

The `web_fetch_20250910` tool gives you `allowed_domains` (or `blocked_domains`, not both), `max_uses` and `max_content_tokens`. An allowlist changes the risk a lot:

```python
from anthropic import AnthropicFoundry
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://ai.azure.com/.default"
)
client = AnthropicFoundry(
    resource="<your-foundry-resource-name>",
    azure_ad_token_provider=token_provider,
)

response = client.messages.create(
    model="<your-claude-deployment-name>",
    max_tokens=2048,
    messages=[
        {
            "role": "user",
            "content": "Summarise the retention guidance at https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-retention-configure",
        }
    ],
    tools=[
        {
            "type": "web_fetch_20250910",
            "name": "web_fetch",
            "allowed_domains": ["learn.microsoft.com"],
            "max_uses": 3,
            "max_content_tokens": 20000,
            "citations": {"enabled": True},
        }
    ],
)

for block in response.content:
    if block.type == "server_tool_use":
        print("fetch requested:", block.input)
    elif block.type == "web_fetch_tool_result":
        content = block.content
        # A successful fetch carries the URL; a failure carries an error code
        # such as url_not_allowed or max_uses_exceeded.
        print("result:", getattr(content, "url", None) or getattr(content, "error_code", None))
    elif block.type == "text":
        print(block.text)
```

Note the loop at the end. Server tool calls come back as `server_tool_use` and `web_fetch_tool_result` blocks, so you can log every URL. But you're logging after the fetch has already happened. That is the core difference from a client-side tool, where your code sees the request first and can say no.

Web search gets the same treatment. `web_search_20250305` takes `allowed_domains` or `blocked_domains`, `max_uses` and an approximate `user_location`, and failures come back as error codes inside the result block, not as HTTP errors. The difference is what leaves: the API runs the search for you, so the query text Claude writes goes to a search backend, and the "prompts and completions remain within Azure" statement is about inference, not about where that query is sent. Treat a search query as egress that can carry fragments of the conversation.

My rule: if the agent only ever handles public or internal-general data, provider-run web search and fetch with a domain allowlist is fine and saves you a scraper. If the conversation can contain anything classified above that, or your audit standard needs every outbound request recorded at the network layer, define your own `fetch_url` tool, run it through your egress firewall or proxy, and let Claude call that instead. If your `fetch_url` tool returns the page as a `document` or `search_result` block with citations enabled, you keep citations and gain a choke point.

## MCP connector: the server has to be public

The [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) is in beta on Foundry (header `mcp-client-2025-11-20`) and is the one I'd be most careful with. Two limitations from the docs decide most designs:

- "The server must be publicly exposed through HTTP." The model service calls it, so a server reachable only through a private endpoint won't work.
- Only tool calls are supported from the MCP spec, and the feature isn't eligible for zero data retention.

So turning it on means publishing your MCP server to the internet, handing a bearer token to the request in `authorization_token`, and letting tool arguments and results move between the provider and that endpoint without passing through your application. For a SaaS vendor's hosted MCP server talking about non-sensitive data, that's reasonable. For an MCP server in front of your ERP, it's a new public attack surface that exists only to save you writing an MCP client.

If you do use it, allowlist tools rather than enabling the whole server. Set `default_config.enabled` to `false` and switch on only the read tools you need through `configs`. The docs recommend denylisting write or destructive tools for read-only assistants. Then put the public endpoint behind something you control. Azure API Management can [expose and govern an existing MCP server](https://learn.microsoft.com/en-us/azure/api-management/mcp-server-overview), which gives you authentication, rate limits and request logging at a layer your security team already reviews.

The alternative is to keep MCP client-side. Agent Framework, or the hosted agents I [compared with self-hosting last week](/blog/2026-08-12-foundry-hosted-agents-ga-when-to-stop-self-hosting/), can act as the MCP client inside your network. Claude sees ordinary tool definitions, your code calls the MCP server over a private path, and you can still use tool search over those definitions. That is more code, but the MCP server stays private and every call passes through your process.

## Where this fits with the rest of your controls

None of this replaces the governance you already need at the model layer. If you route Claude through Model Router, the [residency and safety questions I covered earlier this month](/blog/2026-08-05-model-router-cross-provider-agent-routing/) still apply, and a server tool adds a second data path on top of the inference path. When you review an agent design, write down every place data can leave: inference, each server tool and each client tool. Server tools are the ones people forget, because they appear as a single line in the `tools` array.

## The decision

Turn on structured outputs for every Claude deployment. It costs nothing in egress and removes failure modes. Turn on tool search when definitions start costing real context or you're combining several MCP servers, not before. Use provider-run web search and web fetch only for agents whose conversations contain nothing you'd mind leaving through a URL, and always with `allowed_domains` and `max_uses`. For web fetch and remote MCP on anything classified or audited, keep the call in your own code behind your own gateway. The provider running a tool is convenient, but you can't inspect or block a request it makes on your behalf.
