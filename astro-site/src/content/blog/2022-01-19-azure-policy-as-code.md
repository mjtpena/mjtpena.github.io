---
title: "Azure Policy as Code: Repo Layout, Pipeline and Staged Rollout"
description: "How to run Azure Policy from a Git repo with Bicep: what to version, how to stage controls safely, and how to test without a local evaluator."
author: Michael John Peña
draft: false
date: 2022-01-19
url: /blog/azure-policy-as-code/
tags:
  - Azure
  - Azure Policy
  - Governance
  - Bicep
  - Infrastructure as Code
---

Most Azure Policy estates I look at were built by clicking in the portal. A few definitions are copied from a blog post, assignments are scattered across subscriptions, and nobody can say who changed the `deny` on allowed locations or why. Policy as code fixes that, but only if you treat policy like any other production change: reviewed in a pull request, rolled out in stages, and with a way back.

I've covered what Azure Policy is and how effects work in [Azure Policy: Governance at Scale](/blog/2020-10-03-azure-policy-governance/) and the common patterns in [Enforcing Cloud Governance with Azure Policy](/blog/2021-02-06-azure-policy-compliance/). This post is about the delivery side: what goes in the repo, how Bicep deploys it, and how to change a policy without breaking everyone's deployments.

## Four artefacts, four lifecycles

"Policy as code" is usually described as "put your JSON in Git". That misses the point that there are four different things to manage, and they change at different speeds and for different reasons.

| Artefact | What it is | Changes when | Owned by |
|---|---|---|---|
| Definition | The rule (`if`/`then`) | A new control is needed or a rule has a bug | Platform team |
| Initiative (policy set) | A group of definitions with shared parameters | You add or retire a control | Platform team |
| Assignment | An initiative applied at a scope, with parameter values and enforcement mode | You roll out to a new scope or tighten enforcement | Platform team, per environment |
| Exemption | A documented waiver for a scope | A workload has a justified reason to be different | Platform team, requested by workload teams |

Keeping these separate in the repo is the main design decision. Definitions and initiatives are written once and deployed to the top of your management group hierarchy. Assignments are environment configuration, so they live in parameter files. Exemptions are the part most teams leave in the portal, and they are the part an auditor will ask about first.

## Repo layout

```text
policies/
  definitions/
    rg-naming.json
  exemptions/
    legacy-workload-secure-transfer.bicep
  main.bicep
  assignment.bicep
  params/
    nonprod.json
    prod.json
```

I keep custom rules as JSON, in the same shape the portal exports, rather than writing them inline in Bicep. Policy rules are full of ARM-style expressions such as `[parameters('effect')]`, and they're easier to read, diff and paste into the portal's editor when they stay as JSON. Bicep's `loadTextContent()` function, added in [v0.4.412 in July 2021](https://github.com/Azure/bicep/releases/tag/v0.4.412), pulls the file in at build time.

## Built-in first, custom only for what's yours

I only write a custom definition when no built-in fits, because built-ins are maintained by Microsoft and get fixed when resource providers change. HTTPS-only storage shows why. A hand-written rule that flags `supportsHttpsTrafficOnly` equal to `false` misses a real case: on storage API versions older than `2019-04-01`, a request that omits the property creates an account that accepts HTTP. The built-in **Secure transfer to storage accounts should be enabled** (`404c3081-a854-4457-ae30-26a93ef643f9`, version 2.0.0) catches that with a second branch, `[requestContext().apiVersion]` less than `2019-04-01` and the property not existing, and takes an `Audit`/`Deny`/`Disabled` effect parameter.

What has no built-in is anything specific to your organisation, such as a naming convention:

```json
{
  "properties": {
    "displayName": "Resource group names must follow the naming convention",
    "description": "Audits or denies resource groups whose name does not match the organisation's pattern.",
    "mode": "All",
    "metadata": {
      "category": "General",
      "version": "1.0.0"
    },
    "parameters": {
      "namePattern": {
        "type": "String",
        "defaultValue": "rg-*",
        "metadata": {
          "displayName": "Name pattern",
          "description": "Pattern for the like operator, where * is a wildcard."
        }
      },
      "effect": {
        "type": "String",
        "allowedValues": ["Audit", "Deny", "Disabled"],
        "defaultValue": "Audit",
        "metadata": {
          "displayName": "Effect"
        }
      }
    },
    "policyRule": {
      "if": {
        "allOf": [
          {
            "field": "type",
            "equals": "Microsoft.Resources/subscriptions/resourceGroups"
          },
          {
            "field": "name",
            "notLike": "[parameters('namePattern')]"
          }
        ]
      },
      "then": {
        "effect": "[parameters('effect')]"
      }
    }
  }
}
```

