---
title: Automating Azure Site Recovery DR Drills with Recovery Plans
description: "Turn Azure Site Recovery recovery plans and Azure Automation runbooks into a scheduled, unattended DR drill that proves failover works and records evidence."
author: Michael John Pena
draft: false
date: 2021-01-30
url: /blog/azure-site-recovery-dr/
tags:
  - Azure
  - Site Recovery
  - Disaster Recovery
  - Business Continuity
  - Automation
  - PowerShell
---

Enabling replication in Azure Site Recovery takes an afternoon. Keeping the disaster recovery plan honest for the next three years is the hard part, because the plan rots: someone adds a VM that never makes it into the recovery plan, a subnet changes, a runbook still points at a DNS zone that was renamed. The only thing that catches that drift is a test failover, and a test failover that depends on someone remembering to run it doesn't happen, so the drill has to run itself.

I covered the ASR basics (replication scenarios, failover types, commit and reprotect) in [Azure Site Recovery: Disaster Recovery as a Service](/blog/2020-12-01-azure-site-recovery/). Here I'm assuming Azure-to-Azure replication is already running and focusing on three things: designing a recovery plan that can run unattended, writing runbooks that behave differently in a drill than in a real event, and scheduling the drill so it produces evidence rather than a calendar reminder.

## What a recovery plan gives you, and its rules

