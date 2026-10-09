---
title: "AI Security Basics: Keys, Quotas and Logs Before Prompt Tricks"
description: "The AI security failures that actually cost money are leaked keys, unbounded token spend and sensitive data in logs. Fix those before prompt defences."
author: Michael John Peña
draft: false
date: 2026-01-28
tags:
  - Security
  - Azure OpenAI
  - LLM
  - Governance
---

Most AI security conversations start with prompt injection, because it's novel and it demos well. In my experience, the incidents that reach the invoice or the breach register don't start there. They start with an API key in a Git history, a chatbot endpoint with no per-user limit that someone scripts against overnight, or a log table full of customer data that nobody meant to keep. These are ordinary application security failures, and they're the ones that turn up on the invoice and in the breach notification.

This post is about that boring layer: identity, consumption limits, data handling and logging. If you want a full pre-production list, I wrote [Securing AI Applications: A Comprehensive 2025 Checklist](/blog/2025-12-10-december-ai-topic/). For the injection side specifically, see [Prompt Injection Defense: Securing LLM Applications](/blog/2025-09-28-september-ai-topic/). Here I want to argue for an order of operations.

## Rank the threats by likelihood and blast radius

The [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) puts prompt injection at number one, and for agentic systems that's fair. But the same list includes Sensitive Information Disclosure (LLM02), Excessive Agency (LLM06) and Unbounded Consumption (LLM10), and for a typical internal chat assistant or RAG app those three are far more likely to hurt you first.

| Threat | How it usually happens | Typical impact |
|---|---|---|
| Leaked credentials | Key committed to a repo, pasted into a notebook, stored in app settings | Someone else spends your quota, or reads your deployments |
| Unbounded consumption | No per-caller token limit; a bug or a script loops on the endpoint | A bill that arrives before anyone notices |
| Sensitive data exposure | Users paste customer or HR data; you log every prompt verbatim | Your logs become the most sensitive store in the estate |
| Prompt injection | Untrusted text (user input or retrieved documents) overrides instructions | Ranges from embarrassing output to real actions, depending on what the model can do |

That last row is the key point. Prompt injection's impact scales with what the model can reach. A chatbot with no tools, no private data and a human reading the output has a small blast radius. An agent that reads email and can send it, or that can call internal APIs, has a large one. So I don't treat injection as "rare, ignore it". I treat it as a risk you size by the agency you've granted, after the fundamentals are in place.

## Get rid of keys, not just hide them

The original advice everyone gives is "don't hardcode keys, use environment variables". That's the floor, not the goal. An environment variable is still a long-lived shared secret that works from anywhere, and it ends up in CI logs, `.env` files and screenshots. The goal is to have no key that works at all.

Azure OpenAI supports Microsoft Entra ID authentication: grant the calling identity the **Cognitive Services OpenAI User** role on the resource and request tokens instead of sending a key, as described in the [managed identity guide](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/managed-identity). In production that identity is a managed identity on your App Service, Container App or Function; on a developer machine, `DefaultAzureCredential` picks up your Azure CLI login.

```bash
az role assignment create \
  --assignee-object-id <your-managed-identity-principal-id> \
  --assignee-principal-type ServicePrincipal \
  --role "Cognitive Services OpenAI User" \
  --scope /subscriptions/<subscription-id>/resourceGroups/<your-resource-group>/providers/Microsoft.CognitiveServices/accounts/<your-resource-name>
```

Passing the object ID with an explicit principal type skips a Microsoft Graph lookup, which can fail or lag for a managed identity created moments earlier. Role assignments can also take up to five minutes to apply, so a 401 straight after this command isn't necessarily a mistake.

With the v1 API endpoint, the standard `OpenAI` client accepts a token provider as its `api_key`, and refreshes the token for you. Callable `api_key` support landed in `openai` 1.106.0 in September 2025, so any 2.x release works.

```python
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import OpenAI

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)

client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=token_provider,
)

response = client.chat.completions.create(
    model="<your-deployment-name>",
    messages=[{"role": "user", "content": "Reply with one word: ready?"}],
)
print(response.choices[0].message.content)
```

Then close the door behind you. Switching your code to Entra ID doesn't revoke the keys; they still work until you [disable local authentication](https://learn.microsoft.com/en-us/azure/ai-services/disable-local-auth) on the resource:

```bash
az resource update \
  --resource-group <your-resource-group> \
  --name <your-resource-name> \
  --resource-type "Microsoft.CognitiveServices/accounts" \
  --set properties.disableLocalAuth=true
```

There's a built-in Azure Policy, "Azure AI Services resources should have key access disabled (disable local authentication)", that you can assign at subscription or management group scope so new resources can't quietly come back with keys enabled. Propagation usually takes minutes but can take hours, so confirm by calling the endpoint with the old key and checking for a 401 before you treat keys as dead.

Identity is half of access; the network is the other half. Once callers use Entra ID, also set `publicNetworkAccess` to `Disabled` and reach the resource through a private endpoint, or at least restrict its network ACLs to known networks, so a stolen token isn't usable from anywhere.

When not to do this on day one: if a third-party tool you depend on only accepts a key, you'll need to keep keys on that one resource. In that case, put the key in Key Vault, rotate it on a schedule, and keep that resource separate from the one your production app uses. GitHub push protection, which GitHub turned on by default for pushes to public repositories from late February 2024, catches many committed secrets, but it isn't a reason to have them.

## Put a ceiling on consumption at the gateway

Unbounded consumption is the threat I'd bet on most often, because it doesn't need an attacker. A retry loop with no backoff, a batch job pointed at the interactive deployment, or one enthusiastic user with a script will do. Deployment-level tokens-per-minute quotas protect Azure's capacity, not your budget, and they apply to everyone sharing the deployment.

