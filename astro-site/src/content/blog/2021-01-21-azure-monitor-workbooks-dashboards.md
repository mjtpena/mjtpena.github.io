---
title: "Azure Monitor Workbooks as an Incident Triage Tool, Not a Wallboard"
description: "Design an Azure Monitor workbook for incident triage on workspace-based Application Insights, with sampling-safe KQL, drill-down and ARM deployment."
author: Michael John Pena
draft: false
date: 2021-01-21
url: /blog/azure-monitor-workbooks-dashboards/
tags:
  - Azure
  - Azure Monitor
  - Workbooks
  - KQL
  - Observability
---

Most Azure Monitor workbooks I get shown are wallboards: twelve tiles, four line charts, and nothing that helps the on-call engineer at 2am decide where to look next. Workbooks are live KQL with parameters, selection-driven drill-down and a JSON definition you can deploy like any other resource. Used that way, a workbook becomes the first thing you open during an incident, not something you glance at during a standup.

If you want a tour of the building blocks first (text, query, metrics and parameter steps, conditional formatting, tabs), I covered those in [Azure Monitor Workbooks: Custom Visualizations](/blog/2020-12-10-azure-managed-grafana/). This one covers layout decisions, queries that hold up under real telemetry, and how to stop the workbook drifting once three teams start editing it.

## Why workbooks, and when not to use them

Workbooks are generally available and are the visual layer for Azure Monitor insights and Azure Sentinel. Their strength is that the query runs against the source at view time, with the viewer's own Azure RBAC permissions. There is no export pipeline, no dataset refresh and no second copy of the data to secure. The [workbooks overview](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-overview) lists the data sources: Log Analytics workspaces, Application Insights, Azure Monitor metrics, Azure Resource Graph and others.

Viewer permissions have two consequences people miss. On-call engineers need at least Log Analytics Reader on the workspace (or resource-context access to the Application Insights resource) or every step comes back empty, so sort out that role assignment before the incident, not during it. And the workbook has to be saved as a shared workbook, not a private one under **My reports**, or nobody else will find it when they need it.

That design also sets the limits. Here is how I decide:

| Need | Workbooks | Azure dashboards | Power BI |
|---|---|---|---|
| Interactive troubleshooting with parameters and drill-down | Best fit | Weak (pinned tiles, no step-to-step interaction) | Possible, but data is imported or cached |
| Always-on wall display | Works, but not designed for it | Best fit | Works |
| Business audience, blended with non-Azure data | Poor | Poor | Best fit |
| Long-term trend reporting beyond workspace retention | Limited by retention | Limited by retention | Best fit |

My rule of thumb is that if the audience is an engineer who has to act on what they see, build a workbook. If the audience is a manager who wants a monthly number, Power BI is the better tool, and you shouldn't force a workbook into that role.

## Start from workspace-based Application Insights