A recovery plan groups replicated machines so they fail over as one application. According to the [recovery plan overview](https://learn.microsoft.com/en-us/azure/site-recovery/recovery-plan-overview), a plan can hold up to 100 protected instances (the documented limit at the time of writing), machines in the same group start in parallel, and Group 2 doesn't start until every machine in Group 1 has failed over and started. You can have up to seven groups, and each group gets pre-actions and post-actions: either an Azure Automation runbook or a manual action.

A few rules from the [runbook integration docs](https://learn.microsoft.com/en-us/azure/site-recovery/site-recovery-runbook-automation) shape everything that follows:

- The Automation account can be in any region but must be in the **same subscription** as the Recovery Services vault.
- Runbooks in a plan run serially, in the order you set.
- The plan **keeps running even if a script fails**. A broken runbook doesn't stop the failover, which is the right call in a real disaster and a trap in a drill, because the drill "succeeds" while your DNS update quietly failed.
- A manual action pauses the plan until someone acknowledges it in the portal.
- The only input a runbook gets is the `RecoveryPlanContext` object. Anything else has to come from Automation variables or the script itself.

That last point and the "keeps running" rule are why most automated drills I see report green while proving very little. The fix is to design for them.

## Design the plan for unattended runs

| Decision | What I recommend | Why |
| --- | --- | --- |
| Group order | Data tier, then app tier, then web tier | The web tier shouldn't accept traffic before its dependencies are up |
| Manual actions | Scope them to Failover only, not Test failover (Planned failover doesn't apply to Azure-to-Azure plans) | A manual action in a test run suspends the job and the scheduled drill stalls |
| Runbook branching | Check `FailoverType` before touching shared infrastructure | A drill must never repoint production DNS |
| Pass/fail signal | Runbooks write failures to an Automation variable | The plan won't fail on a script error, so you need another channel |
| Test network | An isolated VNet in the DR region, not the replication target VNet | Avoids IP conflicts and accidental traffic from real clients |

When you add a manual action in the portal, you choose which failover types it applies to; the [recovery plan how-to](https://learn.microsoft.com/en-us/azure/site-recovery/site-recovery-create-recovery-plans) covers this. For an Azure-to-Azure plan the choices that matter are Test failover and Failover, so tick Failover and leave Test failover clear. "Confirm with the DBA that SQL is healthy" is a sensible gate in a real event and a blocker in a 2 a.m. scheduled drill. If the check matters in the drill too, automate it as a runbook instead.

## A runbook that knows it's in a drill

The context injected into each runbook carries `RecoveryPlanName`, `FailoverType` (`Test` for a drill), `FailoverDirection` (`PrimaryToSecondary` or `SecondaryToPrimary`), `GroupId`, and `VmMap`, keyed by a GUID per VM with `SubscriptionId`, `ResourceGroupName` and `RoleName` (the failed-over VM's name). `VmMap` only contains the VMs in the group the action is attached to, so attach this runbook as a post-action on each group whose VMs need DNS records.

This runbook checks that each failed-over VM is running and has a private IP. During a real failover it repoints an A record in an Azure Private DNS zone. During a test it doesn't touch DNS at all, and records any failure in an Automation variable the drill driver reads later. It authenticates with the Automation account's Run As connection. The Run As certificate is valid for one year, so renew it (or alert on its expiry) before it lapses; an expired certificate makes every scheduled drill fail at `Connect-AzAccount`, and nobody notices until the next audit.

```powershell
param (
    [parameter(Mandatory = $false)]
    [Object]$RecoveryPlanContext
)

$ErrorActionPreference = 'Stop'

# Authenticate with the Automation account's Run As connection
$conn = Get-AutomationConnection -Name 'AzureRunAsConnection'
Connect-AzAccount -ServicePrincipal `
    -Tenant $conn.TenantID `
    -ApplicationId $conn.ApplicationID `
    -CertificateThumbprint $conn.CertificateThumbprint | Out-Null

$planName = $RecoveryPlanContext.RecoveryPlanName
$isTest   = $RecoveryPlanContext.FailoverType -eq 'Test'

# Per-plan settings live in Automation variables prefixed with the plan name
$zoneName  = Get-AutomationVariable -Name "$planName-DnsZone"
$zoneRg    = Get-AutomationVariable -Name "$planName-DnsZoneRG"
$statusVar = "$planName-DrillStatus"

$vmMap = $RecoveryPlanContext.VmMap
$vmIds = $vmMap | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name
$failures = @()

foreach ($vmId in $vmIds) {
    $vmInfo = $vmMap.$vmId
    if (-not $vmInfo -or -not $vmInfo.ResourceGroupName -or -not $vmInfo.RoleName) {
        continue
    }

    Set-AzContext -SubscriptionId $vmInfo.SubscriptionId | Out-Null

    $status = Get-AzVM -ResourceGroupName $vmInfo.ResourceGroupName -Name $vmInfo.RoleName -Status
    $power  = ($status.Statuses | Where-Object { $_.Code -like 'PowerState/*' }).Code
    if ($power -ne 'PowerState/running') {
        $failures += "$($vmInfo.RoleName) is $power"
        continue
    }

    $vm  = Get-AzVM -ResourceGroupName $vmInfo.ResourceGroupName -Name $vmInfo.RoleName
    $nic = Get-AzNetworkInterface -ResourceId $vm.NetworkProfile.NetworkInterfaces[0].Id
    $ip  = $nic.IpConfigurations[0].PrivateIpAddress
    if (-not $ip) {
        $failures += "$($vmInfo.RoleName) has no private IP"
        continue
    }

    if ($isTest) {
        Write-Output "Test failover: $($vmInfo.RoleName) running at $ip, DNS left unchanged"
        continue
    }

    # Real failover: repoint the A record at the recovered VM
    $recordName = $vmInfo.RoleName.ToLower()
    $recordSet  = Get-AzPrivateDnsRecordSet -ZoneName $zoneName -ResourceGroupName $zoneRg `
        -Name $recordName -RecordType A
    foreach ($old in @($recordSet.Records)) {
        Remove-AzPrivateDnsRecordConfig -RecordSet $recordSet -Ipv4Address $old.Ipv4Address | Out-Null
    }
    Add-AzPrivateDnsRecordConfig -RecordSet $recordSet -Ipv4Address $ip | Out-Null
    Set-AzPrivateDnsRecordSet -RecordSet $recordSet | Out-Null
    Write-Output "Updated $recordName.$zoneName to $ip"
}

if ($failures.Count -gt 0) {
    $message = "FAILED (group $($RecoveryPlanContext.GroupId)): " + ($failures -join '; ')
    Set-AutomationVariable -Name $statusVar -Value $message
    throw $message
}
```

Create the three variables (`<plan>-DnsZone`, `<plan>-DnsZoneRG`, `<plan>-DrillStatus`) in the Automation account first; `Set-AutomationVariable` updates an existing variable but won't create one. The Automation account needs the Az.Accounts, Az.Compute, Az.Network and Az.PrivateDns modules imported. Many accounts still default to AzureRM modules, and Microsoft's own samples still use AzureRM; don't mix AzureRM and Az cmdlets in the same runbook.

Two judgement calls in there. First, the runbook only writes the status variable on failure, so a later group can't overwrite an earlier group's failure with "OK". Second, it throws after writing the variable. The plan won't stop, but the failure shows up in the job details and in the Automation job history, which is where on-call engineers will look.

## The drill driver

The second runbook runs on an Automation schedule. It resets the status variable, starts a test failover of the whole recovery plan into an isolated VNet, waits, reads the status, and cleans up unless the job is stuck on a manual action. The cmdlets are the same ones the [Azure-to-Azure PowerShell guide](https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-powershell) uses for a single VM, pointed at a recovery plan instead. It needs Az.RecoveryServices and Az.Automation as well.

```powershell
param (
    [Parameter(Mandatory = $true)][string]$VaultName,
    [Parameter(Mandatory = $true)][string]$VaultResourceGroup,
    [Parameter(Mandatory = $true)][string]$RecoveryPlanName,
    [Parameter(Mandatory = $true)][string]$TestVNetId,
    [Parameter(Mandatory = $true)][string]$AutomationAccountName,
    [Parameter(Mandatory = $true)][string]$AutomationResourceGroup
)

$ErrorActionPreference = 'Stop'

$conn = Get-AutomationConnection -Name 'AzureRunAsConnection'
Connect-AzAccount -ServicePrincipal `
    -Tenant $conn.TenantID `
    -ApplicationId $conn.ApplicationID `
    -CertificateThumbprint $conn.CertificateThumbprint | Out-Null

function Wait-AsrJob {
    param ($Job)
    while ($Job.State -eq 'NotStarted' -or $Job.State -eq 'InProgress') {
        Start-Sleep -Seconds 30
        $Job = Get-AzRecoveryServicesAsrJob -Job $Job
    }
    return $Job
}

$statusVar = "$RecoveryPlanName-DrillStatus"
Set-AzAutomationVariable -ResourceGroupName $AutomationResourceGroup `
    -AutomationAccountName $AutomationAccountName `
    -Name $statusVar -Value 'OK' -Encrypted $false | Out-Null

$vault = Get-AzRecoveryServicesVault -Name $VaultName -ResourceGroupName $VaultResourceGroup
Set-AzRecoveryServicesAsrVaultContext -Vault $vault | Out-Null
$plan = Get-AzRecoveryServicesAsrRecoveryPlan -Name $RecoveryPlanName

$tfoJob = Start-AzRecoveryServicesAsrTestFailoverJob -RecoveryPlan $plan `
    -Direction PrimaryToRecovery -AzureVMNetworkId $TestVNetId
$tfoJob = Wait-AsrJob -Job $tfoJob

if ($tfoJob.State -eq 'Suspended') {
    throw "Drill is waiting on a manual action. Scope manual actions away from Test failover, then complete or cancel job $($tfoJob.Name) in the portal. Test VMs are still running: run Cleanup test failover on the plan once the job is resolved."
}

$drillStatus = (Get-AzAutomationVariable -ResourceGroupName $AutomationResourceGroup `
    -AutomationAccountName $AutomationAccountName -Name $statusVar).Value

# Clean up even when the checks failed, so test VMs don't linger and bill
$cleanupJob = Start-AzRecoveryServicesAsrTestFailoverCleanupJob -RecoveryPlan $plan `
    -Comment "Scheduled DR drill: job $($tfoJob.State), checks $drillStatus"
$cleanupJob = Wait-AsrJob -Job $cleanupJob

$report = [ordered]@{
    RecoveryPlan    = $RecoveryPlanName
    DrillStartedUtc = $tfoJob.StartTime.ToUniversalTime().ToString('o')
    FailoverMinutes = [math]::Round(($tfoJob.EndTime - $tfoJob.StartTime).TotalMinutes, 1)
    FailoverState   = $tfoJob.State
    ValidationState = $drillStatus
    CleanupState    = $cleanupJob.State
}
Write-Output ($report | ConvertTo-Json)

if ($tfoJob.State -ne 'Succeeded' -or $drillStatus -ne 'OK' -or $cleanupJob.State -ne 'Succeeded') {
    throw "DR drill for $RecoveryPlanName did not pass."
}
```

The final `throw` matters: it marks the Automation job as Failed, so forwarding Automation job status to a Log Analytics workspace and alerting on failed jobs is enough to make a broken drill page someone. The JSON report in the job output is your audit evidence, with a timestamp and a measured failover time you can put next to the RTO the business signed off on.

Keep the whole run well inside the Automation sandbox's [three-hour fair share limit](https://learn.microsoft.com/en-us/azure/automation/automation-runbook-execution#fair-share). For a typical three-tier plan the failover takes minutes, but a plan with a large number of VMs and slow runbooks can get closer than you'd expect. If the sandbox stops the driver mid-drill, cleanup never runs, and simply re-running it isn't safe either: a re-run starts the script from the top, resets the status variable to `OK` and calls `Start-AzRecoveryServicesAsrTestFailoverJob` against a plan that's already in test failover. For large plans, run the driver on a Hybrid Runbook Worker, which isn't subject to fair share, or split it into a start runbook and a separate check-and-clean-up runbook scheduled a couple of hours later.

## What the drill does and doesn't prove

A green drill proves the VMs boot in the DR region from current replicated data, in the right order, with network interfaces attached, and that your runbooks run with working permissions. That's more than most organisations can say.

It doesn't prove:

- **The application works end to end.** The test VNet is isolated, so nothing outside it can reach the VMs. If the app needs Active Directory, include a domain controller in the plan or the test network, or the services won't start cleanly.
- **The real-failover branch of your runbooks.** The DNS update path never runs in a test. Review it whenever the zone or naming changes, and run a real failover and failback in a maintenance window when you can.
- **PaaS dependencies.** ASR replicates VMs. Azure SQL Database, storage accounts and Key Vault need their own geo-replication or redeployment story, and your plan should state which.
- **Capacity on the day.** ASR doesn't reserve compute in the target region. Check that your VM sizes are offered in the DR region before you choose it.

## When I wouldn't build this

If the workload is stateless and fully defined in ARM templates or Terraform, redeploying into the DR region from your pipeline is often cheaper and cleaner than paying for replication on every instance (protected instances are free for the first 31 days, then billed per instance per month). If the workload is already active-active across regions, ASR adds little. And if the app is mostly PaaS, ASR covers the minority of it; spend the effort on the data tier first.

For a VM-based line-of-business app with a stated RPO and RTO, though, this is worth the half day it takes. Start with a monthly drill on one recovery plan. Once it has run unattended and failed loudly at least once for a real reason, add the next application. If the only proof your DR plan works is a meeting invite, you don't have proof. The [DR drill tutorial](https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-tutorial-dr-drill) is the manual version, and the point of all this is to stop needing it.
