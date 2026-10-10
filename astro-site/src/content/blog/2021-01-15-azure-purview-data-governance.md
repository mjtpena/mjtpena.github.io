---
title: "Azure Purview Preview: Decisions to Make Before You Scan Everything"
description: "A practical plan for an Azure Purview preview pilot: account layout, access roles, scan credentials, classifications, glossary and how preview billing works."
author: Michael John Peña
draft: false
date: 2021-01-15
tags:
  - Azure
  - Purview
  - Data Governance
  - Data Catalog
---

Azure Purview has been in public preview for six weeks, and the most common way I see people start is to point it at every storage account they own and press scan. That produces a catalogue full of assets nobody owns, classifications nobody has checked, and a bill nobody planned for. The tooling is the easy part. The hard part is deciding who looks after what, and you need to do that before the first scan, not after.

This post is about the decisions I'd make before rolling the preview out beyond a sandbox.

## What you are actually getting in the preview

Microsoft launched Azure Purview in public preview on 3 December 2020 ([product overview](https://learn.microsoft.com/azure/purview/overview)). Microsoft describes it in three parts:

- **Data Map.** The metadata store, built on Apache Atlas, with an Atlas-compatible REST API. Scans of registered sources populate it, pulling schema and metadata and sampling data to apply system or custom classifications.
- **Data Catalog.** Search, browse, the business glossary and lineage views, all over what the Data Map holds.
- **Insights.** Reports across the estate: which assets have been scanned, which classifications turn up where, and how far the glossary has got.

You reach all three through Purview Studio, the web UI that sits over them.

The list of [supported sources](https://learn.microsoft.com/azure/purview/sources-and-scans) is short but covers what most Azure estates need: Blob Storage, Data Lake Storage Gen1 and Gen2, Azure SQL Database and Managed Instance, Synapse SQL pools, Cosmos DB, Data Explorer, Power BI, Teradata, and on-premises SQL Server through a self-hosted integration runtime. Lineage comes from Azure Data Factory copy and data flow activities, Azure Data Share, Power BI, and Teradata stored procedures. If most of your transformation logic sits in Databricks notebooks or stored procedures, Purview won't infer that lineage for you. You'd have to push it in yourself through the Atlas API.

It's a preview. Features and APIs will change, there's no SLA, and I wouldn't make Purview the only record of anything a regulator might ask about.

## Decision 1: one account, and where it lives

Treat the Purview account like a shared platform service, not a project resource. When you create one, Azure also creates a managed resource group holding a storage account and an Event Hubs namespace that Purview uses internally. Leave them alone, and make sure your Azure Policy assignments (especially "deny public network access" style policies) don't break them.

My rule of thumb is one production account per organisation, in the region closest to most of your data, in a subscription owned by the platform or data governance team. Several accounts give you several catalogues, and a search in one won't find assets in another. That's the problem Purview is supposed to solve. The exception is a genuine data-sovereignty boundary, and even then I'd push back hard before splitting.

Collections in the preview are a way to organise sources in the Data Map. They are not a security boundary. Don't design your access model around them.

## Decision 2: who can see and curate metadata

Access in the preview is controlled with three Azure built-in roles assigned on the Purview account:

| Role | What it allows | Who gets it |
|---|---|---|
| Purview Data Reader | Search and browse the catalogue and view the glossary | Analysts and engineers across the organisation |
| Purview Data Curator | Edit assets, classifications and glossary terms; view Insights | Data stewards and the governance team |
| Purview Data Source Administrator | Register sources and manage scans | The platform team that owns the integration runtime and credentials |

Data Source Administrator gives no Studio access on its own, so give the platform team's group Data Curator (or Data Reader) as well.

The thing that catches people out: being Owner or Contributor on the account doesn't let you open the catalogue. Those are control-plane roles, so even the person who created the account has to add themselves to one of the data roles. Assign the roles to Azure Active Directory groups, never to individual users:

```bash
# Assign Purview data roles to Azure AD groups (run with Owner or User Access Administrator on the account)
PURVIEW_ID=$(az resource show \
  --resource-group <your-resource-group> \
  --name <your-purview-account> \
  --resource-type "Microsoft.Purview/accounts" \
  --query id --output tsv)

az role assignment create \
  --assignee-object-id <data-readers-group-object-id> \
  --assignee-principal-type Group \
  --role "Purview Data Reader" --scope "$PURVIEW_ID"

az role assignment create \
  --assignee-object-id <data-stewards-group-object-id> \
  --assignee-principal-type Group \
  --role "Purview Data Curator" --scope "$PURVIEW_ID"

az role assignment create \
  --assignee-object-id <platform-team-group-object-id> \
  --assignee-principal-type Group \
  --role "Purview Data Source Administrator" --scope "$PURVIEW_ID"
```

The role model has one consequence you should accept with your eyes open. Every reader sees metadata for every scanned source: table names, column names, classifications. Usually that's the point of a catalogue. But in some organisations the existence of a table is sensitive in itself (an acquisition project, an HR investigation dataset). Those sources shouldn't be scanned into a shared account yet.

## Decision 3: how scans authenticate

Every Purview account has a system-assigned managed identity. For Azure sources, I'd use that identity over SQL logins or account keys wherever the source supports it. For Data Lake Storage Gen2 that means granting Storage Blob Data Reader on the storage account. For Azure SQL Database, create a contained user for the identity, logged in as the server's Azure Active Directory admin:

```sql
-- Run in each Azure SQL database you want Purview to scan, as the Azure AD admin
CREATE USER [<your-purview-account>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [<your-purview-account>];
```

Where you do need a secret (on-premises SQL Server, Teradata, or SQL authentication), keep it in Azure Key Vault and give the Purview managed identity Get and List secret permissions on that vault. Purview references the secret rather than storing it. That gives you one place to rotate it.

Also note that `db_datareader` is real read access to the data, not just the schema. Classification works by sampling actual rows. If your security team signs off on a catalogue that "only sees metadata", correct that early.

## Decision 4: classifications you'll trust

Purview ships with a large set of system classifications: credit card numbers, email addresses, and country-specific identifiers such as the Australia Tax File Number. The default scan rule set applies all of them. That's fine for a first look, but it produces false positives on any column full of nine-digit numbers.

What I'd do instead:

1. Create a custom scan rule set per source type that only includes the classifications that matter for your obligations (for an Australian organisation, the Privacy Act's personal information is a sensible starting point).
2. Add custom classification rules for identifiers unique to your business, such as customer or policy numbers, using a regex on the data and optionally on the column name.
3. Run the first scans on one or two well-understood databases, and have a steward review the results before you widen the scope.

A classification that is wrong half the time is worse than none. People learn to ignore it.

Purview can also extend Microsoft Information Protection sensitivity labels to the assets it scans, if you opt in from the Microsoft 365 compliance centre. It requires Microsoft 365 E5-level licensing and works on a subset of sources (Blob, ADLS Gen2, Azure SQL, Synapse, Cosmos DB). If your organisation already labels documents and email, that's worth piloting, because the same "Confidential" label then means something across Office files and data stores. If it doesn't, sort out the label taxonomy first. Purview won't fix that for you.

## Decision 5: start the glossary small and owned

The business glossary is where Purview becomes more than a technical inventory. It's also where it most often gets abandoned. A glossary of 400 terms imported from an old spreadsheet, with no owners, is dead the day it lands.

Start with 20 to 30 terms that actually cause arguments: "active customer", "revenue", "churn". Give each one a named expert and steward, and link it to the assets that implement it. The Studio supports bulk import from CSV using a template you download from the glossary page. That's useful once the terms are agreed, not as a substitute for agreeing them.

## Decision 6: understand preview billing

The preview isn't free by default. You pick a platform size of 4 or 16 capacity units for the Data Map, and scanning is billed per vCore-hour. Microsoft's preview pricing includes, for a limited period during the preview, 4 Data Map capacity units and 16 vCore-hours of scanning per month at no charge, and scanning Power BI and on-premises SQL Server is free during the preview. Above that you pay the published preview rates. The [current Purview pricing page](https://azure.microsoft.com/pricing/details/purview/) has since moved on from those rates, so check your own invoice and the Azure portal cost view rather than relying on it for preview numbers.

Two practical consequences. Choose 4 capacity units unless you have a reason not to. And watch scan frequency: a weekly full scan of a large data lake will burn through 16 vCore-hours quickly. Set a budget alert on the resource group before the free allowance ends, not after the first invoice.

## When not to roll it out yet

I wouldn't push the preview to production if:

- Most of your lineage lives outside Data Factory, Data Share, Power BI and Teradata, and you have no appetite to write Atlas API integrations.
- You need fine-grained, per-source access control over who can see metadata.
- Your sources are mostly outside the supported list today.
- Nobody has agreed to be a data steward. Purview automates discovery. It doesn't create ownership.

## Where I land

Azure Purview is the first Microsoft governance tool I'd consider for an enterprise data estate. Azure Data Catalog never got there. But treat this preview as a structured pilot: one account, group-based roles, managed identity for scans, a narrow scan rule set, and a glossary with owners. If the pilot shows stewards actually using it, scaling up later is straightforward. If it doesn't, more sources won't help.
