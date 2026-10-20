---
title: "Well-Architected Reviews as a Habit, Not a Kickoff Ritual"
description: "How to run Azure Well-Architected Reviews on a cadence: what the assessment covers, what Azure Advisor adds between reviews, and what neither can tell you."
author: Michael John Peña
draft: false
date: 2022-01-23
url: /blog/well-architected-reviews/
tags:
  - Azure
  - Architecture
  - Well-Architected
  - Azure Advisor
  - Governance
---

Most teams do a Well-Architected Review once, at the start of a project, and never look at the results again. The workload then changes every sprint: new services, new integrations, a region added for a customer, a cost line nobody owns. Twelve months later the review describes a system that no longer exists, and the gaps it would catch are sitting in production.

I've already written about [the five pillars of the Azure Well-Architected Framework](/blog/well-architected-framework/) and what each one asks of a design. This post is about the review itself: what the tools actually do, how to split the work between a human-led assessment and continuous signals, and how often to repeat it.

## Two tools that get confused

People say "Well-Architected Review" and mean two different things. It's worth separating them, because they answer different questions.

The [Azure Well-Architected Review](https://learn.microsoft.com/assessments/azure-architecture-review/) is a free, question-based self-assessment hosted on Microsoft's docs site. You pick the pillars you want to assess (Reliability, Security, Cost Optimization, Operational Excellence, Performance Efficiency), answer questions about how the workload is designed and run, and get a score per pillar plus recommendations that link back to [the framework guidance](https://learn.microsoft.com/azure/well-architected/). Sign in and it saves your progress, so you can come back to the same assessment later and compare.

**Azure Advisor** is a different thing entirely. It looks at your deployed resources and their telemetry and produces recommendations in five categories: Cost, Security, Reliability, Operational Excellence and Performance. Those categories line up with the pillars, which is why Advisor gets described as a Well-Architected tool, but it only sees what's deployed. Advisor Score, which rolls those recommendations into a percentage per category, is still in preview as of this writing; I dig into it in [the next post on Advisor Score](/blog/azure-advisor-score/). Advisor's Security recommendations come from Microsoft Defender for Cloud, so treat secure score as the security signal between reviews.

| | Well-Architected Review | Azure Advisor |
|---|---|---|
| Input | Your answers to design and operations questions | Resource configuration and usage telemetry |
| Scope | One workload, as you define it | Subscriptions and resource groups |
| Sees intent (RTO, RPO, threat model) | Yes, if you answer honestly | No |
| Sees drift in production | Only when you rerun it | Yes, refreshed regularly (roughly daily) |
| Effort | A few hours with the right people | Near zero once wired up |
| Best for | Design decisions and process gaps | Configuration gaps and waste |

The mistake I see most often is treating a clean Advisor page as proof the workload is well-architected. Advisor can tell you a VM is underused or a storage account lacks soft delete. It cannot tell you that your disaster recovery plan has never been tested, that nobody is on call for the integration layer, or that your recovery objectives are aspirational. Those are the findings that actually hurt, and only the question-based review surfaces them.

## Running the assessment properly

The assessment is only as good as the answers, and the answers are only as good as the people in the room. My rule of thumb: if the person who gets paged at 2am isn't part of the review, the Operational Excellence and Reliability scores are fiction.

A few things make the difference between a useful review and a box-ticking exercise:

- **Scope it to one workload.** "Our Azure estate" is not a workload. Pick something with a clear owner and a clear boundary, such as the customer portal and its APIs and data stores. A review across ten loosely related systems produces averaged answers that are true for none of them.
- **Write down the requirements first.** Availability target, RTO, RPO, data classification and a monthly budget. Half the questions are unanswerable without these, and discovering that you don't have them is itself the most valuable finding.
- **Answer for what's true, not what's planned.** "We're going to add geo-replication next quarter" is a no. Record the plan in the backlog, not in the assessment.
- **Don't try to fix everything.** A first review typically produces far more recommendations than a team can absorb. Pick the handful that reduce the most risk, put them in the backlog with owners, and accept the rest as known trade-offs.

That last point matters. The framework is explicit that the pillars trade against each other: a second region improves reliability and roughly doubles some costs. A review that ends with "do everything" hasn't made any decisions. A good one ends with a short list of accepted risks that the business has actually signed off.

## Advisor between reviews

The human review is expensive, so you won't run it monthly. Advisor fills the gap. It's free, it re-evaluates resources on a regular cycle, and it's the cheapest early warning you'll get that something has drifted since the last review.

The portal view is fine for a quick look, but I prefer a snapshot I can diff over time. The Azure CLI exposes Advisor through [`az advisor recommendation list`](https://learn.microsoft.com/cli/azure/advisor/recommendation), which takes one category per call. Note that the Reliability category is still `HighAvailability` in the API and CLI, even though the portal shows the newer name.

```bash
#!/usr/bin/env bash
# advisor-snapshot.sh: capture Advisor recommendations for the current subscription
set -euo pipefail

SNAPSHOT_DIR="advisor-snapshots/$(date +%Y-%m-%d)"
mkdir -p "$SNAPSHOT_DIR"

for category in Cost Security HighAvailability OperationalExcellence Performance; do
  az advisor recommendation list \
    --category "$category" \
    --output json > "$SNAPSHOT_DIR/$category.json"
done

# One summary line per recommendation: category, impact, problem, resource
jq -r '.[] | [.category, .impact, .shortDescription.problem, .resourceMetadata.resourceId] | @tsv' \
  "$SNAPSHOT_DIR"/*.json | sort > "$SNAPSHOT_DIR/summary.tsv"

echo "High impact recommendations:"
awk -F'\t' '$2 == "High"' "$SNAPSHOT_DIR/summary.tsv"
```

Run it against each subscription that hosts the workload (`az account set --subscription <your-subscription-id>` first). Comparing two `summary.tsv` files tells you what's new since last month, which is far more actionable than the full list. Because the file is sorted, `comm -13 old.tsv new.tsv` prints only the lines that appeared in the newer snapshot.

### Scheduling the snapshot

If the workload's infrastructure already lives in a GitHub repository, a scheduled workflow keeps the snapshot honest without anyone remembering to run it. The workflow below commits each snapshot back to the repository, so the history lives in Git rather than in build artifacts that expire, and prints what's new against the previous month's `summary.tsv`. This assumes a service principal with Reader access stored as the `AZURE_CREDENTIALS` secret, which is the standard setup for [`azure/login`](https://github.com/Azure/login).

```yaml
# .github/workflows/advisor-snapshot.yml
name: Advisor snapshot

on:
  schedule:
    - cron: '0 21 1 * *'  # 21:00 UTC on the 1st = 08:00 AEDT / 07:00 AEST on the 2nd in Sydney
  workflow_dispatch:

permissions:
  contents: write

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Azure login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Capture Advisor recommendations
        run: bash ./scripts/advisor-snapshot.sh

      - name: Show what's new since the previous snapshot
        run: |
          latest=$(ls -d advisor-snapshots/*/ | sort | tail -n 1)
          previous=$(ls -d advisor-snapshots/*/ | sort | tail -n 2 | head -n 1)
          if [ "$latest" = "$previous" ]; then
            echo "First snapshot, nothing to compare against."
          else
            echo "New since ${previous}:"
            comm -13 "${previous}summary.tsv" "${latest}summary.tsv"
          fi

      - name: Commit snapshot
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add advisor-snapshots
          git diff --cached --quiet || git commit -m "Advisor snapshot $(date +%Y-%m-%d)"
          git push

      - name: Upload snapshot
        uses: actions/upload-artifact@v2
        with:
          name: advisor-snapshot-${{ github.run_id }}
          path: advisor-snapshots/
```

The `contents: write` permission is only for the workflow's own `GITHUB_TOKEN` to push the snapshot; it grants nothing in Azure. Committed snapshots contain resource IDs, so keep this in a private repository. The artifact upload is optional, but naming it with the run ID makes individual runs easy to tell apart when you download them.

Keep the identity at Reader. A recommendations job has no reason to hold Contributor, and a long-lived secret with write access to production is exactly the sort of thing the Security pillar asks you to avoid. If you can use it, azure/login's OpenID Connect support (federated credentials, in preview at the time of writing) removes the stored secret entirely.

I deliberately don't auto-create a ticket for every High impact item. Advisor recommendations include things you've already decided to accept, and a bot that reopens the same issue every month trains the team to ignore it. Dismiss or postpone accepted recommendations in Advisor instead, with a note on why, so the snapshot only shows what's genuinely new.

## When to rerun the full review

Advisor tells you about configuration drift. It won't tell you when the design itself has changed underneath the last assessment. I'd rerun the question-based review when any of these happen:

- A significant architecture change: a new region, a new data store, a move from VMs to PaaS or containers, or a new external integration.
- A change in requirements: a higher availability commitment to a customer, new regulatory obligations, or a new data classification.
- After a major incident, once the post-incident review is done. The incident tells you which answers were optimistic.
- Otherwise, once or twice a year for anything business-critical.

Rerun it with the same scope and compare against the saved results. The trend per pillar is more useful than the absolute score, which depends heavily on how strictly the team answers.

## When not to bother

Not every workload needs this. A proof of concept that will be thrown away in six weeks, an internal tool with a handful of users and no data of consequence, or a sandbox subscription will get more value from Advisor alone and a sensible landing zone. Spending an afternoon assessing the Reliability pillar of a demo is effort taken away from the systems that matter.

The other case is when nobody will act on the result. If there's no owner with time and budget to work the backlog, the review produces a document and nothing else. Fix the ownership first.

## The takeaway

Treat the Well-Architected Review as a recurring control, not a project deliverable. Use the question-based assessment for the decisions only people can make, scoped to one workload and rerun when the design or requirements change. Use Azure Advisor, captured on a schedule, as the cheap continuous signal between reviews. And measure success by the short list of risks you've either fixed or explicitly accepted, not by the score.
