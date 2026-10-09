---
title: Disaster Recovery with Azure Site Recovery
description: "Disaster recovery is the topic everyone agrees is important and nobody wants to be assigned. ASR is the service that turns \"we should test my DR\" from a…"
author: Michael John Pena
draft: false
date: 2021-01-30
url: /blog/azure-site-recovery-dr/
tags:
  - Azure
  - Site Recovery
  - Disaster Recovery
  - Business Continuity
  - High Availability
---

Disaster recovery is the topic everyone agrees is important and nobody wants to be assigned. ASR is the service that turns "we should test my DR" from a six-month project into a recovery plan you can actually run on a Tuesday afternoon. Replicate VMs cross-region, define a recovery plan that orders the dependencies, and—the part most teams skip—run a non-disruptive test failover quarterly. Today's post is the end-to-end implementation, plus the automation I bolt on so the DR drill happens whether or not anyone remembers.

## Understanding Azure Site Recovery

ASR provides:
- **Replication**: Continuous replication of VMs and physical servers
- **Failover**: Automated or manual failover to secondary region
- **Failback**: Return to primary region when recovered
- **DR Drills**: Test failovers without impacting production

## Architecture for Multi-Region DR

```bicep
// Primary Region Resources
module primaryInfra 'modules/infrastructure.bicep' = {
  name: 'primaryInfra'
  params: {
    location: primaryLocation
    environmentName: 'primary'
    vnetAddressSpace: '10.0.0.0/16'
  }
}

// Secondary Region Resources (DR Site)
module secondaryInfra 'modules/infrastructure.bicep' = {
  name: 'secondaryInfra'
  params: {
    location: secondaryLocation
    environmentName: 'dr'
    vnetAddressSpace: '10.1.0.0/16'
  }
}

// Recovery Services Vault in DR region
resource recoveryVault 'Microsoft.RecoveryServices/vaults@2021-08-01' = {
  name: 'rsv-dr-${secondaryLocation}'
  location: secondaryLocation
  sku: {
    name: 'RS0'
    tier: 'Standard'
  }
  properties: {}
}

// Replication Policy
resource replicationPolicy 'Microsoft.RecoveryServices/vaults/replicationPolicies@2021-08-01' = {
  parent: recoveryVault
  name: 'vm-replication-policy'
  properties: {
    providerSpecificInput: {
      instanceType: 'A2A'
      multiVmSyncStatus: 'Enable'
      appConsistentFrequencyInMinutes: 60
      crashConsistentFrequencyInMinutes: 5
      recoveryPointHistory: 1440  // 24 hours
    }
  }
}

// VNet Peering for replication traffic
resource primaryToSecondaryPeering 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2021-05-01' = {
  name: '${primaryInfra.outputs.vnetName}/primary-to-dr'
  properties: {
    remoteVirtualNetwork: {
      id: secondaryInfra.outputs.vnetId
    }
    allowVirtualNetworkAccess: true
    allowForwardedTraffic: true
    allowGatewayTransit: false
    useRemoteGateways: false
  }
}
```

## Enabling Replication

### PowerShell Automation

```powershell
# Enable replication for Azure VMs

param(
    [string]$SourceResourceGroup,
    [string]$SourceVMName,
    [string]$TargetResourceGroup,
    [string]$RecoveryVaultName,
    [string]$RecoveryVaultRG,
    [string]$TargetVNetName,
    [string]$TargetSubnetName,
    [string]$ReplicationPolicyName,
    [string]$TargetStorageAccountId
)

# Get the vault
$vault = Get-AzRecoveryServicesVault `
    -Name $RecoveryVaultName `
    -ResourceGroupName $RecoveryVaultRG

Set-AzRecoveryServicesAsrVaultContext -Vault $vault

# Get the source VM
$sourceVM = Get-AzVM -ResourceGroupName $SourceResourceGroup -Name $SourceVMName

# Get replication fabric (source region)
$primaryFabric = Get-AzRecoveryServicesAsrFabric |
    Where-Object { $_.FabricSpecificDetails.Location -eq $sourceVM.Location }

if (-not $primaryFabric) {
    # Create fabric for source region
    $primaryFabric = New-AzRecoveryServicesAsrFabric `
        -Azure `
        -Name "fabric-$($sourceVM.Location)" `
        -Location $sourceVM.Location
}