[Workspace-based Application Insights resources](https://learn.microsoft.com/en-us/azure/azure-monitor/app/create-workspace-resource) are generally available. If you're building a new triage workbook today, I'd build it on the workspace tables (`AppRequests`, `AppDependencies`, `AppExceptions`) rather than on classic `requests` and `dependencies`. The reason is practical. Your application telemetry then sits in the same Log Analytics workspace as your platform logs, so one query step can join a spike in failed requests to the Azure Monitor for containers or diagnostic data from the same window, with no cross-resource syntax.

Classic Application Insights resources still work, and workbooks support both. Just don't mix the two schemas in one workbook. The column names differ (`timestamp` and `duration` against `TimeGenerated` and `DurationMs`), and a half-migrated workbook is confusing to maintain.

## Lay it out as a funnel

The layout I recommend follows the questions an on-call engineer asks, in order:

1. **Is something wrong?** A small row of tiles: request volume, failure rate and P95 latency for the selected time range.
2. **Where is it wrong?** A grid of application roles (or operations) with failure rate and latency, using threshold icons and a heatmap.
3. **Why is it wrong?** Exceptions and failing dependencies for whatever row is selected in step 2.

Steps 2 and 3 are linked through the grid's **When an item is selected, export a parameter** setting under advanced settings. Selecting a row writes a column value (here, the role name) into a parameter, and every step below that references the parameter re-runs. Microsoft's [interactive reports guide](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-interactive-reports) walks through the setting. Pair it with conditional visibility on the step-3 group (**Make this item conditionally visible**, with the rule `SelectedRole` *is not equal to* an empty value) so it only appears once something is selected. Otherwise people stare at an empty grid and assume the workbook is broken.

Keep the parameters at the top short: a time range picker (`TimeRange`) and a multi-select dropdown of application roles (`Roles`) is enough. Every extra parameter is one more thing someone sets wrong during an incident.

## Queries that survive real telemetry

The queries below are workbook query steps. `{TimeRange}`, `{TimeRange:grain}`, `{Roles}` and `{SelectedRole}` are workbook parameters, so they won't run as-is in the Log Analytics query editor.

### Health by role

```kusto
// Step 2 grid: one row per application role
AppRequests
| where TimeGenerated {TimeRange}
| where AppRoleName in ({Roles})
| summarize
    Requests = sum(ItemCount),
    Failed = sumif(ItemCount, Success == false),
    P95DurationMs = percentile(DurationMs, 95)
    by AppRoleName
| extend FailureRate = round(100.0 * Failed / Requests, 2)
| project AppRoleName, Requests, FailureRate, P95DurationMs
| order by FailureRate desc
```

Note the `sum(ItemCount)`. Application Insights adaptive sampling is on by default in the ASP.NET and ASP.NET Core SDKs, and each retained row carries an `ItemCount` that represents the telemetry it stands in for. A plain `count()` undercounts volume on any sampled app, and the error is largest on your busiest services, which are the ones you care about. Rates are less affected, but I'd still use `ItemCount` everywhere so the tiles and the grid agree. Percentiles are calculated on retained rows only, and sampling keeps related telemetry together, so they are a reasonable estimate.

Order by failure rate rather than volume. During an incident, the role that is broken should be at the top of the grid, not the one that happens to be busiest.

### Failure rate over time, at the picker's grain

```kusto
// Step 2 chart: failure rate trend for the selected roles
AppRequests
| where TimeGenerated {TimeRange}
| where AppRoleName in ({Roles})
| summarize
    Requests = sum(ItemCount),
    Failed = sumif(ItemCount, Success == false)
    by AppRoleName, bin(TimeGenerated, {TimeRange:grain})
| extend FailureRate = round(100.0 * Failed / Requests, 2)
| project TimeGenerated, AppRoleName, FailureRate
```

`{TimeRange:grain}` gives you a bin size that scales with the selected range, so the same chart works for 30 minutes and for 7 days without someone editing the query. The [time parameter docs](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-time) list the other formats (`:start`, `:end`, `:label`).

### Why: exceptions and dependencies for the selected role

```kusto
// Step 3 grid: top exception problems for the role exported from the step 2 grid
AppExceptions
| where TimeGenerated {TimeRange}
| where isnotempty('{SelectedRole}')
| where AppRoleName == '{SelectedRole}'
| summarize
    Occurrences = sum(ItemCount),
    LastSeen = max(TimeGenerated),
    SampleMessage = any(OuterMessage)
    by ProblemId, ExceptionType
| top 10 by Occurrences desc
```

```kusto
// Step 3 grid: dependencies called by the selected role, worst first
AppDependencies
| where TimeGenerated {TimeRange}
| where isnotempty('{SelectedRole}')
| where AppRoleName == '{SelectedRole}'
| summarize
    Calls = sum(ItemCount),
    Failed = sumif(ItemCount, Success == false),
    P95DurationMs = percentile(DurationMs, 95)
    by DependencyType, Target
| extend FailureRate = round(100.0 * Failed / Calls, 2)
| order by FailureRate desc, Calls desc
```

Grouping exceptions by `ProblemId` instead of by message is deliberate. Messages often contain IDs, timestamps or user input, so grouping on them gives you hundreds of rows of the same bug. `ProblemId` is Application Insights' own grouping of the exception type and the method that threw it, and it matches what the Failures blade shows. That helps when someone switches between the two views.

The `isnotempty` guard is belt and braces: if someone runs the step outside the conditional group, it returns nothing instead of scanning every row with an empty role name.

Watch the cost of these steps. Every step that references a parameter re-runs when that parameter changes, and `AppDependencies` on a busy app over seven days can be slow enough to hit the query timeout. I'd default the time range picker to the last 4 hours, keep the step-3 queries to the columns they actually summarise, and only widen the range when someone asks a longer question. If the team regularly needs a week-long view, precompute it with a summary query saved as a Log Analytics function, or move that view to a separate report, rather than making the triage page pay for it on every click.

The dependency grid is usually where the real answer turns up. In my experience, a role with a high failure rate is more often the victim of a failing downstream service than the cause. Putting `Target` next to `FailureRate` makes that visible within seconds.

## Treat the workbook as code

Once a workbook proves useful, people edit it in the portal, and three months later nobody knows which copy is the real one. I'd put the shared version under source control from the start.

The portal's **Advanced Editor** shows the workbook's gallery template JSON and an ARM template. Save the gallery template JSON in your repository. That is the version you review in pull requests. Then deploy it with a template that takes that JSON as an object parameter and serialises it with `string()`, so the file in Git stays readable instead of being one escaped string. The structure below follows Microsoft's [programmatic workbook guidance](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-automate), including the `2018-06-17-preview` API version used in the documented samples:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "workbookDisplayName": {
      "type": "string",
      "defaultValue": "Incident triage"
    },
    "workbookId": {
      "type": "string",
      "defaultValue": "[newGuid()]"
    },
    "workbookSourceId": {
      "type": "string",
      "metadata": {
        "description": "Resource ID of the Log Analytics workspace the workbook queries."
      }
    },
    "serializedData": {
      "type": "object",
      "metadata": {
        "description": "Gallery template JSON exported from the workbook Advanced Editor."
      }
    }
  },
  "resources": [
    {
      "type": "microsoft.insights/workbooks",
      "apiVersion": "2018-06-17-preview",
      "name": "[parameters('workbookId')]",
      "location": "[resourceGroup().location]",
      "kind": "shared",
      "properties": {
        "displayName": "[parameters('workbookDisplayName')]",
        "serializedData": "[string(parameters('serializedData'))]",
        "version": "1.0",
        "category": "workbook",
        "sourceId": "[parameters('workbookSourceId')]"
      }
    }
  ]
}
```

```bash
az deployment group create \
  --resource-group <your-resource-group> \
  --template-file workbook.json \
  --parameters workbookSourceId="<your-workspace-resource-id>" \
               workbookId="<a-fixed-guid-for-this-workbook>" \
               serializedData=@triage-workbook.gallery.json
```

Two details matter here. First, pass a fixed `workbookId` from your pipeline. The `newGuid()` default creates a new workbook on every deployment, which is exactly the drift you're trying to stop. Second, check the exported JSON for hard-coded subscription IDs and resource IDs before you commit it. Exports often include `fallbackResourceIds` and resource picker defaults from whoever built the workbook. Replace them with parameters so the same template deploys to dev, test and production.

## Where I'd draw the line

A triage workbook earns its place when it answers "is it broken, where, and why" in three steps, on workspace-based telemetry, with sampling-aware queries and a deployment that can be repeated. Resist adding every chart someone asks for. Each extra step adds load time and attention cost when the on-call engineer has the least attention to spare. If a request is really for a trend report or an executive view, send it to Power BI or an Azure dashboard and keep the workbook lean.

If your resources span many subscriptions, add a subscription and resource picker driven by an Azure Resource Graph query, as described in my [Azure Resource Graph post](/blog/2020-10-05-azure-resource-graph/). That way the same workbook follows your estate as it grows.