The mode is `All`, because `Indexed` doesn't evaluate resource groups. The effect is a parameter defaulting to `Audit`, so one definition can audit in one place and deny in another, which is what makes the staged rollout below possible.

## Definitions and the initiative in Bicep

`main.bicep` deploys at management group scope. It creates the custom definition, wraps it and three built-ins into one initiative, and calls a module to assign that initiative to a target management group.

```bicep
targetScope = 'managementGroup'

@description('Management group the baseline is assigned to, e.g. the landing zones group.')
param assignmentManagementGroupId string

@allowed([
  'Default'
  'DoNotEnforce'
])
param enforcementMode string

param allowedLocations array

@allowed([
  'Audit'
  'Deny'
  'Disabled'
])
param storageHttpsEffect string

@allowed([
  'Audit'
  'Deny'
  'Disabled'
])
param rgNamingEffect string

var rgNaming = json(loadTextContent('definitions/rg-naming.json'))

resource rgNamingDef 'Microsoft.Authorization/policyDefinitions@2021-06-01' = {
  name: 'rg-naming'
  properties: {
    policyType: 'Custom'
    mode: rgNaming.properties.mode
    displayName: rgNaming.properties.displayName
    description: rgNaming.properties.description
    metadata: rgNaming.properties.metadata
    parameters: rgNaming.properties.parameters
    policyRule: rgNaming.properties.policyRule
  }
}

resource baseline 'Microsoft.Authorization/policySetDefinitions@2021-06-01' = {
  name: 'org-baseline'
  properties: {
    policyType: 'Custom'
    displayName: 'Organisation baseline'
    metadata: {
      category: 'General'
      version: '1.0.0'
    }
    parameters: {
      allowedLocations: {
        type: 'Array'
        metadata: {
          displayName: 'Allowed locations'
        }
      }
      storageHttpsEffect: {
        type: 'String'
        allowedValues: [
          'Audit'
          'Deny'
          'Disabled'
        ]
        defaultValue: 'Audit'
      }
      rgNamingEffect: {
        type: 'String'
        allowedValues: [
          'Audit'
          'Deny'
          'Disabled'
        ]
        defaultValue: 'Audit'
      }
    }
    policyDefinitions: [
      {
        // Built-in: Allowed locations
        policyDefinitionReferenceId: 'allowedLocations'
        policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c'
        parameters: {
          listOfAllowedLocations: {
            value: '[parameters(\'allowedLocations\')]'
          }
        }
      }
      {
        // Built-in: Require a tag on resources
        policyDefinitionReferenceId: 'requireOwnerTag'
        policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/871b6d14-10aa-478d-b590-94f262ecfa99'
        parameters: {
          tagName: {
            value: 'owner'
          }
        }
      }
      {
        // Built-in: Secure transfer to storage accounts should be enabled
        policyDefinitionReferenceId: 'secureTransfer'
        policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/404c3081-a854-4457-ae30-26a93ef643f9'
        parameters: {
          effect: {
            value: '[parameters(\'storageHttpsEffect\')]'
          }
        }
      }
      {
        policyDefinitionReferenceId: 'rgNaming'
        policyDefinitionId: rgNamingDef.id
        parameters: {
          effect: {
            value: '[parameters(\'rgNamingEffect\')]'
          }
        }
      }
    ]
  }
}

module baselineAssignment 'assignment.bicep' = {
  name: 'org-baseline-assignment'
  scope: managementGroup(assignmentManagementGroupId)
  params: {
    policySetDefinitionId: baseline.id
    enforcementMode: enforcementMode
    allowedLocations: allowedLocations
    storageHttpsEffect: storageHttpsEffect
    rgNamingEffect: rgNamingEffect
  }
}
```

Set an explicit `policyDefinitionReferenceId` on every member. Exemptions and compliance results refer to members by that ID, and if you let the platform generate one, renaming or reordering the list later becomes painful. The strings starting with `[` reference the initiative's own parameters; Bicep escapes them so ARM passes them through for Azure Policy to resolve at assignment time.

The assignment module carries the per-environment settings, plus a non-compliance message so that a blocked deployment tells the engineer where to go next instead of just failing.

```bicep
targetScope = 'managementGroup'

param policySetDefinitionId string
param enforcementMode string
param allowedLocations array
param storageHttpsEffect string
param rgNamingEffect string

resource assignment 'Microsoft.Authorization/policyAssignments@2021-06-01' = {
  name: 'org-baseline'
  properties: {
    displayName: 'Organisation baseline'
    policyDefinitionId: policySetDefinitionId
    enforcementMode: enforcementMode
    parameters: {
      allowedLocations: {
        value: allowedLocations
      }
      storageHttpsEffect: {
        value: storageHttpsEffect
      }
      rgNamingEffect: {
        value: rgNamingEffect
      }
    }
    nonComplianceMessages: [
      {
        message: 'Blocked by the organisation baseline policy. See <your-governance-wiki-url> or request an exemption.'
      }
    ]
  }
}
```