Azure Cost Management budgets don't help as much as people expect either. A budget sends alerts when thresholds are crossed; it doesn't stop resources or consumption. Use budgets for visibility and the gateway for enforcement.

If your traffic already goes through Azure API Management, the [`llm-token-limit` policy](https://learn.microsoft.com/en-us/azure/api-management/llm-token-limit-policy) gives you a per-caller rate limit, a per-caller quota over a period, or both:

```xml
<policies>
    <inbound>
        <base />
        <llm-token-limit
            counter-key="@(context.Subscription.Id)"
            tokens-per-minute="5000"
            token-quota="2000000"
            token-quota-period="Monthly"
            estimate-prompt-tokens="true"
            remaining-quota-tokens-header-name="x-remaining-quota-tokens" />
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

Three details matter in practice. First, choose the counter key deliberately: subscription ID gives you a limit per consuming app, while a per-user limit needs a user identifier you trust, such as a claim from a validated token, not a header the client can set. Second, `estimate-prompt-tokens="true"` lets the gateway reject an oversized request before it reaches the model, at some performance cost; with it off, the over-limit request goes through and later ones are blocked. Third, counters are tracked per gateway, so a multi-region API Management deployment doesn't share one global count.

The numbers above are placeholders. Set them from what a legitimate heavy user actually consumes, with headroom, and alert on callers that approach the quota. I covered the gateway design itself in [Enterprise AI: Building Secure API Gateways for LLM Access](/blog/2025-09-19-september-ai-topic/).

## Treat your logs as the most sensitive store you own

"Log everything" is good observability advice and poor data protection advice when the payload is free text from users. People paste contracts, payslips and customer records into chat boxes. If you log every prompt and completion verbatim, you've created a searchable copy of all of it, usually with broader access and longer retention than the source systems.

My default is to log the shape of each interaction, not its content: who called, which feature, which deployment, token counts, latency, finish reason and a keyed hash of the prompt so repeated inputs can be correlated without storing them. A plain SHA-256 isn't enough: short, common prompts like "What is our leave policy?" can be recovered by hashing a dictionary of likely inputs. An HMAC with a secret key held in Key Vault means only someone with that key can test guesses.

```python
import hashlib
import hmac
import json
import os
import logging
import time
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai.audit")

# Load this from Key Vault (for example via an App Service Key Vault reference).
# Never hardcode it, and rotate it like any other secret.
PROMPT_HASH_KEY = os.environ["PROMPT_HASH_KEY"].encode("utf-8")


def log_interaction(
    user_id: str,
    feature: str,
    deployment: str,
    prompt: str,
    completion: str,
    prompt_tokens: int,
    completion_tokens: int,
    finish_reason: str,
    started: float,
) -> None:
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "user_id": user_id,
        "feature": feature,
        "deployment": deployment,
        "prompt_hmac_sha256": hmac.new(
            PROMPT_HASH_KEY, prompt.encode("utf-8"), hashlib.sha256
        ).hexdigest(),
        "prompt_chars": len(prompt),
        "completion_chars": len(completion),
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "finish_reason": finish_reason,
        "latency_ms": round((time.monotonic() - started) * 1000),
    }
    logger.info(json.dumps(record))


if __name__ == "__main__":
    start = time.monotonic()
    log_interaction(
        user_id="<user-object-id>",
        feature="policy-qa",
        deployment="<your-deployment-name>",
        prompt="What is our leave policy?",
        completion="Employees accrue four weeks of annual leave per year.",
        prompt_tokens=12,
        completion_tokens=14,
        finish_reason="stop",
        started=start,
    )
```

When you genuinely need content, for evaluation or incident investigation, capture a sample into a separate store with tighter access and a short retention period, and redact it first. A `finish_reason` of `content_filter` is worth alerting on; it tells you something unusual is being sent or generated without you storing the text. The metrics side of this is in [LLM Observability: The Few Signals That Actually Matter](/blog/2026-01-16-llm-observability/).

## Then size your injection defences to the agency you've granted

Once identity, limits and logging are sorted, prompt injection deserves real attention, but not in the form most checklists suggest. Filtering user input for "bad" strings doesn't stop injection. Attacks are paraphrased, encoded, or arrive inside a retrieved document the user never typed. Length limits and rate limits are worth having for cost reasons; they aren't an injection defence.

What does help:

- **A classifier, not a blocklist.** Azure AI Content Safety [Prompt Shields](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/jailbreak-detection) detects user prompt attacks and indirect attacks embedded in documents. In Azure OpenAI it's part of the content filter configuration, so check which shields are switched on for your deployment rather than assuming.
- **Least privilege for tools.** An agent's tools should run with the caller's permissions or narrower, never a shared service principal with broad access. This is the Excessive Agency problem, and it's an authorisation design question, not a prompt question.
- **A human in the loop for irreversible actions.** Sending, deleting, paying and granting access should need confirmation. A model that can only draft can't be talked into doing much damage.
- **Treat output as untrusted input.** Don't render model output as HTML or pass it to a shell or SQL engine without the same validation you'd apply to user input.

For a chat assistant over public documentation, Prompt Shields plus output encoding is probably enough. For an agent with write access to business systems, the tool permissions and confirmation steps are the security boundary, and the prompt is not.

## The order I'd fix things in

If I inherited an AI application tomorrow, I'd work through it in this order: disable key authentication and move every caller to Entra ID; put per-caller token limits at the gateway and budget alerts on the subscription; stop logging raw prompts by default; then review every tool the model can call and remove anything it doesn't need. Only then would I spend time tuning injection classifiers.

None of that is novel, which is exactly why it gets skipped. The exotic attacks make better conference talks, but the leaked key and the runaway loop are what the incident review will be about.
