---
title: "Key Vault Beyond the Basics: RBAC, Soft-Delete and Expiry Events"
description: "Vault topology, the Azure RBAC preview versus access policies, default soft-delete, and rotating secrets from Event Grid expiry events, as of January 2021."
author: Michael John Pena
draft: false
date: 2021-01-25
url: /blog/azure-key-vault-advanced-patterns/
tags:
  - Azure
  - Key Vault
  - Security
  - Terraform
  - Event Grid
---

"Put it in Key Vault" is the easy advice, and most teams have taken it. What goes wrong comes later: one vault shared by twelve apps, a Contributor who quietly grants themselves read access to production secrets, a vault deleted by a pipeline with no way back, or a database password that expired at 2am because nobody owned the rotation. Key Vault changed a lot in late 2020, so it's worth revisiting those decisions.

I've covered the app-side integration (managed identity, the configuration provider, caching) in [an earlier post on Key Vault in .NET](/blog/2020-08-12-azure-key-vault-dotnet/). This one is about the platform decisions around the vault: how many to have, who can read what, what happens on delete, and how secrets get rotated.

## One vault per app, per environment

Microsoft's [Key Vault best practices](https://learn.microsoft.com/azure/key-vault/general/best-practices) recommend a vault per application per environment, and I agree. The reasoning:

- **Blast radius.** Any identity with read access to secrets on a vault can read *every* secret in it under the access-policy model. A shared vault means the reporting job can read the payments API's signing key.
- **Throttling.** Key Vault limits transactions per vault. A chatty app that doesn't cache can throttle every other tenant of a shared vault.
- **Lifecycle.** When an app is retired you delete its vault. With a shared vault you're grepping secret names and hoping.

Vaults cost nothing to have; you pay per operation, so sprawl is a naming problem, not a cost problem.

When *wouldn't* I do this? Certificates shared across many apps, such as a wildcard TLS certificate, are better kept in one well-guarded vault that the consuming services (App Service, Application Gateway, Front Door) import from. Copying the same certificate into twenty vaults means renewing it twenty times.

## Access policies vs the Azure RBAC preview

Key Vault has two permission models for the data plane, and you choose one per vault.

**Vault access policies** are the classic model. Each policy grants an identity a set of permissions (for example `get` and `list` on secrets) across the *whole* vault. There's no per-secret scoping, a vault supports a limited number of policies, and the policies live in the vault's management-plane properties. That last point is the real problem: anyone with `Microsoft.KeyVault/vaults/write`, which includes the built-in Contributor role, can edit the access policies and grant themselves data access. Your management-plane Contributors are effectively secret readers.

