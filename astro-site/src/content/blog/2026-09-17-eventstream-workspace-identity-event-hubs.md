---
title: "Workspace Identity for Eventstream Sources: Retire the Shared Access Key"
description: "Eventstream can now read Azure Event Hubs with workspace identity. How to move off SAS keys, the RBAC each side needs, and when a service principal still wins."
author: Michael John Peña
draft: false
date: 2026-09-17
tags:
  - Microsoft Fabric
  - Event Hubs
  - Real-Time Intelligence
  - Security
  - Identity
---

In my experience, most Fabric estates have a reasonable story for secrets in pipelines and notebooks: Key Vault, service principals, maybe a rotation runbook. Eventstream is usually the exception. Somebody pasted a Shared Access Key into an Event Hubs connection on the day the stream went live, it worked, and nobody has thought about it since. That key never expires on its own, it often carries far more rights than the stream needs, and it doesn't show up in anyone's secret inventory because it lives in a Fabric connection rather than a vault.

July 2026 gave you a way out. The Azure Event Hubs source in Eventstream now [supports **workspace identity** authentication](https://community.fabric.microsoft.com/t5/Fabric-Updates-Blog/Secure-Azure-Event-Hubs-Connections-in-Eventstream-with/ba-p/5359945) (preview), and [private network support for Eventstream connectors](https://community.fabric.microsoft.com/t5/Fabric-Updates-Blog/Supercharge-your-real-time-data-ingestion-What-s-new-in-Fabric/ba-p/5260314) is now generally available. Together they mean an Eventstream can read a private event hub without any shared secret at all. Here's how I'd approach the move, and where I wouldn't.

## Why the SAS key is the neglected secret

A shared access signature policy is a name plus a key with some combination of Listen, Send and Manage rights. Three things make it worse than most secrets in a data platform.

- **It doesn't expire.** The key is valid until somebody regenerates it. A Fabric connection holding it will keep working for years, which is exactly why nobody revisits it.
- **It's usually over-scoped.** The mistake I see most often is the namespace-level `RootManageSharedAccessKey` used for a read-only stream. That policy has Manage, Send and Listen across every event hub in the namespace.
- **It isn't attributable.** Requests made with a SAS key identify a policy, not a principal. You can't tell from Entra sign-in logs which workload used it, and you can't revoke one consumer without breaking every other consumer that shares the policy.

The fix on the Azure side has existed for years: Event Hubs supports [Microsoft Entra ID authorisation with Azure RBAC](https://learn.microsoft.com/en-us/azure/event-hubs/authorize-access-azure-active-directory), and you can disable local (SAS) authentication on a namespace once nothing depends on it. What was missing was a way for Eventstream to present an Entra identity. That's the gap workspace identity fills.

## What workspace identity actually is

A [Fabric workspace identity](https://learn.microsoft.com/en-us/fabric/security/workspace-identity) is a service principal that Fabric creates and manages for a single workspace. Creating one also creates an app registration in Entra ID, and Fabric handles the credentials, so there's nothing for you to store or rotate. The identity has the same name as the workspace, and it's generally available in any workspace except My workspace, regardless of capacity SKU.

Only a **workspace admin** can create or delete it; **admins, members and contributors** can select it in a connection. **A deleted identity can't be restored**, not even by restoring the workspace, so you'd create a new one and redo the role assignments. Creation, deletion and token retrieval are recorded in Microsoft Purview Audit.

## The RBAC each side needs

There are two permission planes, and a migration fails quietly if you only do one.

| Where | Who | Permission |
|---|---|---|
| Fabric workspace | The person creating the identity | Workspace admin |
| Fabric workspace | The person configuring the Eventstream source | Contributor or higher |
| Event hub (Azure) | The workspace identity | Azure Event Hubs Data Receiver |
| Virtual network (Azure, private hubs only) | The workspace identity | Network Contributor |
| Azure (event hub or VNet scope) | The person granting roles | Owner, User Access Administrator or Role Based Access Control Administrator |

The [Event Hubs source documentation](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/add-source-azure-event-hubs) walks through the portal path: enable the workspace identity, copy its ID, then add a role assignment for **Azure Event Hubs Data Receiver** on the event hub. Data Receiver is the right role because it's receive-only; it can't send events or change the namespace.

Scope it to the **event hub**, not the namespace. A namespace-level assignment reproduces the over-scoping problem of `RootManageSharedAccessKey` in RBAC form. The CLI version makes the scope explicit:

```bash
#!/usr/bin/env bash
set -euo pipefail

RG="<your-resource-group>"
NAMESPACE="<your-eventhubs-namespace>"
HUB="<your-event-hub>"
WORKSPACE_IDENTITY_ID="<id-from-workspace-settings>"

# Resolve the workspace identity's service principal object ID.
SP_OBJECT_ID=$(az ad sp show --id "$WORKSPACE_IDENTITY_ID" --query id -o tsv)

# Scope the role to the single event hub, not the namespace.
HUB_ID=$(az eventhubs eventhub show \
  --resource-group "$RG" \
  --namespace-name "$NAMESPACE" \
  --name "$HUB" \
  --query id -o tsv)

az role assignment create \
  --assignee-object-id "$SP_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Azure Event Hubs Data Receiver" \
  --scope "$HUB_ID"
```

Look the identity up by its ID rather than by name. Because the identity takes the workspace's name, and identities of deleted workspaces persist through the retention period, your tenant can hold more than one app registration with the same display name.

### The private network case

If the event hub is behind a private network, the [streaming connector private network guide](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/streaming-connector-private-network-support-guide) already requires a workspace identity: it needs **Network Contributor** on the Azure virtual network so Fabric can inject the connector into a subnet delegated to `Microsoft.MessagingConnectors`. You then pick a streaming virtual network data gateway in the Event Hubs connection. So if you've adopted private networking, the identity already exists and already holds a role in your subscription. Using it for data-plane access too is a small step. The docs note that you skip the test-connection step when a data gateway is selected, and source-level data preview doesn't work for private-network sources either. Verify after publishing in Live view: the source should show Active, and data should appear in Data insights or the data preview on the stream node.

## Moving an existing stream off SAS

In the current preview, workspace identity appears under the **Extended features** level of the Event Hubs source; the Basic level still offers only Shared Access Key. With that in mind, the sequence I'd follow:

1. **Inventory first.** Find every SAS policy on the namespace and on each hub, and work out who uses it. Eventstream is rarely the only consumer.
2. **Create the workspace identity** and grant Data Receiver on the specific hub. Allow a few minutes for the role assignment to propagate before you test.
3. **Use a dedicated consumer group** for the Eventstream source if you aren't already. The Event Hubs docs list consumer group as an RBAC scope, but the portal can't assign at that level and the Fabric docs only show a hub-level Data Receiver assignment, so treat the dedicated group mainly as operational isolation: sharing `$Default` with other readers causes problems however you authenticate.
4. **Repoint the source** to a new connection with workspace identity as the authentication kind, publish, and confirm events in the Live view. If the existing source was added at the Basic level, you can't just swap the connection: add a new Azure Event Hubs source at Extended features level with the workspace identity connection (same hub, dedicated consumer group), publish, confirm data, then delete the old source and republish. Expect a short gap or overlap of duplicates during the switch.
5. **Remove the key.** Delete the SAS policy if Eventstream was its only user, or regenerate both keys if not, so the copy stored in the old Fabric connection is dead. Then delete the old connection.
6. **Disable local authentication** on the namespace once nothing depends on SAS. That's the step that makes the improvement permanent.

The inventory and the final lock-down look like this:

```bash
#!/usr/bin/env bash
set -euo pipefail

RG="<your-resource-group>"
NAMESPACE="<your-eventhubs-namespace>"

# Namespace-level SAS policies (RootManageSharedAccessKey lives here).
az eventhubs namespace authorization-rule list \
  --resource-group "$RG" --namespace-name "$NAMESPACE" \
  --query "[].{name:name, rights:join(',', rights)}" -o table

# Hub-level SAS policies, for every hub in the namespace.
for h in $(az eventhubs eventhub list --resource-group "$RG" --namespace-name "$NAMESPACE" --query "[].name" -o tsv); do
  echo "== $h"
  az eventhubs eventhub authorization-rule list \
    --resource-group "$RG" --namespace-name "$NAMESPACE" --eventhub-name "$h" \
    --query "[].{name:name, rights:join(',', rights)}" -o table
done

# Only after every consumer and producer uses Entra ID:
az eventhubs namespace update \
  --resource-group "$RG" --name "$NAMESPACE" \
  --disable-local-auth true
```

Don't skip the producer side. Disabling local auth blocks SAS for every client of the namespace, including the application that sends the events and any Kafka client using a connection string. That's the point, but it means the migration is a namespace project, not an Eventstream ticket.

## What it means to tie access to a workspace

Workspace identity changes the shape of the security boundary, and it's worth being precise about how.

With a SAS key, the boundary is the key: whoever holds it can read. With workspace identity, the boundary is **workspace membership**. Any contributor in that workspace can create a connection that uses the identity, and therefore read any event hub the identity has been granted. The workspace identity docs are blunt about this: anyone given access to the identity can assume it.

That's mostly an improvement. Workspace roles are visible, reviewable and tied to named people, which is more than you can say for a key sitting in a connection. But it has consequences:

- **Workspace design becomes access design.** If one workspace mixes a sensitive telemetry stream with general-purpose analytics work, every contributor in it can reach that telemetry. Put sensitive streams in workspaces with a tight contributor list. I made the same argument for [OneLake shortcuts as an authorisation boundary](/blog/2026-07-27-onelake-shortcuts-are-an-authorization-boundary-a-security-model-for-fabric/); the identity just moves the problem upstream.
- **Grants accumulate.** Each new stream adds a role assignment to the same principal. Review what the identity holds in Azure, not just who's in the workspace.
- **The identity's life is the workspace's life.** Recreating a workspace, or a bad cleanup in Entra, breaks every stream at once. The docs explicitly warn against modifying or deleting the app registration in the Azure portal.
- **Conditional Access can block it.** If you have a Conditional Access policy for workload identities that targets all service principals, each workspace identity must be excluded or it won't work.

## When a dedicated service principal is still the better choice

Be clear about the options first: the Eventstream Event Hubs source documents Shared Access Key and workspace identity, so within that connector the choice is between those two. Where a dedicated service principal still wins is the wider estate around the stream.

- **Cross-tenant hubs.** Workspace identity isn't supported in B2B or cross-tenant scenarios. If the hub lives in a partner's tenant, Eventstream stays on SAS for now, and a multi-tenant app registration is the better pattern for anything else reading it.
- **One identity across environments.** Dev, test and prod workspaces each get their own workspace identity. If you need a single, stable principal that platform automation provisions, a service principal managed as code fits better. That's the same reasoning as treating [the tenant as code](/blog/2026-07-27-fabric-cicd-is-solved-your-tenant-isnt-tenant-as-code/).
- **Non-Eventstream readers.** External apps reading the same hub should have their own identity: a managed identity when they run on Azure compute, or [workload identity federation](/blog/2022-02-12-workload-identity-federation/) for workloads outside Azure, rather than a client secret, so each consumer can be revoked independently.
- **Separation of duties.** If your policy says the people who build pipelines must not control the credential those pipelines run as, workspace identity doesn't satisfy it: workspace admins create it, contributors use it.

## The decision

If an Eventstream reads Azure Event Hubs in the same tenant, I'd move it to workspace identity now, preview label and all. The worst failure mode of the preview is a broken stream you can roll back; the failure mode of the status quo is a non-expiring, over-scoped key that nobody owns. Scope Data Receiver to the hub, keep sensitive streams in tightly held workspaces, and finish the job by disabling local authentication on the namespace. Keep SAS only where you're forced to, which today means cross-tenant hubs, and write that exception down so it doesn't become the next forgotten secret.
