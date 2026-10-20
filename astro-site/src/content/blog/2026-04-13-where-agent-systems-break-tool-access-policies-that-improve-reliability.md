---
title: "Agent Tool Policy at the Gateway: MCP Through API Management"
description: "Tool rules inside agent code drift once several teams build agents. Put identity, rate limits and tracing for MCP tools in Azure API Management instead."
author: Michael John Peña
draft: false
date: 2026-04-13
tags:
  - AI Agents
  - MCP
  - API Management
  - Security
  - Architecture
---

Tool access policy written inside an agent works while you have one agent. By the third team building agents against the same finance or HR APIs, each copy has its own allow-list and its own credential, and its own idea of how often a tool may be called. Nobody can answer "which agents can reach the payments API, and how hard are they hitting it?" without reading every repository. That's where agent systems quietly break: the tool works, but nobody owns the rules around it.

In earlier posts I covered [four layers of tool control inside the agent](/blog/2026-03-11-building-useful-ai-agents-tool-access-policies-that-improve-reliability/) and [testing those policies in CI](/blog/2026-04-02-building-useful-ai-agents-tool-access-policies-that-improve-reliability/). This one moves part of the policy out of the agent and into the network path, using Azure API Management as the gateway in front of MCP servers.

## Which rules belong where

Not every control should move. My split is based on who needs to trust the rule.

| Control | Agent code | Gateway |
|---|---|---|
| Which tools this agent is shown | Yes, keep the list small | Also, by exposing only selected operations |
| Human approval before a write | Yes, the agent owns the conversation | No |
| Loop and call budgets per run | Yes | No |
| Who the caller is | No | Yes, validate the token |
| Calls per minute per agent | Weak | Yes |
| Audit trail across all agents | Weak | Yes |
| Backend credentials | Never | Yes |

The pattern is simple: rules about *one conversation* stay in the agent, and rules about *the organisation's systems* go in the gateway. Approval is a conversational concern because a person has to see the exact arguments in context. A rate limit is a system concern, because the backend doesn't care which framework, team or prompt produced the burst.

The strongest argument for the gateway is that it holds even when the agent is wrong. A prompt injection can change what the model decides to call, and a bug can remove an `allowed_tools` entry. Neither changes what a gateway accepts from that agent's identity.

## What API Management gives you for MCP

