---
title: "EDI and AS2 Trading Partners with Logic Apps Integration Accounts"
description: "How to land X12, EDIFACT and AS2 partner connections on Azure Logic Apps: choosing an integration account tier, agreements, tracking and when to avoid it."
author: Michael John Peña
draft: false
date: 2020-08-21
tags:
  - Azure
  - Logic Apps
  - Integration
  - B2B
---

Most Logic Apps content online is about Office 365 connectors and approval workflows, and that's fine. The enterprise use case I keep running into is B2B integration: EDI X12, EDIFACT and AS2, protocols that look dated but still run most supply chains. For a team that needs to land a new trading partner without standing up a BizTalk Server farm, Logic Apps with an integration account is the easiest route Azure offers in 2020, as long as you understand what the integration account is and what it costs.

## What the Enterprise Integration Pack actually is

The "Enterprise Integration Pack" is Microsoft's umbrella name for the B2B capabilities in Logic Apps. In practice it's two things:

- **An integration account**, a separate Azure resource that stores your B2B artifacts: trading partners, agreements, certificates, XSD schemas, XSLT and Liquid maps, assemblies and batch configurations.
- **A set of connectors and actions** that read from it: AS2 encode/decode, X12 encode/decode, EDIFACT encode/decode, XML validation, XML transform, flat file encode/decode, and the X12/EDIFACT batch actions. The built-in Batch trigger and Send to batch action work without an account, but B2B batching uses batch configurations stored in it.

The connectors are useless on their own. An X12 decode action needs an agreement to know which envelope settings, control-number rules and acknowledgements apply to a given sender, and that agreement lives in the integration account. You link the account to each logic app that uses it, and Microsoft's docs are explicit that [the logic app and integration account must be in the same Azure subscription and region](https://learn.microsoft.com/en-us/azure/logic-apps/enterprise-integration/create-integration-account). Pick the region once, deliberately. Moving an integration account later means exporting and re-importing every artifact.

## Choosing a tier

