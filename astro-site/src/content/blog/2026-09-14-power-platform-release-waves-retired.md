---
title: "Release Plans Are Gone: Tracking Power Platform Change in 2026"
description: "Power Platform and Dynamics 365 release plans moved to the AI at Work roadmap. Why a CoE now needs continuous change intake, not two planning events a year."
author: Michael John Peña
draft: false
date: 2026-09-14
tags:
  - Power Platform
  - Governance
  - Administration
  - MCP
---

For years, a Power Platform Centre of Excellence could run change management on a calendar. Release plans usually landed in late January and mid-July (2026 wave 1 slipped to March), and general availability rolled out from April and October. That rhythm is over. From September 2026 Microsoft no longer publishes release plans for Dynamics 365, Power Platform and Dataverse, and the Release Planner portal retires on 15 November 2026. If your CoE's intake process was "read the wave plan twice a year", you now have nothing to read on that schedule.

## What actually changed

The announcement came through two Message Center posts on 25 August 2026. MC1461528 renamed the Microsoft 365 Roadmap to the [**Microsoft AI at Work Roadmap**](https://www.microsoft.com/microsoft-365/roadmap) and said it would carry Dynamics 365, Power Platform and Dataverse content from September 2026. MC1461529 covered the other half: release plans stop, the Release Planner portal retires on 15 November 2026, and new capabilities appear on the AI at Work roadmap once they are committed and ready to share.

The details that matter for planning:

- **Existing release plans stay on Learn as history.** The [Power Platform release plan](https://learn.microsoft.com/en-us/power-platform/release-plan/) pages, including 2026 release wave 1, remain available for reference. The change history pages that tracked items being added, moved and removed will stop growing.
- **Only newer items migrate.** According to MC1461529, roadmap content with a public preview or GA date of 1 June 2026 or later moves to the AI at Work roadmap. Anything older stays in the Learn release plans.
- **Saved views in Release Planner don't carry over.** If someone in your team built "My Release Plans" filters, they need to be rebuilt as roadmap filters before 15 November.
- **This is a communication change, not a shipping change.** Microsoft states that it does not change how products are built, released or deployed. The [model-driven app release channels](https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/channel-overview) still exist, and semi-annual channel features still become visible at the April and October GA deployments.

That last point is why I don't read this as "release waves are gone" in an engineering sense. Code still ships continuously, and some of it is still gated to the semi-annual schedule. Early access opt-in had already gone in February 2026 (MC1226444), when the release wave setting on the Environments page was folded into release channel settings, so September removed the last piece: the plan itself. What's gone is the **document**: the single, dated, curated list of everything coming in the next six months.

## Why the two-event model was always a bit of a fiction

The wave plan was convenient, but it was never the whole truth. Features slipped between waves, the change history pages recorded items being added, moved and removed for months after publication, and plenty of capabilities, Copilot Studio and AI features especially, shipped outside the wave cadence. Copilot Studio's roadmap had already moved out of Release Planner to the Microsoft 365 Roadmap on 2 July 2026 (MC1413298). September extends that to the rest of Power Platform and Dynamics 365. A CoE that only reviewed the plan at publication was already reviewing a stale snapshot by the time GA arrived.

Microsoft removing the document mostly makes that visible. The roadmap already worked as a continuous feed for Microsoft 365, and Microsoft 365 admins have lived with "something changes every week" for a long time. Power Platform teams now get the same deal.

The real loss is the batching. Two planning events a year gave the CoE a natural moment to pull in licensing, security, support and the business owners of key apps. Without a forced moment, intake quietly becomes nobody's job. That's the failure mode to design against.

## Building a continuous change-intake process

What replaces the twice-yearly read is a small pipeline: sources feeding a queue, a triage cadence that drains it, and environments where you can test before the change reaches production.

| Old model | Continuous model |
|---|---|
| Read the release plan in January and July | Filtered roadmap feeds, checked weekly |
| Early access opt-in for a wave | Release channel per environment, plus early release cycle environments |
| Release Planner saved views | Saved roadmap filters, RSS, or an MCP-connected agent |
| One big impact assessment per wave | Small triage decisions, logged as they happen |

### Sources: filter hard, then subscribe

The AI at Work roadmap supports filtering by product, status, release phase, platform and cloud instance, and it publishes an RSS feed that already carries Power Automate and Dynamics 365 items.

My rule of thumb: don't subscribe the CoE mailbox to the unfiltered feed. With Microsoft 365, Dynamics 365 and Power Platform in one place, the volume is high enough that people will stop reading within a fortnight. Build a filtered view per area of ownership: one for Power Apps and Dataverse, one for Power Automate, one for Copilot Studio, one for the Dynamics 365 apps you actually license. Then give each view an owner.

The Message Center in the Microsoft 365 admin center is still the tenant-specific source. The roadmap tells you what's coming in general; Message Center tells you what's coming to *your* tenant, often with a date and an action required. A continuous process needs both.

### Sources for agents: the Release Communications MCP server

The more interesting option is the [Microsoft Release Communications MCP Server](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/mrc-mcp). It's a public, unauthenticated remote MCP server that lets an MCP client query the AI at Work roadmap and Azure Updates. The documented tools are `get_recent_roadmaps`, `get_roadmap_by_id`, `get_recent_azure_updates` and `get_azure_update_by_id`. It covers public roadmap data only, not your tenant's Message Center or service health.

Wiring it into VS Code is a few lines in `.vscode/mcp.json`:

```json
{
  "servers": {
    "mrc": {
      "type": "http",
      "url": "https://www.microsoft.com/releasecommunications/mcp"
    }
  }
}
```

Once connected, a question like "what Power Automate and Dataverse items moved to rolling out in the last two weeks?" becomes a quick query instead of a filtering session. If you're new to the protocol, I covered the basics in [Model Context Protocol explained](/blog/2025-01-07-model-context-protocol-mcp-explained/).

Two cautions. First, an agent summary is a starting point for triage, not the record of it: the list tools return a limited batch with shortened descriptions, so always follow through to the roadmap item before you decide anything. Second, this is a public endpoint with no stated compatibility guarantee on its tool shapes. I'd use it for interactive triage and lightweight digests, and I wouldn't build a production workflow that breaks the CoE's process if a tool gets renamed.

### Cadence: a weekly triage, a quarterly review

The cadence I'd recommend is boring on purpose:

- **Weekly, 30 minutes.** Each area owner walks through new or changed roadmap items and Message Center posts for their area. Every item gets one of four outcomes: ignore, watch, test, or act. Log the decision with the roadmap ID so it can be found later.
- **Monthly.** Review everything in "test" against what's actually visible in your early environments. Promote, defer, or write the communication to makers.
- **Quarterly.** The planning conversation the wave used to force: licensing impact, retirements, anything that changes a DLP policy or environment strategy. Keep the business owners of critical apps in this one.

The weekly session is the one that dies first if nobody owns it. Put it in a named person's calendar, not a shared team calendar.

If you already treat tenant configuration as code, this fits naturally. The same mindset I described in [Fabric governance as automation](/blog/2026-07-27-fabric-governance-as-automation-admin-scanner-rest-apis/) applies here: decisions logged as data, reviewed on a schedule, not held in someone's memory.

### Environments: test where change lands first

Without a wave-level early access list, the practical question becomes "where will I see this change before production does?" There are two levers.

**Release channels.** Model-driven apps can run on the Monthly or Semi-annual channel, set per environment under Settings > Product > Behavior in the Power Platform admin center, and overridable per app. Auto now resolves to Monthly, so unless someone chose Semi-annual, production is already on Monthly. If you want a buffer, set production explicitly to Semi-annual (and set the app channel too, because apps on Auto in Power Platform environments run Monthly regardless) and keep dev/test on Monthly. Treat that as an early look at most changes, not a complete preview: Microsoft notes that the monthly channel isn't a preview of everything in the next semi-annual release, and some changes go straight into a semi-annual release. Both channels deliver GA features; neither is a preview program.

For a single app, appending `&channelrelease=next` to the URL lets a tester run the upcoming monthly release in any environment, no extra environment needed. One gap to watch: the channel docs still say the one-week advance notice of monthly and semi-annual channel changes appears in release plans. Watch the AI at Work roadmap and Message Center for those notices instead, and recheck the channel docs, because that guidance still points at release plans.

**Early release cycle environments.** [Early release cycle](https://learn.microsoft.com/en-us/power-platform/admin/early-release) environments receive platform updates first, so you can validate key scenarios before updates reach business-critical environments. They're created in the admin center with the "Get new features early" option and only in a subset of regions. One of these per tenant, with a copy of your most critical solutions and a smoke-test flow or two, is the cheapest early warning system available.

When not to bother: if your estate is mostly personal productivity apps in the default environment and nothing business-critical runs on Dataverse, a dedicated early release environment is overhead you don't need. A filtered roadmap view and Message Center are enough.

## What I'd do before 15 November

1. Export or screenshot any Release Planner saved views and rebuild them as AI at Work roadmap filters.
2. Assign an owner per product area and give each one a filtered view and an RSS subscription.
3. Book the weekly triage and the first quarterly review. Don't wait for an October GA date to remind you.
4. Decide your release channel per environment and per critical app deliberately, rather than leaving it on Auto, which now means Monthly.
5. Stand up one early release cycle environment if you run anything critical on Dataverse.
6. Try the MCP server for triage digests, but keep the decision log somewhere you control.

The release wave was a crutch, and it was a useful one. Losing it doesn't change what ships. It changes whether your CoE notices in time. Treat change intake as a standing process with owners and a cadence, and the end of the release plan is a non-event. Treat it as something that happens when a document appears, and you'll find out about changes from your users.