API Management can front MCP servers in two ways, described in the [MCP server overview](https://learn.microsoft.com/en-us/azure/api-management/mcp-server-overview):

- **REST API as MCP server.** You pick operations from an API already managed in API Management and they become MCP tools, served over Streamable HTTP at an `/mcp` endpoint. You can expose all operations or a chosen subset.
- **Existing MCP server.** You put API Management in front of an MCP server hosted elsewhere, such as Azure Functions, and govern the traffic to it.

Status first: as of April 2026 the Learn docs, including the guide to [exposing a REST API as an MCP server](https://learn.microsoft.com/en-us/azure/api-management/export-rest-mcp-server), describe both modes without a preview label. The REST-as-MCP capability first appeared as a preview at Build in May 2025. Features in the AI Gateway release channel are pre-GA, so check before you depend on one in front of production finance data.

The limits that shape the design, as documented:

- It's available in the Developer, Basic, Standard and Premium tiers and the Basic v2, Standard v2 and Premium v2 tiers. It isn't supported in workspaces.
- API Management serves MCP **tools** only, not MCP resources or prompts.
- Policies on an MCP server apply to **all** the tools in it. There's no per-tool policy at the MCP server scope.
- Don't read `context.Response.Body` in MCP server policies, and don't log response payloads at the All APIs scope. Both buffer the response and break the streaming that MCP relies on.

The third limit is the one that changes how you carve things up. The clean way to give reads and writes different rules is separate MCP servers. Branching on the tool name in the request body works (an inbound `<choose>` on the JSON-RPC `params.name`, read with `preserveContent: true`), but it turns your policy into a second tool registry that drifts from the server's real tool list.

## Carve servers by trust level, not by backend

The obvious move is one MCP server per backend API: a finance server, an HR server, a ticketing server. I'd avoid it. Because policies apply to every tool on a server, mixing `get-invoice` with `release-payment` forces one rate limit and one set of allowed callers onto both.

I carve by trust level instead:

- **finance-read**: lookups and searches. Most finance agents may call it, with a generous rate limit.
- **finance-write**: holds, releases and status changes. Only named agent identities, a tight rate limit, and the agent still requires human approval for every call on its side.

Each server is a separate endpoint, so revoking an agent's write access is a gateway change that doesn't need a redeploy of the agent. It also means the agent's `allowed_tools` list and the gateway's exposed operations are two independent checks on the same decision, which is the point.

## The gateway policy

This is the inbound policy for the `finance-read` MCP server. It validates a Microsoft Entra token, accepts only the agent identities you list, rate-limits per calling application and adds a trace record keyed on the signed client ID. Values in braces are placeholders.

```xml
<policies>
    <inbound>
        <base />
        <validate-azure-ad-token tenant-id="{your-tenant-id}" header-name="Authorization"
            failed-validation-httpcode="401"
            failed-validation-error-message="Unauthorized. Access token is missing or invalid."
            output-token-variable-name="agent-token">
            <client-application-ids>
                <application-id>{invoice-agent-client-id}</application-id>
                <application-id>{supplier-agent-client-id}</application-id>
            </client-application-ids>
            <audiences>
                <audience>api://{gateway-app-client-id}</audience>
                <audience>{gateway-app-client-id}</audience>
            </audiences>
        </validate-azure-ad-token>
        <set-variable name="client-app-id" value="@{
                var jwt = context.Variables.GetValueOrDefault<Jwt>("agent-token");
                return jwt.Claims.GetValueOrDefault("azp", jwt.Claims.GetValueOrDefault("appid", "unknown"));
            }" />
        <rate-limit-by-key calls="60" renewal-period="60"
            counter-key="@((string)context.Variables["client-app-id"])" />
        <trace source="finance-read-mcp" severity="information">
            <message>MCP tool traffic</message>
            <metadata name="client-app-id" value="@((string)context.Variables["client-app-id"])" />
            <metadata name="agent-label" value="@(context.Request.Headers.GetValueOrDefault("x-agent-name", "not-set"))" />
        </trace>
    </inbound>
    <backend>
        <base />
    </backend>
    <outbound>
        <base />
    </outbound>
    <on-error>
        <base />
    </on-error>
</policies>
```

The [`validate-azure-ad-token`](https://learn.microsoft.com/en-us/azure/api-management/validate-azure-ad-token-policy) policy does the real work. `client-application-ids` is your allow-list of agents: API Management checks the signed `azp`/`appid` claim Entra issued against this list, so a caller can't claim to be an agent it isn't. `output-token-variable-name` hands the validated token on, so both the rate-limit counter and the trace record use the application ID inside a signed token, not a header the caller could set. I read `azp` first and fall back to `appid` because v2 and v1 access tokens carry the client ID in different claims. For the same reason the policy lists two audiences: a v1 token carries `api://{gateway-app-client-id}` in `aud`, while a v2 token (gateway app registration set to `requestedAccessTokenVersion: 2`) carries the bare client ID. If you pin the gateway app to one token version, drop the other audience.

### Client IDs or app roles

Listing client IDs keeps the decision in the policy, so every new agent is a policy change. The alternative is app roles: define roles such as `Finance.Read` and `Finance.Write` on the gateway app registration, assign them to the agents' managed identities, and have the policy check the `roles` claim. Access then becomes an Entra assignment that shows up in Entra's audit log, not an edit to policy XML. Replace the `<client-application-ids>` block with this in the `finance-write` server's policy:

```xml
<required-claims>
    <claim name="roles" match="any">
        <value>Finance.Write</value>
    </claim>
</required-claims>
```

I'd use the client ID list while you have two or three agents and one team owns the gateway, because it's visible in one file. Once several teams request access, or for anything like `finance-write` where granting and revoking should go through the same approval process as any other privileged role, app roles are the better fit. Assigning an app role to a managed identity is done through Microsoft Graph or PowerShell rather than the portal, so script it.

### Rate limits and labels

Two things about the numbers. First, a rate limit on an MCP endpoint counts HTTP requests, not tool calls. Session initialisation and `tools/list` also go through the gateway, so leave headroom above the tool call rate you expect. Second, the `x-agent-name` header becomes a display label in the trace and nothing more. The caller controls it, so the audit trail rests on `client-app-id`, and no security decision should ever key on the label.

For the backend side, use API Management's credential manager or a managed identity to call the finance API. The [secure access guide](https://learn.microsoft.com/en-us/azure/api-management/secure-mcp-servers) covers both directions. The agent never holds the finance API's credentials, which removes a whole class of leak.

## The agent side

The agent connects to the gateway as a normal MCP server. Microsoft Agent Framework for Python [reached 1.0](https://pypi.org/project/agent-framework-core/1.0.0/) on 2 April, and `MCPStreamableHTTPTool` takes an `httpx.AsyncClient`, which is where the Entra token goes. A custom `httpx.Auth` attaches the token to every request, so a long-running agent doesn't fail an hour in when the first token expires. The auth class caches the token and refreshes it five minutes before expiry. `AzureCliCredential` doesn't cache on its own, though `ManagedIdentityCredential` does.

```python
# pip install agent-framework-core==1.0.1 agent-framework-openai==1.0.1 mcp==1.27.0 azure-identity==1.25.3 httpx==0.28.1
# Local testing: az login. See the note below on the Azure CLI client ID.
import asyncio
import time
from collections.abc import AsyncGenerator

import httpx
from agent_framework import Agent, MCPStreamableHTTPTool
from agent_framework.openai import OpenAIChatClient
from azure.core.credentials import AccessToken
from azure.core.credentials_async import AsyncTokenCredential
from azure.identity.aio import AzureCliCredential

GATEWAY_MCP_URL = "https://<your-apim-name>.azure-api.net/<your-mcp-server-name>/mcp"
GATEWAY_SCOPE = "api://<gateway-app-client-id>/.default"


class EntraBearerAuth(httpx.Auth):
    """Attach a cached Entra token to every request, refreshing it five minutes before expiry."""

    def __init__(self, credential: AsyncTokenCredential, scope: str) -> None:
        self._credential = credential
        self._scope = scope
        self._token: AccessToken | None = None
        self._lock = asyncio.Lock()

    async def _get_token(self) -> str:
        async with self._lock:
            if self._token is None or self._token.expires_on - time.time() < 300:
                self._token = await self._credential.get_token(self._scope)
            return self._token.token

    async def async_auth_flow(self, request: httpx.Request) -> AsyncGenerator[httpx.Request, httpx.Response]:
        request.headers["Authorization"] = f"Bearer {await self._get_token()}"
        yield request


async def main() -> None:
    async with AzureCliCredential() as credential, httpx.AsyncClient(
        auth=EntraBearerAuth(credential, GATEWAY_SCOPE),
        headers={"x-agent-name": "invoice-desk"},
        timeout=httpx.Timeout(30.0),
    ) as http_client:
        finance_tools = MCPStreamableHTTPTool(
            name="finance-gateway",
            url=GATEWAY_MCP_URL,
            http_client=http_client,
            load_prompts=False,  # API Management serves MCP tools, not prompts
            allowed_tools=["get-invoice", "list-supplier-invoices"],
            approval_mode="never_require",  # this server only exposes read operations
        )
        client = OpenAIChatClient(
            model="<your-deployment-name>",
            azure_endpoint="https://<your-resource-name>.openai.azure.com/",
            credential=credential,
            function_invocation_configuration={"max_iterations": 4, "max_function_calls": 6},
        )
        async with finance_tools:
            agent = Agent(
                client=client,
                name="InvoiceDesk",
                instructions="You answer accounts payable questions. Use the finance tools for every fact you state.",
                tools=finance_tools,
            )
            result = await agent.run("What is the status of invoice INV-10423?")
            print(result.text)


if __name__ == "__main__":
    asyncio.run(main())
```

Use the tool names exactly as they appear on the MCP server's **Tools** page in API Management. `load_prompts=False` matches the gateway's tools-only support. The iteration and call caps stay in the agent, because they're per-run rules that the gateway can't see. `AzureCliCredential` is a local-testing shortcut, and it has a catch: the token carries the Azure CLI's client ID (`04b07795-8ddb-461a-bbee-02f9e1bf7b46`) in `appid`/`azp`, not your agent's. For local testing, add the Azure CLI's client ID to `<client-application-ids>` and pre-authorise it on the gateway app registration, or sign in as the agent's own app registration with `ClientSecretCredential` or `CertificateCredential`. Expect every developer using the CLI to share one rate-limit counter. In production use the agent's managed identity (`ManagedIdentityCredential(client_id=...)`) and list its client ID, then remove the Azure CLI entry. Whichever identity you use also needs a role on the Azure OpenAI resource, such as Cognitive Services OpenAI User.

## Where this goes wrong

The gateway isn't free, and I wouldn't add it everywhere.

- **One team, one agent, one API.** If a single team owns the agent and the backend, the in-agent controls plus the backend's own authorisation are enough. A gateway adds a hop, a policy language to learn and another resource to run.
- **User-level authorisation.** The policy above proves *which agent* is calling. It doesn't prove *which user* the agent is acting for. If invoice visibility depends on the signed-in user, the backend still has to check the user's rights, through an on-behalf-of token or an equivalent, and that design deserves its own review.
- **Logging bodies to debug.** The first thing people do when a tool misbehaves is turn on payload logging at the All APIs scope, which is exactly the setting that breaks MCP streaming. Log at the API scope, and keep response payload bytes at zero for MCP servers.
- **Treating the gateway as the only check.** If the agent's tool list is wide open because "the gateway handles it", the model still sees every exposed tool and still picks wrongly more often. The gateway limits damage; it doesn't improve tool choice.

## The rule I'd adopt

Once a backend serves more than one agent, put the tool behind a gateway and give each agent its own Entra identity. Split MCP servers by trust level so read and write tools get different policies, keep approval and loop limits in the agent, and keep the backend's own authorisation regardless. If you can answer "which agents can call this, and how often did they?" from one place, the policy is owned. If the answer lives in five repositories, it isn't.