This is where most projects either overspend or underbuy. There are three tiers, and the artifact counts differ by orders of magnitude. The [integration account limits](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-limits-and-config#integration-account-limits) page has the current numbers; the shape of the decision looks like this:

| Tier | Intended for | SLA | The catch |
|---|---|---|---|
| Free | Exploration and proofs of concept | None | One per region per subscription, throttled throughput |
| Basic | Message handling, or a small business trading with one large partner | Yes | 2 EDI trading partners, 1 agreement, 2 certificates and 1 batch configuration |
| Standard | Real B2B hubs with many partners and complex relationships | Yes | Highest fixed hourly cost (see below) |

Basic's partner limit counts *your own organisation* as a partner, because an agreement is always between a host partner (you) and a guest partner. Two partners and one agreement means exactly one external relationship. If there's any chance of a second customer or supplier in the next year, budget for Standard from the start. You can upgrade Basic to Standard in place later, from the account's Overview page (Upgrade Pricing Tier) or with `az resource update --set sku.name=Standard`, so the real risk is the budget conversation, not a migration.

Free is genuinely useful but has no SLA. I'd never route production purchase orders through it, even for a "temporary" pilot. Temporary pilots have a habit of lasting three years.

The 2-certificate limit bites sooner than people expect. AS2 alone can need a signing and an encryption certificate on your side plus the partner's public certificates, so a single AS2 relationship can exhaust Basic before you've uploaded a schema. Private certificates also need their key stored in Azure Key Vault, with access granted to the Logic Apps service, before you can add them to the account.

On cost: integration accounts are billed per hour whether or not messages flow. At 2020 list prices in US regions, Basic works out to roughly US$300 a month and Standard to roughly US$1,000 a month. Prices vary by region and currency, so check the [Logic Apps pricing page](https://azure.microsoft.com/en-us/pricing/details/logic-apps/) for your own numbers.

If you're already running an Integration Service Environment for VNet isolation, check what's bundled before buying anything. A Premium ISE includes one Standard integration account in its price, and the Developer ISE includes a Free one.

## Creating the account

The portal works fine. For anything that will exist in more than one environment I script it. The Az PowerShell module has had integration account cmdlets in `Az.LogicApp` for a long time:

```powershell
# Requires the Az PowerShell module (Az.LogicApp) and Connect-AzAccount
New-AzResourceGroup -Name "rg-integration" -Location "australiaeast"

New-AzIntegrationAccount `
    -ResourceGroupName "rg-integration" `
    -Name "<your-integration-account>" `
    -Location "australiaeast" `
    -Sku "Standard"
```

After that, link it from each logic app under **Workflow settings**, or set `integrationAccount.id` in the logic app's ARM template so the link survives redeployment.

## Partners, identities and agreements

A trading partner is mostly a name plus one or more business identities. The identities matter because that's how the decode actions match an inbound message to an agreement: an X12 interchange carries sender and receiver IDs with qualifiers in the ISA segment, and AS2 carries AS2-From and AS2-To headers. Each partner needs every identity it will appear under.

This ARM resource defines a partner with an AS2 identity and an X12 mutually-defined (`ZZ`) identity:

```json
{
  "type": "Microsoft.Logic/integrationAccounts/partners",
  "apiVersion": "2019-05-01",
  "name": "<your-integration-account>/ContosoCorp",
  "properties": {
    "partnerType": "B2B",
    "content": {
      "b2b": {
        "businessIdentities": [
          { "qualifier": "AS2Identity", "value": "CONTOSO" },
          { "qualifier": "ZZ", "value": "<contoso-isa-id>" }
        ]
      }
    }
  }
}
```

Agreements are where the real configuration lives, and I don't recommend hand-writing them in JSON. An X12 or AS2 agreement has separate receive and send settings, each with dozens of properties covering envelopes, control numbers, validation, acknowledgements, signing and encryption. Build the first one in the portal, export the template, then parameterise it. Hand-authored agreement JSON is the fastest way to discover which properties are required by having deployments fail.

The settings that cause the most partner-onboarding pain, in my experience:

- **Acknowledgements.** Decide with the partner whether they expect a TA1, a 997, or both. The [X12 decode action](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-enterprise-integration-x12) generates technical and functional acknowledgements when the agreement is configured to, but your workflow still has to send them back.
- **Control number checks.** If you enable the duplicate interchange control number check (ISA13), and you should in production, it gets painful during testing when the partner resends the same file twenty times. Turn it off in test agreements or vary the control numbers.
- **MDNs on AS2.** Synchronous MDNs come back on the same HTTP response, which suits small messages. Asynchronous MDNs need the partner to expose an endpoint, which adds a firewall conversation to your project plan.
- **Certificates.** Signing and encryption certificates expire. Put the expiry dates in a calendar the day you upload them; nobody remembers in 24 months.

## The shape of an inbound workflow

A typical inbound flow for an X12 850 purchase order over AS2 looks like this:

1. A Request trigger receives the AS2 POST from the partner.
2. **AS2 Decode** verifies the signature, decrypts and decompresses, checks for duplicate message IDs and produces the MDN. Pass it the request headers as well as the body, because the AS2 metadata lives in the headers.
3. A Response action returns the synchronous MDN to the partner.
4. **X12 Decode** validates the interchange against the agreement and schema, then splits it into transaction sets that passed and failed validation.
5. Good transaction sets go on to your line-of-business system, usually via a queue rather than directly into the ERP, so a slow downstream system can't back up the partner endpoint.
6. Failed transaction sets and the generated 997 go to their own branches.

I'd keep each of these as a separate concern, often in separate logic apps joined by Service Bus. The partner-facing piece should do as little as possible and return quickly. The business mapping can then retry, be redeployed and fail without the partner ever noticing.

When the payload is XML rather than EDI, for example a partner sending purchase orders as XML over AS2, the two native actions you'll use most are XML validation and XSLT transform. Both reference artifacts by name from the linked integration account. This fragment goes in a workflow definition's `actions` block and assumes an earlier action named `AS2_Decode`, so both actions read the decoded XML rather than the raw signed and encrypted MIME payload from the trigger. Rename `AS2_Decode` to whatever your AS2 decode action is called (the designer default is `Decode_AS2_message`), or the `runAfter` and `body()` references will fail:

```json
{
  "Validate_PO": {
    "type": "XmlValidation",
    "inputs": {
      "content": "@base64ToString(body('AS2_Decode')?['AS2Message']?['Content'])",
      "integrationAccount": {
        "schema": { "name": "PurchaseOrder" }
      }
    },
    "runAfter": { "AS2_Decode": ["Succeeded"] }
  },
  "Transform_PO": {
    "type": "Xslt",
    "inputs": {
      "content": "@base64ToString(body('AS2_Decode')?['AS2Message']?['Content'])",
      "integrationAccount": {
        "map": { "name": "PO-to-Internal-Format" }
      }
    },
    "runAfter": { "Validate_PO": ["Succeeded"] }
  }
}
```

Validate before you transform. An XSLT map will happily produce output from a document that is well-formed but schema-invalid, and you'll find out three systems downstream.

## Tracking is not optional

B2B is the one area where "it ran successfully" isn't enough. Partners will ask whether you received interchange 000012345 on Tuesday, and whether you sent the 997. Logic Apps can answer that, but only if you set it up before the question arrives.

Enable a diagnostic setting on the integration account that sends the `IntegrationAccountTrackingEvents` category to a Log Analytics workspace, then add the **Logic Apps B2B** solution to that workspace. Microsoft's guide to [monitoring B2B messages with Azure Monitor logs](https://learn.microsoft.com/en-us/azure/logic-apps/monitor-b2b-messages-log-analytics) covers the steps. You get message counts and status per protocol, acknowledgement status, correlation between messages and their acknowledgements, and error details, searchable by control number. That last part is what your support team will actually use.

## When I wouldn't use this

Integration accounts aren't cheap. Standard's fixed monthly cost lands before you process a single message, so calculate carefully before you commit. Some situations where I'd stop and reconsider:

- **One or two partners and simple flat files over SFTP.** If no AS2 or EDI envelope processing is involved, plain Logic Apps with the SFTP connector and an Azure Functions transform may be all you need. Liquid maps and Inline Code still need an integration account, but a Basic tier covers that (Free has no SLA, so keep it out of production).
- **Existing BizTalk investment with hundreds of maps.** BizTalk Server 2020 shipped in January 2020 and is supported for years yet. A hybrid design, with BizTalk handling the heavy EDI and Logic Apps on the cloud edge, is often more sensible than a big-bang migration.
- **Very large interchanges.** The B2B actions have per-message size limits (X12 and EDIFACT decode/encode are capped at 50 MB in multi-tenant Logic Apps). If partners send bigger batches, you'll need to split upstream or look at a different tool.
- **A managed EDI VAN is already in place.** If a VAN provider already handles translation and partner onboarding, adding an integration account duplicates what you're paying for.

## The decision in short

If you have more than one external trading partner and need AS2 or real EDI envelope handling, a Standard integration account plus Logic Apps is a solid, supportable choice, and far less infrastructure than a BizTalk farm. Pick the region deliberately, build agreements in the portal and export them, keep the partner-facing workflow thin, and switch on B2B tracking on day one. I cover the wider Enterprise Integration Pack, including maps and schemas, in [Logic Apps enterprise integration](/blog/2020-09-08-azure-logic-apps-enterprise-integration/). If you only have one partner today, be honest about whether that will still be true next year before you settle on Basic.