None of these policies use `deployIfNotExists` or `modify`. If yours do, the assignment needs a managed identity, a `location` and role assignments, so the pipeline needs rights to grant roles. I keep remediation policies in a separate deployment with its own identity.

## Staged rollout: effects per control, enforcement mode per assignment

The riskiest moment in policy as code is a merge that turns on `deny` across production. There are two levers, at different levels.

The assignment's [enforcement mode](https://learn.microsoft.com/azure/governance/policy/concepts/assignment-structure#enforcement-mode) is a dry run for the **whole assignment**. With `DoNotEnforce`, Azure Policy still evaluates resources and reports compliance, but doesn't block create or update requests for any member. Every control here lives in one `org-baseline` assignment, so flipping production to `DoNotEnforce` to trial a new control would also switch off allowed locations and the owner tag. I use `DoNotEnforce` only for the first assignment of the initiative to a new scope, where nothing is enforcing yet.

To stage an individual control, use its effect parameter:

1. **Non-production, effect `Audit`.** Read the compliance results and fix the rule if it flags things it shouldn't.
2. **Production, effect `Audit`.** You see the blast radius on real resources without anyone being blocked, and the rest of the baseline keeps enforcing.
3. **Non-production, effect `Deny`.** Engineers hit it in dev first, and the non-compliance message gets tested.
4. **Production, effect `Deny`.** Only once the existing non-compliant resources are fixed or exempted.

This only works for members whose effect is a parameter. As of January 2022 the built-in **Allowed locations** (version 1.0.0) and **Require a tag on resources** (version 1.0.1) have a fixed `deny` effect, so with `Default` enforcement they block in non-production the moment they're assigned. Stage those with enforcement mode, or in their own temporary `DoNotEnforce` assignment until you promote them into the baseline.

Each step is a one-line change to a parameter file, so each step is a pull request with a reviewer and a history. Here's production at step 2 for secure transfer, with the rest of the baseline enforcing:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "assignmentManagementGroupId": { "value": "<your-prod-landing-zones-mg>" },
    "enforcementMode": { "value": "Default" },
    "allowedLocations": { "value": ["australiaeast", "australiasoutheast"] },
    "storageHttpsEffect": { "value": "Audit" },
    "rgNamingEffect": { "value": "Deny" }
  }
}
```

### Definitions are shared, so version them

Parameter files separate the assignments, not the definitions or the initiative. Both environments share the `rg-naming` definition and the `org-baseline` membership, deployed in one job, so editing a rule or adding a member reaches production on the same merge as non-production.

The cheaper fix is versioning: when a rule changes in a way that could flag new resources, create `rg-naming-v2` (with `metadata.version` at `2.0.0`) beside the old one, add it to the initiative with production's effect at `Audit`, and retire the old one after the new one has worked through the four steps. New members follow the same rule. The thorough option is a separate non-production management group hierarchy with its own copy of the definitions, deployed first. It's more to run, so I'd only do it when policy changes are frequent.

## The pipeline

The workflow runs what-if on pull requests and deploys on merge. I use the same pattern as in [ARM what-if in CI/CD](/blog/2022-01-18-arm-what-if/), at management group scope. What-if shows changes to definitions and assignments, not which resources will become non-compliant, which is why the staged rollout still matters.

```yaml
name: policy

on:
  pull_request:
    branches: [main]
    paths: ['policies/**']
  push:
    branches: [main]
    paths: ['policies/**']

env:
  ROOT_MG: <your-root-management-group-id>
  LOCATION: australiaeast

jobs:
  what-if:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - name: What-if (prod)
        run: |
          az deployment mg what-if \
            --management-group-id "$ROOT_MG" \
            --location "$LOCATION" \
            --template-file policies/main.bicep \
            --parameters @policies/params/prod.json
      - name: What-if (non-production)
        run: |
          az deployment mg what-if \
            --management-group-id "$ROOT_MG" \
            --location "$LOCATION" \
            --template-file policies/main.bicep \
            --parameters @policies/params/nonprod.json

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
      - name: Deploy non-production
        run: |
          az deployment mg create \
            --management-group-id "$ROOT_MG" \
            --location "$LOCATION" \
            --template-file policies/main.bicep \
            --parameters @policies/params/nonprod.json
      - name: Deploy production
        run: |
          az deployment mg create \
            --management-group-id "$ROOT_MG" \
            --location "$LOCATION" \
            --template-file policies/main.bicep \
            --parameters @policies/params/prod.json
