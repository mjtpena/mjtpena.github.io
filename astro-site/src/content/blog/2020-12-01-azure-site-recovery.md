---
title: "Azure Site Recovery: Disaster Recovery as a Service"
author: Michael John Peña
draft: false
date: 2020-12-01
tags:
  - Azure
  - Site Recovery
  - Disaster Recovery
  - Business Continuity
---

DR planning is the part of every project that gets bumped to "Sprint 9" and then to "next quarter." ASR is good enough that it makes the bump indefensible. Replicate VMs into Azure (or between regions), test failover non-disruptively, and prove your RPO/RTO with an actual drill instead of a spreadsheet promise. I've used it for both lift-and-shift DR and intra-Azure region failover; the runbooks part is what sells it to operations teams.

## Replication Scenarios

| Source | Destination |
|--------|-------------|
| Azure VMs | Another Azure region |
| VMware VMs | Azure |
| Hyper-V VMs | Azure |
| Physical servers | Azure |
| AWS EC2 | Azure |

## Azure-to-Azure DR

```bash
# Enable replication for Azure VM
az site-recovery replication-protected-item create \
    --resource-group myRG \
    --vault-name my-asr-vault \
    --fabric-name azure-eastus \
    --protection-container eastus-container \
    --name myVM-asr \
    --policy-id /subscriptions/.../replicationPolicies/24-hour-retention \
    --provider-specific-details '{
        "instanceType": "A2A",
        "fabricObjectId": "/subscriptions/.../virtualMachines/myVM",
        "recoveryResourceGroupId": "/subscriptions/.../resourceGroups/dr-rg",
        "recoveryCloudServiceId": null,
        "recoveryAvailabilitySetId": null,
        "recoveryAzureNetworkId": "/subscriptions/.../virtualNetworks/dr-vnet"
    }'
```

## Replication Policy

```json
{
    "name": "24HourRetention",
    "properties": {
        "recoveryPointRetentionInHours": 24,
        "applicationConsistentSnapshotFrequencyInHours": 4,
        "multiVmSyncStatus": "Enabled"
    }
}
```

## Recovery Plans

```json
{
    "name": "FullStackRecovery",
    "properties": {
        "primaryFabricId": "/Subscriptions/.../replicationFabrics/eastus",
        "recoveryFabricId": "/Subscriptions/.../replicationFabrics/westus",
        "failoverDeploymentModel": "ResourceManager",
        "groups": [
            {
                "groupType": "Shutdown",
                "replicationProtectedItems": []
            },
            {
                "groupType": "Boot",
                "replicationProtectedItems": [
                    { "id": "/...db-server-asr" }
                ],
                "startGroupActions": [
                    {
                        "actionName": "WaitForDBReady",
                        "failoverTypes": ["PlannedFailover", "UnplannedFailover"],
                        "failoverDirections": ["PrimaryToRecovery"],
                        "customDetails": {
                            "instanceType": "ScriptActionDetails",
                            "path": "scripts/wait-db.ps1",
                            "timeout": "PT10M"
                        }
                    }
                ]
            },
            {
                "groupType": "Boot",
                "replicationProtectedItems": [
                    { "id": "/...web-server-1-asr" },
                    { "id": "/...web-server-2-asr" }
                ]
            }
        ]
    }
}
```

## Test Failover

```bash
# Test failover (non-disruptive)
az site-recovery replication-protected-item test-failover \
    --resource-group myRG \
    --vault-name my-asr-vault \
    --fabric-name azure-eastus \
    --protection-container eastus-container \
    --name myVM-asr \
    --failover-direction PrimaryToRecovery \
    --network-id /subscriptions/.../virtualNetworks/test-vnet
```

## Planned Failover

```bash
# Planned failover (with data sync)
az site-recovery replication-protected-item planned-failover \
    --resource-group myRG \
    --vault-name my-asr-vault \
    --fabric-name azure-eastus \
    --protection-container eastus-container \
    --name myVM-asr \
    --failover-direction PrimaryToRecovery
```

## Unplanned Failover

```bash
# Emergency failover
az site-recovery replication-protected-item unplanned-failover \
    --resource-group myRG \
    --vault-name my-asr-vault \
    --fabric-name azure-eastus \
    --protection-container eastus-container \
    --name myVM-asr \
    --failover-direction PrimaryToRecovery \
    --source-site-operations NotRequired
```

## Commit and Reprotect

```bash
# Commit failover
az site-recovery replication-protected-item commit \
    --resource-group myRG \
    --vault-name my-asr-vault \
    --fabric-name azure-westus \
    --protection-container westus-container \
    --name myVM-asr

# Reprotect (reverse replication)
az site-recovery replication-protected-item reprotect \
    --resource-group myRG \
    --vault-name my-asr-vault \
    --fabric-name azure-westus \
    --protection-container westus-container \
    --name myVM-asr
```

## Monitoring

```kusto
// ASR events in Log Analytics
AzureDiagnostics
| where Category == "AzureSiteRecoveryReplicatedItems"
| where replicationHealth_s != "Normal"
| project TimeGenerated, Resource, replicationHealth_s, failoverHealth_s
| order by TimeGenerated desc
```

## RTO/RPO

| Metric | Target |
|--------|--------|
| RPO | Near-zero (continuous replication) |
| RTO | Minutes (automated failover) |

Site Recovery: peace of mind for disaster recovery.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
