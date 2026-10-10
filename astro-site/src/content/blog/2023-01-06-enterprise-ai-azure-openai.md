---
title: "Locking Down an Azure OpenAI Resource: Network, Identity, Keys, Logs"
description: "A security baseline for an Azure OpenAI preview resource in January 2023: private endpoints, Azure AD auth, customer-managed keys, logging and policy."
author: Michael John Peña
draft: false
date: 2023-01-06
tags:
  - Azure OpenAI
  - Security
  - Networking
  - Identity
  - Governance
---

The first question I expect in a security review of an Azure OpenAI pilot is some version of "is this just ChatGPT with an Azure logo?" It isn't, but "it's on Azure" doesn't make it secure either. An Azure OpenAI resource is a Cognitive Services account with a public endpoint and two API keys, and that's how it arrives. Whether it meets your organisation's bar depends on what you configure after the resource is created.

This post is the baseline I'd apply to an Azure OpenAI resource today, in the first week of January 2023, while the service is still a limited-access preview. For the wider picture of where the preview stands and what to sort out before GA, see [my New Year's Day post](/blog/2023-01-01-azure-openai-service-ga-announcement/).

## What you are actually securing

It helps to be precise about the moving parts, because "secure the AI" isn't something you can configure.

- **The resource.** A `Microsoft.CognitiveServices/accounts` resource of kind `OpenAI`, available in East US, South Central US and West Europe. It has an endpoint at `https://<your-resource-name>.openai.azure.com/` and two keys.
- **Deployments.** Models (GPT-3 and GPT-3.5 series completion models, such as `text-davinci-002` with `text-davinci-003` rolling out, plus Codex and embeddings) deployed under names you choose.
- **Data the service keeps.** Fine-tuning files and fine-tuned models are stored by the service. Prompts and completions aren't used to train models, but under Microsoft's [data, privacy and security terms for Azure OpenAI](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy) they can be retained for a limited period for abuse monitoring, with authorised Microsoft staff able to review flagged content.

That last point is the one that matters most to privacy teams and isn't something any network or identity control changes. Read the page with your privacy officer before you argue about private endpoints. If retention for abuse monitoring is a blocker for your data, no amount of VNet design fixes it. What can change it is a separate application: customers with approved low-risk use cases who meet additional Limited Access criteria can apply to modify abuse monitoring and human review, as described on the same [data, privacy and security page](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy). Check whether your use case qualifies before you rule the service out.

The rest of this post covers what you *can* control: who can reach the endpoint, who can call it, who holds the encryption keys, and what gets logged.

## Network: private endpoint and public access off