```

Both parameter files deploy the same definitions, which is idempotent, and differ only in where the assignment lands and how strict it is. What-if runs for both so a reviewer sees each assignment's change. Put required reviewers on the `production` environment. The service principal behind `AZURE_CREDENTIALS` needs Resource Policy Contributor on the root management group, plus deployment rights at that management group if your tenant's version of the role doesn't include `Microsoft.Resources/deployments/*`, which `az deployment mg create` and `what-if` need. `az role definition list --name "Resource Policy Contributor"` shows what yours has.

Microsoft also publishes two GitHub Actions for this: [manage-azure-policy](https://github.com/Azure/manage-azure-policy), which deploys definitions and assignments from a folder convention, and [policy-compliance-scan](https://github.com/Azure/policy-compliance-scan), which triggers a compliance scan and can fail a workflow on non-compliant resources. Both are reasonable if you aren't otherwise using Bicep. I prefer one deployment language for infrastructure and policy, so the same people can review both.

## Testing: be honest about what you can check

There is no supported local evaluator for Azure Policy rules. Anything that claims to test a rule against a JSON resource on your laptop is reimplementing the engine. The tests that tell you something run against Azure:

- **Compliance results** after an audit-mode assignment. A new assignment isn't evaluated instantly. In a sandbox subscription you can start an [on-demand evaluation scan](https://learn.microsoft.com/azure/governance/policy/how-to/get-compliance-data#on-demand-evaluation-scan) with `az policy state trigger-scan` and then read results with `az policy state summarize`.
- **A known-bad request** in a sandbox subscription where the policy denies, to confirm it really blocks and the message reads well.

```bash
#!/usr/bin/env bash
# Run against a sandbox subscription where org-baseline is assigned with Deny.
set -euo pipefail

if output=$(az storage account create \
  --name "<your-test-storage-name>" \
  --resource-group "<your-sandbox-rg>" \
  --location australiaeast \
  --tags owner=policy-test \
  --https-only false 2>&1); then
  echo "FAIL: storage account with HTTP allowed was created" >&2
  exit 1
fi

if grep -q "RequestDisallowedByPolicy" <<< "$output"; then
  echo "PASS: request denied by policy"
else
  echo "FAIL: request failed for a different reason:" >&2
  echo "$output" >&2
  exit 1
fi
```

It's slow and it needs a real subscription, but it tests the thing you care about. I'd rather have three of these for the controls that matter than a large suite of mocks.

## Exemptions belong in the repo too

[Policy exemptions](https://learn.microsoft.com/azure/governance/policy/concepts/exemption-structure) waive an assignment, or specific initiative members by reference ID, for a scope, with a category (`Waiver` or `Mitigated`) and an optional expiry date. As of January 2022 the resource type `Microsoft.Authorization/policyExemptions` is only available on a preview API version (`2020-07-01-preview`), so treat it as a preview feature. I'd still manage them as code: each one becomes a pull request with a justification and an expiry, and the reviewer sees exactly which controls are waived. This file from `exemptions/` deploys at the resource group that needs the waiver:

```bicep
targetScope = 'resourceGroup'

@description('Resource ID of the org-baseline assignment.')
param policyAssignmentId string

resource secureTransferWaiver 'Microsoft.Authorization/policyExemptions@2020-07-01-preview' = {
  name: 'legacy-workload-secure-transfer'
  properties: {
    policyAssignmentId: policyAssignmentId
    policyDefinitionReferenceIds: [
      'secureTransfer'
    ]
    exemptionCategory: 'Waiver'
    expiresOn: '2022-06-30T00:00:00Z'
    displayName: 'Legacy workload: HTTP access to storage'
    description: 'Approved in <your-change-ticket-id>. Waives secure transfer only; the rest of the baseline still applies.'
  }
}
```

Waiving one member by reference ID, not the whole assignment, is why explicit IDs matter. The expiry forces the conversation to happen again.

## When not to bother

If you have one subscription, a handful of built-in assignments and one person who manages them, a repo and pipeline add more process than they remove. Assign the built-ins in the portal and revisit when a second team or a compliance requirement shows up.

Policy as code also doesn't replace guardrails in your templates. A deny policy tells an engineer they were wrong after they've written the code. A Bicep module that sets `supportsHttpsTrafficOnly: true` by default means they never hit the policy in the first place. You want both.

## My call

Version definitions, initiatives, assignments and exemptions, but treat assignments as environment configuration and change them in small steps. Stage each control through its effect parameter, keep `DoNotEnforce` for a first assignment to a new scope, version definitions so a rule change doesn't reach production on the same merge as dev, and turn on `deny` only after the existing estate is clean. Accept that testing happens in Azure, not on your laptop. What you're buying is the ability to answer "who turned this on, when, and why" with a link to a pull request.