# Get or create protection container
$primaryContainer = Get-AzRecoveryServicesAsrProtectionContainer `
    -Fabric $primaryFabric |
    Where-Object { $_.FriendlyName -like "*$($sourceVM.Location)*" }

if (-not $primaryContainer) {
    $primaryContainer = New-AzRecoveryServicesAsrProtectionContainer `
        -Name "container-$($sourceVM.Location)" `
        -Fabric $primaryFabric
}

# Get target fabric and container (DR region)
$targetLocation = "westus2"  # DR region
$targetFabric = Get-AzRecoveryServicesAsrFabric |
    Where-Object { $_.FabricSpecificDetails.Location -eq $targetLocation }

$targetContainer = Get-AzRecoveryServicesAsrProtectionContainer `
    -Fabric $targetFabric

# Get replication policy
$policy = Get-AzRecoveryServicesAsrPolicy -Name $ReplicationPolicyName

# Create container mapping
$containerMapping = Get-AzRecoveryServicesAsrProtectionContainerMapping `
    -ProtectionContainer $primaryContainer |
    Where-Object { $_.PolicyFriendlyName -eq $ReplicationPolicyName }

if (-not $containerMapping) {
    $containerMapping = New-AzRecoveryServicesAsrProtectionContainerMapping `
        -Name "mapping-$($sourceVM.Location)-to-$targetLocation" `
        -Policy $policy `
        -PrimaryProtectionContainer $primaryContainer `
        -RecoveryProtectionContainer $targetContainer
}

# Get target network
$targetVNet = Get-AzVirtualNetwork `
    -Name $TargetVNetName `
    -ResourceGroupName $TargetResourceGroup

$targetSubnet = $targetVNet.Subnets |
    Where-Object { $_.Name -eq $TargetSubnetName }

# Enable replication
$diskConfigs = @()
foreach ($disk in $sourceVM.StorageProfile.OsDisk, $sourceVM.StorageProfile.DataDisks) {
    if ($disk) {
        $diskConfigs += New-AzRecoveryServicesAsrAzureToAzureDiskReplicationConfig `
            -ManagedDisk `
            -LogStorageAccountId $TargetStorageAccountId `
            -DiskId $disk.ManagedDisk.Id `
            -RecoveryResourceGroupId "/subscriptions/$((Get-AzContext).Subscription.Id)/resourceGroups/$TargetResourceGroup" `
            -RecoveryReplicaDiskAccountType "Premium_LRS" `
            -RecoveryTargetDiskAccountType "Premium_LRS"
    }
}

$job = New-AzRecoveryServicesAsrReplicationProtectedItem `
    -AzureToAzure `
    -AzureVmId $sourceVM.Id `
    -Name "$SourceVMName-asr" `
    -ProtectionContainerMapping $containerMapping `
    -AzureToAzureDiskReplicationConfiguration $diskConfigs `
    -RecoveryResourceGroupId "/subscriptions/$((Get-AzContext).Subscription.Id)/resourceGroups/$TargetResourceGroup" `
    -RecoveryAzureNetworkId $targetVNet.Id `
    -RecoveryAzureSubnetName $TargetSubnetName

Write-Host "Replication enabled. Job ID: $($job.Name)"
```

## Recovery Plans

Create recovery plans for orchestrated failover:

```json
{
  "name": "ecommerce-recovery-plan",
  "properties": {
    "primaryFabricId": "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.RecoveryServices/vaults/{vault}/replicationFabrics/fabric-eastus",
    "recoveryFabricId": "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.RecoveryServices/vaults/{vault}/replicationFabrics/fabric-westus2",
    "failoverDeploymentModel": "ResourceManager",
    "groups": [
      {
        "groupType": "Boot",
        "replicationProtectedItems": [],
        "startGroupActions": [
          {
            "actionName": "Pre-Failover-Script",
            "failoverTypes": ["PlannedFailover", "UnplannedFailover"],
            "failoverDirections": ["PrimaryToRecovery"],
            "customDetails": {
              "instanceType": "AutomationRunbookActionDetails",
              "runbookId": "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Automation/automationAccounts/{account}/runbooks/PreFailoverChecks",
              "fabricLocation": "Primary"
            }
          }
        ]
      },
      {
        "groupType": "Boot",
        "replicationProtectedItems": [
          {
            "id": "/subscriptions/{sub}/.../replicationProtectedItems/sql-server-asr"
          }
        ],
        "startGroupActions": [],
        "endGroupActions": [
          {
            "actionName": "Wait-For-SQL",
            "failoverTypes": ["PlannedFailover", "UnplannedFailover"],
            "customDetails": {
              "instanceType": "ManualActionDetails",
              "description": "Verify SQL Server is healthy and databases are online"
            }
          }
        ]
      },
      {
        "groupType": "Boot",
        "replicationProtectedItems": [
          {
            "id": "/subscriptions/{sub}/.../replicationProtectedItems/app-server-1-asr"
          },
          {
            "id": "/subscriptions/{sub}/.../replicationProtectedItems/app-server-2-asr"
          }
        ],
        "startGroupActions": [],
        "endGroupActions": []
      },
      {
        "groupType": "Boot",
        "replicationProtectedItems": [
          {
            "id": "/subscriptions/{sub}/.../replicationProtectedItems/web-server-asr"
          }
        ],
        "startGroupActions": [],
        "endGroupActions": [
          {
            "actionName": "Update-DNS",
            "failoverTypes": ["PlannedFailover", "UnplannedFailover"],
            "customDetails": {
              "instanceType": "AutomationRunbookActionDetails",
              "runbookId": "/subscriptions/{sub}/.../runbooks/UpdateDNSRecords"
            }
          }
        ]
      }
    ]
  }
}
```

## Automation Runbooks

### Pre-Failover Validation

```powershell
# PreFailoverChecks.ps1

param(
    [object]$RecoveryPlanContext
)

Write-Output "Starting pre-failover checks..."

$failoverType = $RecoveryPlanContext.FailoverType
$failoverDirection = $RecoveryPlanContext.FailoverDirection

# Check 1: Verify DR region capacity
$drRegion = "westus2"
$requiredVMSize = "Standard_D4s_v3"

$skuAvailability = Get-AzComputeResourceSku -Location $drRegion |
    Where-Object { $_.Name -eq $requiredVMSize } |
    Select-Object -ExpandProperty Restrictions

if ($skuAvailability) {
    Write-Error "Required VM SKU $requiredVMSize has restrictions in $drRegion"
    throw "Capacity check failed"
}

Write-Output "Capacity check passed"

# Check 2: Verify network connectivity
$targetVNet = Get-AzVirtualNetwork -Name "vnet-dr" -ResourceGroupName "rg-dr"
if (-not $targetVNet) {
    Write-Error "Target VNet not found"
    throw "Network check failed"
}

Write-Output "Network check passed"

# Check 3: Verify storage accounts
$storageAccount = Get-AzStorageAccount -ResourceGroupName "rg-dr" -Name "drbootdiag"
if ($storageAccount.ProvisioningState -ne "Succeeded") {
    Write-Error "Storage account not ready"
    throw "Storage check failed"
}

Write-Output "Storage check passed"

# Check 4: Verify DNS zone
$dnsZone = Get-AzDnsZone -Name "myapp.com" -ResourceGroupName "rg-dns"
if (-not $dnsZone) {
    Write-Error "DNS zone not found"
    throw "DNS check failed"
}

Write-Output "DNS check passed"

Write-Output "All pre-failover checks passed successfully"
```

### Post-Failover DNS Update

