---
title: "Azure Logic Apps Preview: What the Redesigned Runtime Changes"
description: "The new Logic App (Preview) resource runs workflows on the Azure Functions runtime: what changes, what's missing, and how I'd pilot it before GA."
author: Michael John Peña
draft: false
date: 2021-01-10
tags:
  - Azure
  - Logic Apps
  - Integration
  - Serverless
  - Azure Functions
---

Multi-tenant Logic Apps is excellent for wiring two SaaS apps together in an afternoon, and awkward once an integration estate grows. Every workflow is its own resource, you can't run anything on a laptop, private network access means paying for an integration service environment (ISE), and per-action billing gets hard to forecast at volume. Azure Logic Apps Preview, with its new **Logic App (Preview)** resource type, is Microsoft's answer to all four, and the December refresh (a new designer canvas, Inline Code Operations and a built-in SQL Server connector) made it complete enough to evaluate seriously, even though it's still a public preview with no SLA.

So the question for January 2021 isn't "should I move production?" but "what should I learn now so I'm ready when it goes GA?" I wrote about Logic Apps integration patterns, and my first take on the preview, in [Azure Logic Apps: Enterprise Integration Patterns](/blog/2020-11-28-azure-logic-apps-standard/). This post goes deeper on the preview runtime: what is architecturally different, where it is genuinely better, and what is still missing.

## What actually changed

Microsoft's preview overview, which now lives on as the [Differences between Standard and Consumption logic apps](https://learn.microsoft.com/azure/logic-apps/single-tenant-overview-compare) page, describes the redesigned runtime as an extension hosted on the Azure Functions runtime, so the new logic app type can run wherever Azure Functions runs. That has several consequences.

- **One app, many workflows.** A Logic App (Preview) resource holds multiple workflows that share compute, storage and networking. That is a different unit of deployment from the classic model, where every workflow is a separate ARM resource.
- **Your project is files on disk.** Each workflow is a folder with a `workflow.json`, the app has a `host.json` and `connections.json`, and the whole thing is packaged like a function app. You copy the artefacts to a host and start it.
- **You pick the hosting.** In Azure the resource runs on a Functions Premium plan or an App Service plan. You can also build a Docker container and run it wherever you run containers.
- **Local development is real.** The Azure Logic Apps (Preview) extension for VS Code runs workflows locally on top of Azure Functions Core Tools, with breakpoints in `workflow.json` (actions only, not triggers, for now).

Here is how the three environments compare today:

| | Multi-tenant Logic Apps | Logic Apps Preview | Integration service environment |
|---|---|---|---|
| Who shares compute | Workflows from many customers | Workflows in the same logic app | Workflows in the same ISE |
| Unit of deployment | One workflow per resource | Many workflows per app | One workflow per resource |
| Local run and debug | No | Yes, in VS Code | No |
| Hosting | Microsoft-managed | Functions Premium, App Service plan, or Docker | Dedicated, injected into your VNet |
| Billing | Per action and connector execution | Your plan, plus storage transactions | Fixed hourly price per ISE |
| Status (Jan 2021) | GA | Public preview, no SLA | GA |

## Stateful and stateless workflows

The preview introduces a choice you never had to make before. A **stateful** workflow behaves like classic Logic Apps: every action's inputs, outputs and state are written to Azure Storage, you get full run history, interrupted runs can be resumed after an outage, and a run can last up to a year.

A **stateless** workflow keeps all of that in memory. It responds faster, has higher throughput and costs less to run because nothing is persisted between actions. The trade-offs are real: runs are expected to finish within about five minutes, they run synchronously, and if the host fails mid-run the caller has to resubmit. Stateless workflows also can't use managed connector *triggers*; you start them with the built-in Request, Event Hubs or Service Bus trigger.

The kind is declared in `workflow.json` alongside the definition. This is a complete stateful workflow that accepts an order and echoes it back:

```json
{
  "definition": {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "contentVersion": "1.0.0.0",
    "triggers": {
      "manual": {
        "type": "Request",
        "kind": "Http",
        "inputs": {
          "schema": {
            "type": "object",
            "properties": {
              "orderId": { "type": "string" },
              "amount": { "type": "number" }
            }
          }
        }
      }
    },
    "actions": {
      "Response": {
        "type": "Response",
        "kind": "Http",
        "inputs": {
          "statusCode": 202,
          "body": {
            "received": "@triggerBody()?['orderId']"
          }
        },
        "runAfter": {}
      }
    },
    "outputs": {}
  },
  "kind": "Stateful"
}
```

Change `"kind"` to `"Stateless"` and the same definition runs in memory. My rule of thumb: stateless for request/response APIs and high-volume message relays where the caller already retries; stateful for anything long-running, anything with approvals or waits, and anything an operations team will need to investigate after the fact.

