---
title: Secure Data Sharing with Azure Data Share
author: Michael John Peña
draft: false
date: 2021-07-07
url: /blog/azure-data-share/
tags:
  - Azure
  - Data
  - Data Share
  - Collaboration
  - Governance

---

I wrote "2021-07-07-azure-data-share" to share practical, production-minded guidance on this topic.

# Creating a Data Share Account

Set up the data sharing infrastructure:

```bash
# Create resource group
az group create --name rg-datashare --location eastus

# Create Data Share account
az datashare account create \
    --resource-group rg-datashare \
    --name datashare-enterprise \
    --location eastus

# Create a share
az datashare share create \
    --resource-group rg-datashare \
    --account-name datashare-enterprise \
    --name partner-analytics-share \
    --share-kind CopyBased \
    --description "Analytics data for partner integration"
```

# Adding Datasets to Share

Configure datasets to be shared:

```python
from azure.mgmt.datashare import DataShareManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
client = DataShareManagementClient(credential, subscription_id)

# Add Blob storage dataset
blob_dataset = {
    "kind": "Blob",
    "properties": {
        "containerName": "analytics-output",
        "storageAccountName": "analyticstorage",
        "resourceGroup": "rg-analytics",
        "subscriptionId": subscription_id,
        "filePath": "reports/daily/"
    }
}

client.data_sets.create(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="partner-analytics-share",
    data_set_name="daily-reports",
    data_set=blob_dataset
)

# Add ADLS Gen2 dataset
adls_dataset = {
    "kind": "AdlsGen2File",
    "properties": {
        "fileSystemName": "curated",
        "filePath": "shared/partner-data/",
        "storageAccountName": "datalakegen2",
        "resourceGroup": "rg-datalake",
        "subscriptionId": subscription_id
    }
}

client.data_sets.create(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="partner-analytics-share",
    data_set_name="partner-curated-data",
    data_set=adls_dataset
)

# Add SQL Database dataset
sql_dataset = {
    "kind": "SqlDBTable",
    "properties": {
        "databaseName": "AnalyticsDB",
        "tableName": "PartnerMetrics",
        "sqlServerResourceId": f"/subscriptions/{subscription_id}/resourceGroups/rg-sql/providers/Microsoft.Sql/servers/sqlserver-analytics"
    }
}

client.data_sets.create(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="partner-analytics-share",
    data_set_name="partner-metrics-table",
    data_set=sql_dataset
)
```

# Creating Share Invitations

Invite consumers to access shared data:

```python
# Create invitation for partner
invitation = {
    "properties": {
        "targetEmail": "data-team@partner.com",
        "targetActiveDirectoryId": None,  # Use email-based invitation
        "targetObjectId": None
    }
}

client.invitations.create(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="partner-analytics-share",
    invitation_name="partner-invitation",
    invitation=invitation
)

# Create invitation for internal team using AAD
internal_invitation = {
    "properties": {
        "targetActiveDirectoryId": "tenant-id",
        "targetObjectId": "user-or-group-object-id"
    }
}

client.invitations.create(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="partner-analytics-share",
    invitation_name="internal-team-invitation",
    invitation=internal_invitation
)

# List all invitations
invitations = client.invitations.list_by_share(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="partner-analytics-share"
)

for inv in invitations:
    print(f"Invitation: {inv.name}, Status: {inv.invitation_status}")
```

# Configuring Snapshot Schedules

Set up automated data synchronization:

```python
# Create snapshot schedule
schedule = {
    "properties": {
        "recurrenceInterval": "Day",
        "synchronizationTime": "2021-07-07T02:00:00Z"
    }
}

client.share_synchronization_settings.create(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="partner-analytics-share",
    synchronization_setting_name="daily-sync",
    synchronization_setting=schedule
)

# Create hourly schedule for real-time needs
hourly_schedule = {
    "properties": {
        "recurrenceInterval": "Hour",
        "synchronizationTime": "2021-07-07T00:00:00Z"
    }
}

client.share_synchronization_settings.create(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="partner-analytics-share",
    synchronization_setting_name="hourly-sync",
    synchronization_setting=hourly_schedule
)
```

# Consumer Side: Accepting Share Invitations

On the consumer side, accept and configure the share:

```python
# Consumer creates their Data Share account
consumer_client = DataShareManagementClient(consumer_credential, consumer_subscription_id)

# Accept invitation and create share subscription
share_subscription = {
    "properties": {
        "invitationId": "/subscriptions/.../invitations/partner-invitation",
        "sourceShareLocation": "eastus"
    }
}

consumer_client.share_subscriptions.create(
    resource_group_name="rg-consumer-datashare",
    account_name="consumer-datashare-account",
    share_subscription_name="partner-data-subscription",
    share_subscription=share_subscription
)

# Map source datasets to consumer storage
dataset_mapping = {
    "kind": "AdlsGen2File",
    "properties": {
        "dataSetId": "source-dataset-id",
        "fileSystemName": "received-data",
        "filePath": "partner-analytics/",
        "storageAccountName": "consumerdatalake",
        "resourceGroup": "rg-consumer-storage",
        "subscriptionId": consumer_subscription_id
    }
}

consumer_client.data_set_mappings.create(
    resource_group_name="rg-consumer-datashare",
    account_name="consumer-datashare-account",
    share_subscription_name="partner-data-subscription",
    data_set_mapping_name="analytics-mapping",
    data_set_mapping=dataset_mapping
)
```

