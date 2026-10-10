---
title: "Azure Advisor Score (Preview): Read It as a Trend, Not a Grade"
description: "How the preview Azure Advisor Score is weighted, why dismissals inflate it, and how to pair it with Resource Graph queries before you report it upward."
author: Michael John Peña
draft: false
date: 2022-01-24
url: /blog/azure-advisor-score/
tags:
  - Azure
  - Azure Advisor
  - Governance
  - Cost Optimization
  - Well-Architected
---

Every platform team eventually gets asked "how healthy is our Azure estate?" and has nothing better than a spreadsheet of Advisor recommendations to answer with. Azure Advisor Score is Microsoft's attempt at a single number for that question, and it is a useful one. It is also easy to misread, easy to game, and still in preview, so it is worth understanding what moves it before you put it on a leadership dashboard.

## What Advisor Score is, as of January 2022

Advisor Score went into public preview in September 2020, when Microsoft published the [Advisor Score documentation](https://learn.microsoft.com/azure/advisor/azure-advisor-score), and the portal still labels it public preview at the time of writing. It sits on the Advisor blade in the Azure portal and gives you a percentage from 0% to 100%, overall and for each of the five Advisor categories:

| Category | What it reflects | Category value in the API |
|---|---|---|
| Cost | Idle and oversized resources, reservation opportunities | `Cost` |
| Security | Recommendations surfaced from Microsoft Defender for Cloud | `Security` |
| Reliability | Redundancy, backup, availability configuration | `HighAvailability` |
| Operational Excellence | Deployment, monitoring and management hygiene | `OperationalExcellence` |
| Performance | Throughput and latency improvements | `Performance` |

The categories map onto the pillars of the [Azure Well-Architected Framework](https://learn.microsoft.com/azure/well-architected/), which is the real point of the feature: it turns a list of findings into a posture you can track against a framework your architects already use. Note the `HighAvailability` value. The portal says Reliability, but the API and Resource Graph still use the older name, and it catches people out when they write their first query.

A score of 100% means every assessed resource follows every best practice Advisor checks. Nobody gets there, and you shouldn't try. Some recommendations conflict with deliberate design choices, which is where dismissals come in (more on that below).

## How the score is weighted

This is the part most people skip, and it changes how you should act on the number.

**It is cost-weighted.** For each recommendation type, Advisor compares the retail cost of impacted resources (those with at least one recommendation) with the retail cost of all assessed resources, whether they have recommendations or not. It uses undiscounted pay-as-you-go rates, so your enterprise agreement discounts don't change the result. A misconfigured premium database moves the score far more than a misconfigured storage account. That is a sensible default: it points your effort at the resources where a problem costs the most. Higher-impact recommendations also carry more weight than low-impact ones.

**It penalises age.** In Microsoft's words, "resources with long-standing recommendations will count more against your score". The Cost FAQ gives the practical version: "extra weight is applied to impacted resources that have been idle for a longer time", even when the potential savings are lower. Microsoft doesn't document the exact multiplier, but the direction is clear. The longer you ignore a finding, the more it drags.

**It refreshes daily, not live.** The score is refreshed at least once a day, so remediation can take up to a day to show up. Don't fix something at 4pm and promise the number will move before your 5pm meeting. New or recently changed recommendations also aren't scored straight away: Microsoft says they're included after "a short evaluation period, typically a few weeks", and until then they show a dash in the score impact column.

**Dismissed and postponed recommendations drop out.** When you dismiss or postpone a recommendation, it is excluded from the calculation at the next refresh. That is correct behaviour, because some findings genuinely don't apply. It is also the easiest way to inflate the score without improving anything.

Microsoft says the methodology is "designed to control for the number of resources on a subscription and service mix", and that using undiscounted rates keeps scores comparable across subscriptions. It also says your score "isn't necessarily a reflection of how much you spend". Because it's a ratio, that's fair: a cheap subscription doesn't score well just for being cheap. The limitation is subtler. In a small subscription, one expensive impacted resource can dominate the ratio, so a single forgotten VM swings the score far more than it would in a large estate. And the methodology doesn't distinguish production from dev/test, so the only way to stop dev/test findings counting is to dismiss them, which brings us to the bigger problem.

## What the score can't do yet

The subscription is the smallest unit the preview scores. If you select several subscriptions, the portal shows a weighted score across them, aggregating each category by the resources each subscription consumes. You can't go finer than that: there's no score for a resource group, a workload, an application team or a tag. If several applications share a subscription, the score blends them together, and there's no way in the product today to split it out. If per-workload accountability matters to you, that is another argument for a subscription-per-workload landing zone design, which you probably want for policy and RBAC reasons anyway.

There's also no documented, GA REST API for the score itself at this point. The portal shows the score, the daily, weekly and monthly trend, and the potential score increase per recommendation. For anything automated, I'd work from the recommendations themselves, which are fully queryable.

The Security category deserves its own caution. Advisor's security recommendations come from [Microsoft Defender for Cloud](https://learn.microsoft.com/azure/defender-for-cloud/secure-score-security-controls) (renamed from Azure Security Center in November 2021), and Advisor's Security category uses Defender for Cloud's secure score model rather than the cost-weighted model above, so the two should track each other. Gaps come from scope and refresh timing: the subscriptions selected in each view, and when each last recalculated. Your security team will report secure score anyway, so report Defender for Cloud's secure score as the authoritative security number and treat Advisor's Security percentage as a convenience view.

## Building your own view with Resource Graph

Because the score is portal-only, the practical pattern is to use the score as the headline and [Azure Resource Graph](https://learn.microsoft.com/azure/advisor/advisor-azure-resource-graph) for the detail underneath it. Advisor has exposed its data to Resource Graph through the `AdvisorResources` table since early 2020, across all the subscriptions you can read, which is the way to go beyond a handful of subscriptions. If Resource Graph is new to you, I covered the basics in [an earlier post](/blog/azure-resource-graph/).

This query counts open recommendations and impacted resources per category and impact, which is the breakdown I want next to the score:

```kusto
AdvisorResources
| where type == "microsoft.advisor/recommendations"
| extend category = tostring(properties.category),
         impact = tostring(properties.impact),
         resourceId = tolower(tostring(properties.resourceMetadata.resourceId))
| summarize Recommendations = count(),
            ImpactedResources = dcount(resourceId)
    by subscriptionId, category, impact
| order by subscriptionId asc, category asc, impact asc
```

Run it from the Azure CLI with the `resource-graph` extension, which also lets you schedule it from a pipeline or an Automation runbook:

```bash
az extension add --name resource-graph

az graph query -q "AdvisorResources | where type == 'microsoft.advisor/recommendations' | summarize Recommendations = count() by Category = tostring(properties.category), Impact = tostring(properties.impact)" --first 1000 --output table
```

For Cost, the dollar figure is more persuasive than the percentage. Advisor records estimated savings in the recommendation's extended properties. This follows Microsoft's "Get cost savings summary" sample, and I label the total as an estimate because the property carries no documented period, so check it against the savings shown in the portal before you quote it:

```kusto
AdvisorResources
| where type == "microsoft.advisor/recommendations"
| where properties.category == "Cost"
| extend solution = tostring(properties.shortDescription.solution),
         savings = todouble(properties.extendedProperties.savingsAmount),
         currency = tostring(properties.extendedProperties.savingsCurrency)
| summarize EstimatedSavings = sum(savings),
            Resources = dcount(tostring(properties.resourceMetadata.resourceId))
    by solution, currency
| order by EstimatedSavings desc
```

## Watch the dismissals

Because dismissed and postponed recommendations leave the calculation, the score is only as honest as your dismissal discipline. Advisor stores those decisions as suppressions, which are child resources of the recommendations they hide. They appear in the same table with the type `microsoft.advisor/recommendations/suppressions`:

```kusto
AdvisorResources
| where type == "microsoft.advisor/recommendations/suppressions"
| project id, subscriptionId, suppressionId = tostring(properties.suppressionId), ttl = tostring(properties.ttl)
```

My rule of thumb: every dismissal needs a reason recorded somewhere a reviewer can see it, such as a ticket, an architecture decision record, or a comment in your infrastructure repo. Review the suppression list quarterly. If the score climbs and the suppression count climbs with it, you haven't improved your estate. You've just hidden the findings.

If you want PowerShell instead, the Az.Advisor module's [`Get-AzAdvisorRecommendation`](https://learn.microsoft.com/powershell/module/az.advisor/get-azadvisorrecommendation) returns the same recommendations for the current subscription and filters by category:

```powershell
Connect-AzAccount
Set-AzContext -Subscription "<your-subscription-id>"

Get-AzAdvisorRecommendation -Category HighAvailability |
    Select-Object Impact, ImpactedField, ImpactedValue |
    Sort-Object Impact
```

## Where I wouldn't use it

**As a deployment gate.** It's tempting to fail a pull request when the score drops below a threshold. Don't. The score is subscription-wide, refreshed daily and cost-weighted, so it tells you almost nothing about the change in that pull request. Put policy and template checks in the pipeline, and leave the score for trend reporting.

**As a cross-team league table.** Microsoft designed the score to be comparable across subscriptions, and on paper it is. In practice, two things break the comparison. A small team's score can hinge on one expensive resource, and dismissal discipline differs between teams: the team that dismisses aggressively will outrank the team that leaves honest findings open. Once a score becomes a target, dismissals are the cheapest way to hit it. Compare each subscription against its own history instead.

**As a substitute for a Well-Architected review.** Advisor only checks what it can detect from configuration and telemetry. It can't tell you that your disaster recovery design doesn't meet the business's recovery objective, or that a workload should never have been on VMs. The score measures hygiene, not architecture.

For acting on the recommendations behind the score, see my earlier posts on [Advisor recommendations at scale](/blog/azure-advisor-recommendations/) and [cost optimisation with Advisor](/blog/azure-advisor-cost-optimization/).

## The takeaway

Use Advisor Score as a monthly trend line per subscription, not as a grade. Pair it with Resource Graph queries that show the recommendations, impacted resources and savings behind it, and pair the Security slice with Defender for Cloud's secure score. Track the suppression count alongside the score so nobody can improve the number by dismissing findings. Remember it's a preview, scoped to subscriptions only, and plan your reporting so it still works when Microsoft changes how the score is scoped or exposed.