Debugging stateless workflows is the obvious pain point, so the runtime lets you switch run history on per workflow through an app setting. Locally, that goes in the `local.settings.json` file in the project's `workflow-designtime` folder:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet",
    "Workflows.<your-workflow-name>.OperationOptions": "WithStatelessRunHistory"
  }
}
```

Set it to `None` or remove it when you're done. Leaving it on in a deployed app quietly gives back the performance you chose stateless for.

## Built-in connectors are the quiet headline

In the preview, some connectors run *inside* the runtime rather than as managed connectors hosted by Microsoft. Service Bus, Event Hubs and SQL Server are the first of these, alongside the long-standing built-ins such as Request, HTTP and Recurrence. Built-in operations show up on the **Built-in** tab in the designer; managed connectors sit on the **Azure** tab.

This matters for two reasons. Built-in operations run in your app's compute, so they don't count against managed connector throttling, which in the preview is 50 requests per minute per connection. And because they execute where your app runs, they are what make the "run anywhere" story credible: a container on-premises can talk to a Service Bus namespace without a round trip through the shared connector infrastructure.

Liquid and XML operations also work without an integration account now. You drop maps and schemas into the project's `Artifacts` folder. For teams that bought an integration account only to run a Liquid transform, that's a direct saving.

## The developer loop

The preview tooling is new and it shows, but the shape is right. You install Azure Functions Core Tools 3.0.2931 or later, the C# extension and the Azure Logic Apps (Preview) extension, set the extension's project runtime to `~3`, and create a project from the Azure pane. On Windows and Linux the designer needs the Azure Storage Emulator running; on macOS you point `AzureWebJobsStorage` at a real storage account. The [VS Code walkthrough](https://learn.microsoft.com/azure/logic-apps/create-standard-workflows-visual-studio-code) covers the full setup.

Deployment from VS Code creates the Logic App (Preview) resource, its plan and its storage account. Because the project is a .NET project underneath, container builds use the standard tooling. Add a Dockerfile to the project root (the preview docs include a sample that sets `AzureWebJobsStorage`), then:

```bash
dotnet build -c release
dotnet publish -c release
docker build --tag local/workflowcontainer .
docker run -e WEBSITE_HOSTNAME=localhost -p 8080:80 local/workflowcontainer
```

The container still needs an Azure Storage connection string for `AzureWebJobsStorage`, so "run anywhere" means "run compute anywhere". State lives in Azure Storage.

The bigger win is what the file-based project does to DevOps. Workflows, connection definitions and maps live in source control as plain files, so pull requests show meaningful diffs and a pipeline can build, test and promote the same artefact. With classic Logic Apps, the honest answer to "how do we review a change?" was usually "export the ARM template and squint at it".

## What's missing in January 2021

The preview documentation and the [public preview known issues list](https://github.com/Azure/logicapps/blob/master/articles/logic-apps-public-preview-known-issues.md) are candid about the gaps. The ones that would block me on a real project:

- **Custom connectors** are unavailable.
- **On-premises data gateway triggers** are unavailable (gateway actions work).
- **Some B2B actions**, such as Flat File encode and decode, are unavailable, and you can't deploy to an ISE.
- **Sliding Window and Batch triggers** are unavailable.
- **Inline Code** (now *Inline Code Operations - Run in-line JavaScript*) doesn't work in VS Code on macOS or Linux.
- **The Azure Functions action** only calls HTTP-triggered functions and authenticates with the function key, so rotating the key breaks the connection.
- **The new designer** can't add parallel branches yet; you toggle back to the old canvas to do it.

Some limits also differ from multi-tenant. Per the [preview limits](https://learn.microsoft.com/azure/logic-apps/logic-apps-limits-and-config), HTTP inbound and outbound calls time out at 230 seconds instead of 120, and Inline Code gets up to 100,000 characters and 15 seconds of execution, up from 1,024 characters and five seconds.

## Cost and networking

Pricing is the part most likely to change at GA, so I wouldn't build a business case on it yet. Today you pay for the Functions Premium or App Service plan you choose, plus Azure Storage transactions for stateful workflows (queues for scheduling, tables and blobs for run state). During the preview there is no additional Logic Apps charge on top of an App Service plan. That shifts cost from "per action" to "per reserved compute", which is a better model for high-volume, steady workloads and a worse one for a handful of workflows that fire a few times a day.

On networking, the attraction is obvious: Premium and App Service plans already have [VNet integration options](https://learn.microsoft.com/azure/azure-functions/functions-premium-plan) that cost a fraction of an ISE. The preview docs don't yet set out a supported network topology for the new resource type, though, so test the exact path you need (private SQL, storage behind a firewall) before you design around it.

## How I'd approach it now

Treat Logic Apps Preview as the direction of travel, not a production platform. Concretely:

1. **Pilot one integration end to end** that represents your estate: a Service Bus or Event Hubs trigger, a transform, a downstream call. Run it locally, deploy it from a pipeline, break it on purpose.
2. **Decide stateful versus stateless per workflow** and write down why. That decision affects resilience and debugging more than anything else in the new model.
3. **Inventory your blockers** against the missing list above. If you depend on custom connectors or gateway triggers, stay on multi-tenant or ISE until they land.
4. **Don't migrate working production workflows** yet. Nothing in the preview carries an SLA, and the hosting and pricing story may shift before GA.

If your pain is local development, source control and many related workflows per solution, this runtime fixes the right things. If you have a few lightweight SaaS automations, classic multi-tenant Logic Apps is still the cheaper and simpler choice, and it isn't going anywhere.