```powershell
# UpdateDNSRecords.ps1

param(
    [object]$RecoveryPlanContext
)

Write-Output "Updating DNS records post-failover..."

$dnsZoneName = "myapp.com"
$dnsResourceGroup = "rg-dns"

# Get the new IP addresses of failed-over VMs
$vmGroup = $RecoveryPlanContext.VmMap

foreach ($vmId in $vmGroup.Keys) {
    $vmInfo = $vmGroup[$vmId]
    $vmName = $vmInfo.RoleName

    # Get the new VM
    $vm = Get-AzVM | Where-Object { $_.Name -like "*$vmName*" }
    $nic = Get-AzNetworkInterface -ResourceId $vm.NetworkProfile.NetworkInterfaces[0].Id
    $privateIP = $nic.IpConfigurations[0].PrivateIpAddress

    # Update A record
    $recordSetName = $vmName.ToLower()

    $existingRecord = Get-AzDnsRecordSet `
        -ZoneName $dnsZoneName `
        -ResourceGroupName $dnsResourceGroup `
        -Name $recordSetName `
        -RecordType A `
        -ErrorAction SilentlyContinue

    if ($existingRecord) {
        $existingRecord.Records.Clear()
        $existingRecord.Records.Add([Microsoft.Azure.Management.Dns.Models.ARecord]::new($privateIP))
        Set-AzDnsRecordSet -RecordSet $existingRecord
        Write-Output "Updated DNS record for $vmName to $privateIP"
    } else {
        New-AzDnsRecordSet `
            -ZoneName $dnsZoneName `
            -ResourceGroupName $dnsResourceGroup `
            -Name $recordSetName `
            -RecordType A `
            -Ttl 300 `
            -DnsRecords (New-AzDnsRecordConfig -IPv4Address $privateIP)
        Write-Output "Created DNS record for $vmName with IP $privateIP"
    }
}

# Update Traffic Manager if used
$tmProfile = Get-AzTrafficManagerProfile -Name "tm-myapp" -ResourceGroupName "rg-traffic"
if ($tmProfile) {
    $drEndpoint = $tmProfile.Endpoints | Where-Object { $_.Name -eq "dr-endpoint" }
    $drEndpoint.EndpointStatus = "Enabled"

    $primaryEndpoint = $tmProfile.Endpoints | Where-Object { $_.Name -eq "primary-endpoint" }
    $primaryEndpoint.EndpointStatus = "Disabled"

    Set-AzTrafficManagerProfile -TrafficManagerProfile $tmProfile
    Write-Output "Updated Traffic Manager endpoints"
}

Write-Output "DNS update completed"
```

## Monitoring Replication Health

```csharp
using Azure.ResourceManager.RecoveryServices;

public class ASRMonitoringService
{
    public async Task<ReplicationHealthReport> GetReplicationHealthAsync(
        string vaultName,
        string resourceGroup)
    {
        var report = new ReplicationHealthReport
        {
            GeneratedAt = DateTime.UtcNow
        };

        var subscription = await _armClient.GetDefaultSubscriptionAsync();
        var vault = await subscription
            .GetResourceGroups()
            .Get(resourceGroup)
            .Value
            .GetRecoveryServicesVaults()
            .GetAsync(vaultName);

        // Get all protected items
        var protectedItems = vault.Value.GetReplicationProtectedItems();

        await foreach (var item in protectedItems)
        {
            var itemHealth = new ProtectedItemHealth
            {
                Name = item.Data.Properties.FriendlyName,
                ReplicationHealth = item.Data.Properties.ReplicationHealth,
                FailoverHealth = item.Data.Properties.FailoverHealth,
                ProtectionState = item.Data.Properties.ProtectionState,
                LastRpoCalculatedTime = item.Data.Properties.LastRpoCalculatedTime,
                RpoInSeconds = item.Data.Properties.RpoInSeconds
            };

            // Check for health issues
            if (item.Data.Properties.ReplicationHealth != "Normal")
            {
                itemHealth.Issues.AddRange(
                    item.Data.Properties.ReplicationHealthErrors?.Select(e =>
                        new HealthIssue
                        {
                            ErrorCode = e.ErrorCode,
                            ErrorMessage = e.ErrorMessage,
                            PossibleCauses = e.PossibleCauses,
                            RecommendedAction = e.RecommendedAction
                        }) ?? Enumerable.Empty<HealthIssue>()
                );
            }

            // RPO breach check (threshold: 30 minutes)
            if (item.Data.Properties.RpoInSeconds > 1800)
            {
                itemHealth.Warnings.Add(
                    $"RPO exceeded threshold: {item.Data.Properties.RpoInSeconds / 60} minutes");
            }

            report.ProtectedItems.Add(itemHealth);
        }

        // Get recovery plan health
        var recoveryPlans = vault.Value.GetRecoveryPlans();
        await foreach (var plan in recoveryPlans)
        {
            report.RecoveryPlans.Add(new RecoveryPlanHealth
            {
                Name = plan.Data.Properties.FriendlyName,
                ProviderSpecificDetails = plan.Data.Properties.ProviderSpecificDetails,
                LastTestFailoverTime = plan.Data.Properties.LastTestFailoverTime
            });

            // Warn if test failover hasn't been done recently
            if (plan.Data.Properties.LastTestFailoverTime == null ||
                plan.Data.Properties.LastTestFailoverTime < DateTime.UtcNow.AddDays(-30))
            {
                report.Warnings.Add(
                    $"Recovery plan '{plan.Data.Properties.FriendlyName}' hasn't been tested in 30+ days");
            }
        }

        return report;
    }
}
```

## Test Failover Automation

```powershell
# Automated DR drill script