**Azure RBAC for the Key Vault data plane** went into [public preview in September 2020](https://learn.microsoft.com/azure/key-vault/general/rbac-guide). With `enableRbacAuthorization` set on the vault, access is controlled by role assignments, the same as everything else in Azure. You get built-in roles such as Key Vault Administrator, Secrets Officer, Secrets User, Crypto User and Certificates Officer; each currently carries a (preview) suffix, such as "Key Vault Secrets User (preview)". Assignments can be scoped down to an individual secret, key or certificate, and they're governed by the same Privileged Identity Management and access reviews you already run. Contributor no longer implies data access; only principals who can write role assignments (Owner, User Access Administrator) can grant it. One caveat: the permission model is itself a property of the vault resource, so someone who can write the vault can still switch it back to access policies. Alert on that change in the Activity Log.

| | Access policies | Azure RBAC (preview, Jan 2021) |
|---|---|---|
| Granularity | Whole vault, per object type | Down to a single secret, key or certificate |
| Who can grant data access | Anyone who can write the vault resource | Only principals who can write role assignments |
| Management | Per-vault list | Same as every other Azure resource, including PIM |
| Status | GA | Public preview |
| Propagation | Near-immediate | Role assignments can take a few minutes to apply |

My position: for **new** vaults I'm defaulting to RBAC, with the preview caveat stated plainly to whoever owns the risk register. It's where Microsoft is taking the product, and the escalation path through access policies is a real gap. For **existing** production vaults I'm not switching yet. Changing the permission model disables every existing access policy at once. If your role assignments aren't already in place, that's an outage. Plan the migration, mirror the policies as role assignments first, and wait for GA if your organisation doesn't run production on previews.

Here's the shape I use in Terraform. `enable_rbac_authorization` has been in the `azurerm` provider since late 2020; the 2.4x releases this month all support it.

```hcl
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 2.44"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "app" { type = string }
variable "environment" { type = string }
variable "location" {
  type    = string
  default = "australiaeast"
}
variable "app_principal_id" {
  description = "Object ID of the app's managed identity"
  type        = string
}
variable "allowed_ip_ranges" {
  type    = list(string)
  default = []
}

data "azurerm_client_config" "current" {}

resource "azurerm_resource_group" "app" {
  name     = "rg-${var.app}-${var.environment}"
  location = var.location
}

resource "azurerm_key_vault" "app" {
  name                = "kv-${var.app}-${var.environment}"
  location            = azurerm_resource_group.app.location
  resource_group_name = azurerm_resource_group.app.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  enable_rbac_authorization  = true
  soft_delete_retention_days = 90
  purge_protection_enabled   = var.environment == "prod"

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
    ip_rules       = var.allowed_ip_ranges
  }
}

# Key Vault Secrets User: read secret values, nothing else
resource "azurerm_role_assignment" "app_secrets_user" {
  scope              = azurerm_key_vault.app.id
  role_definition_id = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6"
  principal_id       = var.app_principal_id
}
```

I reference the role by its GUID rather than its display name, because the name still has the (preview) suffix and will change at GA; the GUID won't. Two things catch people out. The identity running Terraform needs a data-plane role (Secrets Officer, say) if the same configuration also writes secrets; owning the subscription isn't enough under RBAC. And with `default_action = "Deny"`, your build agents need to reach the vault through an allowed IP range or a private endpoint.

## Soft-delete is becoming mandatory

Soft-delete keeps a deleted vault, or a deleted secret, key or certificate, recoverable for a retention period of 7 to 90 days, and once it's on it can't be turned off. Microsoft [announced that the ability to opt out will be removed](https://learn.microsoft.com/azure/key-vault/general/soft-delete-change), originally planned for the end of December 2020. As I write, new vaults get soft-delete by default and you can still technically opt out at creation, but I'd treat that door as already closed. The Terraform provider has: [azurerm 2.41 (17 December 2020)](https://github.com/hashicorp/terraform-provider-azurerm/blob/main/CHANGELOG-v2.md) started purging secrets, keys and certificates on destroy (switch it off with `purge_soft_delete_on_destroy` in the provider's `features` block), and 2.42 (8 January 2021) deprecated `soft_delete_enabled` and defaulted it to `true`, so it now treats soft-delete as always on. The [soft-delete overview](https://learn.microsoft.com/azure/key-vault/general/soft-delete-overview) has the details.

What this changes in practice:

- **Names stay reserved.** A soft-deleted vault keeps its globally unique name until it's purged or the retention period ends. A pipeline that deletes and recreates `kv-orders-dev` will fail on the second run unless it purges first or recovers the old vault.
- **Secret names too.** Deleting a secret and immediately setting one with the same name fails with a conflict while the deleted secret is still in the recycle bin.
- **Purge is the new delete.** Tidy-up scripts need the `purge` permission (or the Key Vault Contributor role on the management side for vault purges), and that permission deserves the same scrutiny as delete used to.

**Purge protection** is the second switch. With it on, nobody (including a subscription Owner) can purge a deleted vault or object before the retention period ends. It can't be turned off once enabled, and it's required for customer-managed key scenarios such as Azure Storage and Azure SQL encryption with your own keys, because losing that key means losing the data.

I turn purge protection on for production and leave it off in dev and test, as in the Terraform above. In dev, recreating environments on the same names matters more than protecting throwaway secrets.

## Make expiry do the work

Most teams store secrets with no expiry date, which wastes the most useful signal the service gives you. Key Vault's [Event Grid integration](https://learn.microsoft.com/azure/key-vault/general/event-grid-overview) went GA in the second half of 2020, after being in preview since 2019. It emits `SecretNearExpiry` 30 days before a secret's expiry date, `SecretExpired` when it passes, and `SecretNewVersionCreated` when a new version is written. Equivalent events exist for keys and certificates.

That gives you a pattern that doesn't depend on someone's calendar reminder:

1. Every rotatable secret is written with an `expires_on` date and a `rotation-target` tag that says what consumes it.
2. An Event Grid subscription on the vault sends `SecretNearExpiry` to a Function.
3. The Function generates a new value, applies it to the target system, and writes a new secret version with a fresh expiry, which restarts the cycle.

Microsoft's [rotation tutorial](https://learn.microsoft.com/azure/key-vault/secrets/tutorial-rotation) covers Azure SQL. Here's a handler skeleton using the Python Functions programming model and the track-2 SDKs (`azure-keyvault-secrets` 4.x, `azure-identity` 1.x). The target-specific step is deliberately left as a stub, because it's different for every system.

```python
# __init__.py: Event Grid-triggered rotation handler (skeleton)
import logging
import os
import secrets
import string
from datetime import datetime, timedelta, timezone

import azure.functions as func
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient

ROTATION_DAYS = int(os.environ.get("ROTATION_DAYS", "90"))
ALPHABET = string.ascii_letters + string.digits + "-_.~"


def generate_password(length: int = 32) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def apply_to_target(target: str, new_value: str) -> None:
    """Push the new credential to the system that uses it.

    Implement per target: ALTER LOGIN on a database, a vendor API call, etc.
    Raise on failure so Key Vault keeps the current version.
    """
    raise NotImplementedError(f"No rotation handler for target '{target}'")


def event_field(data: dict, key: str):
    """Read a payload field whatever its casing.

    The schema docs show camelCase (vaultName, version); real payloads use
    PascalCase (VaultName, Version).
    """
    lowered = {k.lower(): v for k, v in data.items()}
    return lowered.get(key.lower())


def main(event: func.EventGridEvent) -> None:
    # topic: /subscriptions/.../providers/Microsoft.KeyVault/vaults/<vault-name>
    # subject: the secret name
    vault_name = event.topic.rsplit("/vaults/", 1)[-1]
    vault_url = f"https://{vault_name}.vault.azure.net"
    name = event.subject
    event_version = event_field(event.get_json(), "version")

    client = SecretClient(vault_url=vault_url, credential=DefaultAzureCredential())
    current = client.get_secret(name)
    tags = current.properties.tags or {}

    # Event Grid delivers at least once and retries; a duplicate or late event
    # for a version that has already been replaced must not rotate again.
    if event_version and event_version != current.properties.version:
        logging.info("Event for %s/%s is stale; current version is %s",
                     name, event_version, current.properties.version)
        return

    target = tags.get("rotation-target")
    if not target:
        logging.warning("Secret %s has no rotation-target tag; skipping", name)
        return

    new_value = generate_password()
    apply_to_target(target, new_value)

    client.set_secret(
        name,
        new_value,
        expires_on=datetime.now(timezone.utc) + timedelta(days=ROTATION_DAYS),
        tags={**tags, "rotated-from": current.properties.version},
    )
    logging.info("Rotated %s, previous version %s", name, current.properties.version)
```

```json
{
  "scriptFile": "__init__.py",
  "bindings": [
    {
      "type": "eventGridTrigger",
      "name": "event",
      "direction": "in"
    }
  ]
}
```

Wire it up with an event subscription filtered to the one event type you handle:

```bash
az eventgrid event-subscription create \
  --name rotate-near-expiry \
  --source-resource-id "/subscriptions/<subscription-id>/resourceGroups/<rg-name>/providers/Microsoft.KeyVault/vaults/<vault-name>" \
  --endpoint-type azurefunction \
  --endpoint "/subscriptions/<subscription-id>/resourceGroups/<rg-name>/providers/Microsoft.Web/sites/<function-app-name>/functions/<function-name>" \
  --included-event-types Microsoft.KeyVault.SecretNearExpiry
```

The Function's managed identity needs Key Vault Secrets Officer on the vault, not Secrets User, because it writes new versions.

Design the handler for Event Grid's delivery model. [Delivery is at least once](https://learn.microsoft.com/azure/event-grid/delivery-and-retry), and a failed or slow delivery is retried with backoff for up to 24 hours by default. Without a guard, a duplicate `SecretNearExpiry` rotates the credential twice, and an exception in `apply_to_target` triggers a retry storm against the target. That's why the handler compares the event's version with the secret's current version and skips stale events. I'd also add a dead-letter destination (a storage container) to the subscription, so an event that exhausts its retries becomes something you can see rather than a silent miss.

### The single-credential trap

Look at the order in the handler: change the target, then write to Key Vault. If the second step fails, the database has a password nobody knows. Reverse the order and you get a window where Key Vault holds a password the database doesn't accept yet. With one credential, there's no ordering that avoids a gap.

That's why I prefer **dual credentials** wherever the target supports them. Storage accounts have two keys, many SaaS APIs allow two active tokens, and you can create two SQL logins. You rotate the *inactive* one, write it to Key Vault, then let consumers move over. Microsoft has a [dual-credential version of the tutorial](https://learn.microsoft.com/azure/key-vault/secrets/tutorial-rotation-dual) for storage account keys. Single-credential rotation is acceptable when consumers re-read the secret on failure and you can tolerate a brief error spike. Make that a deliberate choice, not an accident.

When *not* to rotate automatically: secrets whose consumers cache them for the process lifetime, with no reload path. Rotating those just schedules an outage. Fix the consumer first. With App Service, [Key Vault references](https://learn.microsoft.com/azure/app-service/app-service-key-vault-references) don't help here yet: they must name a specific secret version, so every rotation also means updating the app setting (or having the rotation Function do it). With your own code, use a reload interval on the configuration provider.

## Watch the denials, not just the reads

Turn on diagnostic settings for every vault and send `AuditEvent` logs to Log Analytics. The query I actually use looks for 403s, because a spike in denied requests is either a broken deployment or someone probing:

```kusto
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.KEYVAULT"
| where TimeGenerated > ago(24h)
| where httpStatusCode_d == 403
| summarize Denied = count(), Operations = make_set(OperationName)
    by Resource, identity_claim_appid_g, CallerIPAddress
| order by Denied desc
```

After an RBAC switch-over, this query tells you within minutes which identity you forgot to assign a role to.

## What I'd do this quarter

If you own a Key Vault estate, this is the order I'd work in:

1. **Inventory shared vaults** and split the ones holding secrets for unrelated apps.
2. **Audit who holds Contributor** on vaults that still use access policies, because those people can read your secrets.
3. **Check your pipelines for soft-delete assumptions**: create-after-delete, reused names, scripts that expect delete to be final.
4. **Turn on purge protection in production**, especially anywhere a customer-managed key lives.
5. **Put expiry dates on rotatable secrets** and subscribe to `SecretNearExpiry`, even if the first handler only raises an alert.
6. **Pilot RBAC on a new vault** now, and plan the migration of existing ones for when it reaches GA.

None of this is exotic. It's unglamorous decisions, made once and written into the templates every team starts from.