Azure OpenAI uses the same networking model as the rest of Cognitive Services: firewall rules, virtual network rules and private endpoints, documented in [Configure Azure Cognitive Services virtual networks](https://learn.microsoft.com/en-us/azure/ai-services/cognitive-services-virtual-networks). My default for anything beyond a sandbox is a private endpoint in a spoke VNet and public network access disabled.

```bash
#!/usr/bin/env bash
set -euo pipefail

RG="rg-openai-pilot"
ACCOUNT="<your-resource-name>"
VNET="<your-vnet-name>"
SUBNET="<your-private-endpoint-subnet>"

ACCOUNT_ID=$(az cognitiveservices account show \
  --name "$ACCOUNT" --resource-group "$RG" --query id -o tsv)

# Private endpoint for the account ("account" is the only sub-resource)
az network private-endpoint create \
  --name "pe-${ACCOUNT}" \
  --resource-group "$RG" \
  --vnet-name "$VNET" \
  --subnet "$SUBNET" \
  --private-connection-resource-id "$ACCOUNT_ID" \
  --group-id account \
  --connection-name "pec-${ACCOUNT}"

# Private DNS zone for the Azure OpenAI hostname, linked to the VNet
az network private-dns zone create \
  --resource-group "$RG" \
  --name privatelink.openai.azure.com

az network private-dns link vnet create \
  --resource-group "$RG" \
  --zone-name privatelink.openai.azure.com \
  --name "link-${VNET}" \
  --virtual-network "$VNET" \
  --registration-enabled false

# Zone group: the private endpoint writes its A record into the zone
az network private-endpoint dns-zone-group create \
  --resource-group "$RG" \
  --endpoint-name "pe-${ACCOUNT}" \
  --name default \
  --private-dns-zone privatelink.openai.azure.com \
  --zone-name openai
```

Two things catch people out here.

**DNS.** The private endpoint is useless if your clients still resolve the public IP. The Azure OpenAI hostname sits under `openai.azure.com`, not `cognitiveservices.azure.com`, so don't assume the Cognitive Services zone in the private DNS table covers it. The script creates `privatelink.openai.azure.com`, links it to one VNet and attaches it to the endpoint with a zone group, so the A record is managed for you. Link the zone to every other VNet your apps resolve from (or forward to it from your custom DNS), and then check from inside the network:

```bash
nslookup <your-resource-name>.openai.azure.com
```

You want a private IP from your subnet and a `privatelink` alias in the CNAME chain. If you see a public IP, fix DNS before you disable public access, not after. Once the lookup returns a private IP from every network your apps resolve from, turn off the public endpoint:

```bash
# Continues the script above: ACCOUNT_ID is set there
az resource update \
  --ids "$ACCOUNT_ID" \
  --set properties.publicNetworkAccess=Disabled
```

**Azure OpenAI Studio.** The Studio and its playground run in your browser and call the resource from there. With public access disabled, they only work from a machine that can reach the private endpoint. That's correct behaviour, but tell your prompt engineers before you flip the switch, or they'll assume the service is broken. My compromise for pilots: a separate, non-production resource with an IP allowlist for prompt experimentation using synthetic data, and the locked-down resource for anything touching real data.

When would I *not* bother with a private endpoint? For a sandbox resource with no real data and a short life, IP firewall rules are enough, and they're far cheaper to get right. The private endpoint earns its complexity once production data or production apps are involved.

## Identity: Azure AD, not keys

The two account keys grant full data-plane access, aren't tied to a person, and end up in config files, notebooks and screenshots. Azure OpenAI supports Azure Active Directory authentication, including [managed identities](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/managed-identity), and that should be the default for every application.

Microsoft's Azure OpenAI docs currently show the general **Cognitive Services User** role for data-plane access. That role is broad: it covers inference on any Cognitive Services account in the scope you assign it at, and it includes the `listkeys` action, so anyone holding it can read the account keys too. Microsoft has said it is adding Azure AD role support specific to Azure OpenAI, but those roles aren't in the [built-in roles reference](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles) yet, so check what your tenant actually has with `az role definition list --name "Cognitive Services OpenAI User"`. If that returns a role, use it. If it returns nothing, assign Cognitive Services User, scoped to the single Azure OpenAI resource rather than the resource group the docs suggest, and turn off local auth (below) so its `listkeys` permission stops mattering. Either way, never assign at resource group or subscription scope.

```bash
# Continues the script above: RG and ACCOUNT_ID are set there
APP_PRINCIPAL_ID=$(az webapp identity show \
  --name <your-app-name> --resource-group "$RG" --query principalId -o tsv)

# Prefer the Azure OpenAI-specific role; fall back to the general one
ROLE="Cognitive Services OpenAI User"
if [ -z "$(az role definition list --name "$ROLE" --query "[].roleName" -o tsv)" ]; then
  ROLE="Cognitive Services User"
fi

az role assignment create \
  --assignee-object-id "$APP_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "$ROLE" \
  --scope "$ACCOUNT_ID"
```

In Python, the `openai` library (0.25.0) accepts an Azure AD token when you set `api_type = "azure_ad"`. Tokens last about an hour, so a long-running service has to refresh them. This is a complete example:

```python
import os
import time

import openai
from azure.identity import ManagedIdentityCredential

# pip install "openai==0.25.0" "azure-identity==1.12.0"
SCOPE = "https://cognitiveservices.azure.com/.default"

credential = ManagedIdentityCredential()
_token = None


def ensure_token() -> None:
    """Refresh the Azure AD token when it's within five minutes of expiry."""
    global _token
    if _token is None or _token.expires_on - time.time() < 300:
        _token = credential.get_token(SCOPE)
        openai.api_key = _token.token


openai.api_type = "azure_ad"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]  # https://<your-resource-name>.openai.azure.com/
openai.api_version = "2022-12-01"


def complete(prompt: str) -> str:
    ensure_token()
    response = openai.Completion.create(
        engine=os.environ["AZURE_OPENAI_DEPLOYMENT"],  # your deployment name
        prompt=prompt,
        max_tokens=200,
        temperature=0.2,
    )
    return response["choices"][0]["text"].strip()


if __name__ == "__main__":
    print(complete("Summarise the purpose of a private endpoint in one sentence:"))
```

Once every caller uses Azure AD, disable key-based (local) authentication on the account so the keys stop working entirely. If you had to fall back to Cognitive Services User, this is the step that makes its key access harmless. Even with a narrower role, Owners and Contributors can still list keys, so do it regardless:

```bash
# Continues the script above: ACCOUNT_ID is set there
az resource update \
  --ids "$ACCOUNT_ID" \
  --set properties.disableLocalAuth=true
```

Test your tooling first. Anything that still reads a key from Key Vault or an app setting will fail with a 401 the moment this lands, which is exactly the point, but better found in test.

## Encryption: customer-managed keys, if you need them

Data the service stores (fine-tuning files and fine-tuned models) is encrypted at rest with Microsoft-managed keys by default. If policy requires you to hold the key, Azure OpenAI supports [customer-managed keys in Azure Key Vault](https://learn.microsoft.com/en-us/azure/ai-services/openai/encrypt-data-at-rest). Today you request access to CMK through a form, and the vault needs soft delete and purge protection enabled, an RSA 2048 key, and the same region and tenant as the resource.

The December 2022 [What's new](https://learn.microsoft.com/en-us/azure/ai-services/openai/whats-new) also added Customer Lockbox support, which means a Microsoft engineer who needs to access your customer data during a support case has to get your explicit approval first. That's worth switching on, but be clear about its limit: it governs support engineer access, not the human review of flagged content under abuse monitoring, which follows the data-handling terms described above.

My view: if you aren't fine-tuning, CMK protects very little, because prompts sent to a base model deployment aren't what it encrypts. Don't let it become the headline control in a risk register while abuse-monitoring retention goes undiscussed. If you are fine-tuning on sensitive data, CMK is worth the paperwork, and the ability to revoke the key is a real kill switch for stored training data.

## Logging: what you can see, and what you can't

Turn on diagnostic settings for the **Audit** and **RequestResponse** categories (plus AllMetrics) and send them to Log Analytics. The [Cognitive Services diagnostic logging guidance](https://learn.microsoft.com/en-us/azure/ai-services/diagnostic-logging) applies to Azure OpenAI as-is. Then you can answer who called what, when, and how it went:

```kusto
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.COGNITIVESERVICES"
| where Category == "RequestResponse"
| summarize Calls = count(), Failures = countif(toint(ResultSignature) >= 400),
            AvgMs = avg(DurationMs)
    by bin(TimeGenerated, 1h), OperationName, CallerIPAddress
| order by TimeGenerated desc
```

Be clear with auditors about what this doesn't give you: these are request logs, not a transcript of the prompts and completions. If your compliance requirement is "we must be able to show what the model was asked and what it said", that's application logging. Log it in your app, with the user identity, to a store you control and with retention you choose, and treat that store as sensitive as the source data.

## Guardrails that outlast the pilot

Configuration drifts. Someone recreates the resource in a hurry, or a second team spins up their own. Assign the [built-in Azure Policy definitions for Cognitive Services](https://learn.microsoft.com/en-us/azure/ai-services/policy-reference) at the management group that holds your AI subscriptions, covering disabled public network access, private link, disabled local authentication and, where you need it, customer-managed keys. Start in Audit mode to see what exists, then move the ones you're sure of to Deny. The public network access, local authentication and customer-managed key definitions support Deny; the private link definition is audit-only (AuditIfNotExists), so it reports gaps but won't block a deployment.

One honest gap: compliance certifications. Azure's broad compliance portfolio doesn't automatically cover a preview service. Microsoft listed [SOC 2 compliance for Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-services/openai/whats-new) in its December 2022 update; check the Azure compliance documentation and Service Trust Portal for anything else your risk assessment cites (ISO, IRAP and so on), by service name, before anyone writes "covered by our Azure certifications" into it.

## The baseline, in order

| Control | Default for production | When to skip |
|---|---|---|
| Data handling review | Always, first | Never |
| Azure AD auth, keys disabled | Always | Short-lived sandbox |
| Narrowest available role, scoped to the resource | Always | Never |
| Private endpoint, public access off | Real data or production apps | Sandbox with synthetic data |
| Customer-managed keys | Fine-tuning on sensitive data | No fine-tuning |
| Diagnostic logs to Log Analytics | Always | Never |
| App-level prompt logging | Where audit needs content | When storing prompts is itself the risk |
| Azure Policy at management group | Once a second resource exists | Single throwaway resource |

None of this is specific to large language models. It's the same baseline you'd put on any Cognitive Services account holding sensitive data, and that's the point I make to security teams: Azure OpenAI fits into controls you already understand. The genuinely new questions are about the data the service retains and the content it generates. I'll pick those up next, in posts on [Azure OpenAI versus OpenAI's own API](/blog/2023-01-07-azure-openai-vs-openai-api/) and [content filtering](/blog/2023-01-09-content-filtering-azure-openai/). Get the plumbing right this month so those conversations aren't stuck behind a debate about API keys.