param(
    [string]$VaultName,
    [string]$VaultResourceGroup,
    [string]$RecoveryPlanName,
    [string]$TestNetworkId,
    [switch]$CleanupAfterTest
)

$vault = Get-AzRecoveryServicesVault -Name $VaultName -ResourceGroupName $VaultResourceGroup
Set-AzRecoveryServicesAsrVaultContext -Vault $vault

$recoveryPlan = Get-AzRecoveryServicesAsrRecoveryPlan -Name $RecoveryPlanName

Write-Host "Starting test failover for recovery plan: $RecoveryPlanName"

# Start test failover
$testFailoverJob = Start-AzRecoveryServicesAsrTestFailoverJob `
    -RecoveryPlan $recoveryPlan `
    -Direction PrimaryToRecovery `
    -AzureVMNetworkId $TestNetworkId

# Wait for completion
do {
    $testFailoverJob = Get-AzRecoveryServicesAsrJob -Job $testFailoverJob
    Write-Host "Test failover status: $($testFailoverJob.State)"
    Start-Sleep -Seconds 30
} while ($testFailoverJob.State -eq "InProgress")

if ($testFailoverJob.State -eq "Succeeded") {
    Write-Host "Test failover completed successfully"

    # Run validation tests
    Write-Host "Running validation tests..."

    # Get test VMs
    $testVMs = Get-AzVM -ResourceGroupName "*-asr" |
        Where-Object { $_.Name -like "*test*" }

    foreach ($vm in $testVMs) {
        # Test VM connectivity
        $vmStatus = Get-AzVM -ResourceGroupName $vm.ResourceGroupName -Name $vm.Name -Status
        $powerState = $vmStatus.Statuses |
            Where-Object { $_.Code -like "PowerState/*" }

        if ($powerState.Code -eq "PowerState/running") {
            Write-Host "VM $($vm.Name) is running - PASS"
        } else {
            Write-Host "VM $($vm.Name) is not running - FAIL"
        }
    }

    if ($CleanupAfterTest) {
        Write-Host "Cleaning up test failover..."

        $cleanupJob = Start-AzRecoveryServicesAsrTestFailoverCleanupJob `
            -RecoveryPlan $recoveryPlan `
            -Comment "Automated DR drill completed"

        do {
            $cleanupJob = Get-AzRecoveryServicesAsrJob -Job $cleanupJob
            Start-Sleep -Seconds 10
        } while ($cleanupJob.State -eq "InProgress")

        Write-Host "Cleanup completed"
    }
} else {
    Write-Error "Test failover failed: $($testFailoverJob.StateDescription)"
}

# Generate report
$report = @{
    DrillDate = Get-Date
    RecoveryPlan = $RecoveryPlanName
    Result = $testFailoverJob.State
    Duration = (New-TimeSpan -Start $testFailoverJob.StartTime -End $testFailoverJob.EndTime).TotalMinutes
}

$report | ConvertTo-Json | Out-File "dr-drill-report-$(Get-Date -Format 'yyyyMMdd').json"
```

## Best Practices

1. **Regular Testing**: Perform test failovers at least quarterly
2. **Recovery Plans**: Create plans for application-consistent failover
3. **Automation**: Use runbooks for pre/post-failover tasks
4. **Monitoring**: Set up alerts for replication health issues
5. **RPO/RTO Targets**: Define and monitor against business requirements
6. **Documentation**: Maintain runbooks for manual failover steps
7. **Network Planning**: Ensure IP address and DNS strategies are documented

Azure Site Recovery provides enterprise-grade disaster recovery capabilities. Combined with proper planning, automation, and regular testing, it ensures business continuity when disaster strikes.