# Triggering Synchronization

Manually trigger or monitor sync operations:

```python
# Trigger synchronization
sync_result = consumer_client.share_subscriptions.synchronize(
    resource_group_name="rg-consumer-datashare",
    account_name="consumer-datashare-account",
    share_subscription_name="partner-data-subscription",
    synchronize={"synchronization_mode": "FullSync"}
)

# Monitor sync status
def monitor_sync(client, rg, account, subscription_name):
    syncs = client.share_subscription_synchronizations.list(
        resource_group_name=rg,
        account_name=account,
        share_subscription_name=subscription_name
    )

    for sync in syncs:
        print(f"Sync ID: {sync.synchronization_id}")
        print(f"  Status: {sync.status}")
        print(f"  Start: {sync.start_time}")
        print(f"  End: {sync.end_time}")
        print(f"  Files Read: {sync.files_read}")
        print(f"  Files Written: {sync.files_written}")
        print(f"  Size Copied: {sync.size_copied} bytes")

monitor_sync(
    consumer_client,
    "rg-consumer-datashare",
    "consumer-datashare-account",
    "partner-data-subscription"
)
```

# In-Place Sharing with Synapse

Configure in-place sharing for Synapse Analytics:

```python
# Create in-place share for Synapse
synapse_share = {
    "kind": "InPlace"
}

client.shares.create(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="synapse-inplace-share",
    share=synapse_share
)

# Add Synapse SQL Pool dataset for in-place sharing
synapse_dataset = {
    "kind": "SynapseWorkspaceSqlPoolTable",
    "properties": {
        "synapseWorkspaceSqlPoolTableResourceId": f"/subscriptions/{subscription_id}/resourceGroups/rg-synapse/providers/Microsoft.Synapse/workspaces/synapse-ws/sqlPools/DedicatedPool/schemas/dbo/tables/SharedData"
    }
}

client.data_sets.create(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="synapse-inplace-share",
    data_set_name="synapse-shared-table",
    data_set=synapse_dataset
)
```

# Monitoring and Auditing

Track sharing activity and usage:

```python
from azure.mgmt.monitor import MonitorManagementClient

monitor_client = MonitorManagementClient(credential, subscription_id)

# Get activity logs for data share operations
logs = monitor_client.activity_logs.list(
    filter=f"eventTimestamp ge '2021-07-01' and resourceProvider eq 'Microsoft.DataShare'"
)

for log in logs:
    print(f"Operation: {log.operation_name.localized_value}")
    print(f"  Time: {log.event_timestamp}")
    print(f"  Status: {log.status.value}")
    print(f"  Caller: {log.caller}")
    print()

# Set up diagnostic settings for detailed logging
diagnostic_settings = {
    "logs": [
        {
            "category": "Shares",
            "enabled": True,
            "retentionPolicy": {
                "enabled": True,
                "days": 90
            }
        },
        {
            "category": "ShareSubscriptions",
            "enabled": True,
            "retentionPolicy": {
                "enabled": True,
                "days": 90
            }
        },
        {
            "category": "SentShareSnapshots",
            "enabled": True,
            "retentionPolicy": {
                "enabled": True,
                "days": 90
            }
        }
    ],
    "workspaceId": "/subscriptions/.../workspaces/log-analytics-ws"
}
```

# Revoking Access

Manage and revoke share access:

```python
# Revoke invitation
client.invitations.delete(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="partner-analytics-share",
    invitation_name="partner-invitation"
)

# List active share subscriptions
subscriptions = client.provider_share_subscriptions.list_by_share(
    resource_group_name="rg-datashare",
    account_name="datashare-enterprise",
    share_name="partner-analytics-share"
)

for sub in subscriptions:
    print(f"Consumer: {sub.consumer_email}")
    print(f"  Status: {sub.share_subscription_status}")
    print(f"  Created: {sub.created_at}")

    # Revoke specific subscription
    if sub.consumer_email == "revoked@partner.com":
        client.provider_share_subscriptions.revoke(
            resource_group_name="rg-datashare",
            account_name="datashare-enterprise",
            share_name="partner-analytics-share",
            provider_share_subscription_id=sub.share_subscription_object_id
        )
```

# Conclusion

Azure Data Share provides a secure, governed way to share data across organizational boundaries. Whether you need snapshot-based sharing for periodic data transfers or in-place sharing for real-time access, Data Share handles the complexity while maintaining security and compliance.

The centralized management, automated synchronization, and detailed auditing make it ideal for B2B data sharing scenarios, internal data distribution, and data monetization use cases. Start using Azure Data Share to enable secure data collaboration with your partners and customers.

