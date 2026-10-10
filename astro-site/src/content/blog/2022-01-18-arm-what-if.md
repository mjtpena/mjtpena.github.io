---
title: "ARM What-If in CI/CD: Reviewing Bicep Changes Before They Ship"
description: "How to use ARM what-if to review Bicep deployments in pull requests, what its output really tells you, and the noise and blind spots to plan around."
author: Michael John Peña
draft: false
date: 2022-01-18
url: /blog/arm-what-if/
tags:
  - Azure
  - Bicep
  - ARM Templates
  - Infrastructure as Code
  - CI/CD
---

A Bicep file tells you what you want. It doesn't tell you what will happen when you deploy it against a resource group that has drifted, been clicked on in the portal, or been half-migrated by someone else's pipeline. The what-if operation in Azure Resource Manager answers that second question, and in my view it belongs in every infrastructure pipeline. Most teams that adopt it, though, wire it up in a way that gives them a false sense of safety.

## What what-if actually does

What-if sends your compiled template to Resource Manager, which compares it with the current state of the target scope and returns a list of predicted changes. Nothing is deployed. It became generally available in late 2020 (the GA landed in [Azure CLI 2.14.0](https://github.com/Azure/azure-cli/blob/dev/src/azure-cli/HISTORY.rst), with Az PowerShell 4.2 as the PowerShell minimum), and it works at resource group, subscription, management group and tenant scope. Since Azure CLI 2.20.0 you can point it straight at a `.bicep` file; the CLI compiles it for you.

Each resource in the result gets a change type:

| Change type | Meaning | What I do with it |
|---|---|---|
| Create | In the template, doesn't exist yet | Check names and SKUs |
| Modify | Exists and properties will change | Read the property diff carefully |
| Delete | Exists, not in the template, will be removed | Only appears in complete mode |
| NoChange | Redeployed with no property changes | Ignore |
| Ignore | Exists, not in the template, left alone | Ignore, but notice drift |
| Deploy | Will be redeployed, property changes unknown | Only with `ResourceIdOnly` output |

The default result format, `FullResourcePayloads`, includes property-level deltas. `ResourceIdOnly` is faster and less noisy but tells you nothing about properties, which is where most real damage happens.

## The mistake: watching for "Delete"

The most common gate I see is "fail the build if what-if reports a delete". It sounds sensible. It's nearly useless with the default deployment mode.

Resource group deployments run in incremental mode unless you say otherwise. In incremental mode Resource Manager never deletes a resource just because it's missing from your template, so what-if never reports a `Delete` change type. You only see resource deletes when you deploy with `--mode Complete`, and [the deployment modes documentation](https://learn.microsoft.com/azure/azure-resource-manager/templates/deployment-modes) is worth rereading before you turn that on.

Incremental mode still removes things, it just does it inside a `Modify`. When a resource is redeployed, its properties are replaced with what the template says. The cases that bite are arrays and child collections defined inline:

- Subnets declared in a virtual network's `properties.subnets` array. Leave one out and the deployment tries to remove it.
- Key Vault `accessPolicies` in the vault's properties. Anything not in your template is dropped, including policies another team added by hand.
- Tags, app settings and connection strings on App Service, all replaced as a whole.

What-if shows these as a `Modify` with a property-level `Delete` inside the delta. That's the signal worth gating on, not the resource-level change type.

## Running it locally

For day-to-day work, the interactive forms are enough:

```bash
# Full preview against a resource group
az deployment group what-if \
  --resource-group <your-resource-group> \
  --template-file main.bicep \
  --parameters @parameters.prod.json

# Hide the resources that aren't changing
az deployment group what-if \
  --resource-group <your-resource-group> \
  --template-file main.bicep \
  --parameters @parameters.prod.json \
  --exclude-change-types NoChange Ignore

# Preview, then prompt before deploying
az deployment group create \
  --resource-group <your-resource-group> \
  --template-file main.bicep \
  --parameters @parameters.prod.json \
  --confirm-with-what-if
```

`--confirm-with-what-if` (short form `-c`) is the habit I'd push on every engineer who deploys from their own machine. It costs a few seconds and makes "I didn't realise that would change" a lot rarer. In PowerShell the equivalents are `New-AzResourceGroupDeployment -WhatIf` and `-Confirm`, and `Get-AzResourceGroupDeploymentWhatIfResult` returns the result as objects you can inspect. Note that the PowerShell cmdlets need the Bicep CLI installed separately to read `.bicep` files, whereas Azure CLI manages its own copy.

## Putting it in a pull request

The more valuable place for what-if is the pull request, where the reviewer sees the predicted effect next to the code change. `--no-pretty-print` returns the raw JSON, which you can summarise with `jq`. The workflow below runs what-if on every PR, keeps a single summary comment on the PR up to date (it finds its own comment by a hidden `<!-- what-if -->` marker and edits it rather than adding a new one per push), flags property removals with a warning annotation, and deploys from `main` through a protected environment.

```yaml
name: infra

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

env:
  RESOURCE_GROUP: <your-resource-group>

jobs:
  what-if:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Run what-if
        run: |
          az deployment group what-if \
            --resource-group "$RESOURCE_GROUP" \
            --template-file main.bicep \
            --parameters @parameters.prod.json \
            --no-pretty-print > whatif.json

      - name: Summarise changes
        run: |
          jq -r '.changes[]
            | select(.changeType != "NoChange" and .changeType != "Ignore")
            | "\(.changeType)  \(.resourceId)"' whatif.json > summary.txt

          removals=$(jq '[.changes[]
            | select(.changeType == "Delete" or .changeType == "Modify")
            | .delta[]? | .. | objects
            | select(.propertyChangeType? == "Delete")] | length' whatif.json)

          if [ "$removals" -gt 0 ]; then
            echo "::warning::What-if reports $removals property removal(s). Review before merging."
            echo "Property removals: $removals" >> summary.txt
          fi

          cat summary.txt

      - name: Comment on pull request
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v5
        with:
          script: |
            const fs = require('fs');
            const marker = '<!-- what-if -->';
            const summary = fs.readFileSync('summary.txt', 'utf8') || 'No changes.';
            const body = marker + '\n### What-if summary\n```\n' + summary + '\n```';
            const { owner, repo } = context.repo;
            const issue_number = context.issue.number;

            const comments = await github.paginate(github.rest.issues.listComments, {
              owner, repo, issue_number, per_page: 100
            });
            const existing = comments.find(c => c.body && c.body.startsWith(marker));

            if (existing) {
              await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
            } else {
              await github.rest.issues.createComment({ owner, repo, issue_number, body });
            }

  deploy:
    needs: what-if
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v2

      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: What-if at deploy time
        run: |
          az deployment group what-if \
            --resource-group "$RESOURCE_GROUP" \
            --template-file main.bicep \
            --parameters @parameters.prod.json \
            --exclude-change-types NoChange Ignore

      - name: Deploy
        run: |
          az deployment group create \
            --resource-group "$RESOURCE_GROUP" \
            --template-file main.bicep \
            --parameters @parameters.prod.json
```

A few design choices are deliberate here.

**The PR job only summarises.** I don't fail the build on removals. A pipeline that blocks every time someone intentionally removes a subnet trains people to bypass it. A warning and a comment put the decision in front of a human, which is where it belongs.

**The approval lives on the environment.** Configure [required reviewers](https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment) on the `production` environment in the repository settings (for private repos this needs GitHub Enterprise; otherwise use a branch-protected manual approval step). The reviewer approving the deploy should have read the what-if comment on the PR that produced the merge.

**The PR job holds deploy-capable credentials.** This is the trade-off people underestimate. What-if needs the [same permissions as a deployment](https://learn.microsoft.com/azure/azure-resource-manager/templates/deploy-what-if): write on every resource type the template touches, plus `Microsoft.Resources/deployments/*`. A "read-only what-if identity" doesn't exist. Worse, anyone who can push a branch can edit the workflow file in their own PR to use `AZURE_CREDENTIALS` for whatever they like. Secrets aren't passed to workflows triggered from forks, which protects public repositories, but internal contributors with push access are the real exposure. The mitigations that actually help are to store the what-if credential as an environment secret on a `what-if` environment with branch or reviewer protection, and to limit who can push branches to the repository. I'd still give what-if its own identity rather than reusing the deployment principal, but for audit separation, not because it shrinks the blast radius much. [Azure AD workload identity federation](https://learn.microsoft.com/azure/active-directory/develop/workload-identity-federation) for GitHub Actions is in preview and removes the stored secret entirely, but I wouldn't build a production pipeline on a preview feature yet.

**The prediction can go stale.** The PR's what-if ran against yesterday's state. On a push to `main` the `what-if` job runs again before `deploy` because of `needs`, but the deploy can then sit waiting for environment approval for hours. That's why the deploy job runs what-if once more immediately before `az deployment group create`, so the log shows what was predicted at the moment of deployment, not at the moment of merge.

## Noise and blind spots

What-if is a prediction, and the [documentation](https://learn.microsoft.com/azure/azure-resource-manager/templates/deploy-what-if) is upfront that the results include noise. Plan for these:

- **`reference()` can't be resolved.** Any property set from `reference()`, which in Bicep includes reading `.properties` of another resource, shows as changing on every run because what-if compares the unresolved expression with the real value.
- **Defaulted properties look like removals.** If a resource provider fills in default values that aren't in your template, what-if may report them as being deleted even though the deployment won't touch them. This is the main reason a blanket "fail on any property delete" gate doesn't work.
- **Nested templates have limits.** Large deployments with many nested deployments (which is what Bicep modules compile to) or many target resource groups can hit expansion limits, and anything past them is reported as `Ignore` rather than evaluated.
- **It doesn't validate everything.** A clean what-if doesn't mean the deployment succeeds. Quota limits, policy denials at apply time, name collisions in global namespaces, and resource provider errors still surface only when you deploy.

Microsoft collects incorrect results at [aka.ms/whatifissues](https://aka.ms/whatifissues), and Microsoft has been filtering known noise as what-if matures. It isn't zero, so the people reading the output need to know which lines to discount.

## When it isn't worth the effort

For a sandbox subscription that gets torn down weekly, a what-if gate is ceremony. The same goes for templates that only create new, uniquely named resources: there's nothing existing to break. And if your pipeline uses complete mode on resource groups that contain resources owned by other teams, what-if will tell you exactly what's about to be deleted, but the real fix is to stop sharing those resource groups.

There are cheaper checks for different questions. If all you want to know is whether the template is valid and will be accepted, `az deployment group validate` and the Bicep linter (`bicep build` reports linter warnings) catch syntax, type and parameter errors without comparing against live state, and they need far less setup. At the other end, for large estates where the full property payload is slow and mostly noise, `--what-if-result-format ResourceIdOnly` gives a fast list of what will be created, deleted or redeployed. I'd use that for a broad sweep across many resource groups and keep `FullResourcePayloads` for the production resource group where property changes matter.

## The takeaway

Treat what-if as a code review aid, not an automated safety net. Run it on every pull request, post the result where reviewers will read it, and pay most attention to `Modify` entries with property deletes, because in incremental mode that's where data and access disappear. Keep the approval with a human on a protected environment. If you're deciding whether Bicep itself is ready for that pipeline, I covered [where Bicep stands in January 2022](/blog/azure-bicep-2022/), and the [ARM template practices post](/blog/arm-templates-best-practices/) covers the template hygiene that makes what-if output easier to read.
