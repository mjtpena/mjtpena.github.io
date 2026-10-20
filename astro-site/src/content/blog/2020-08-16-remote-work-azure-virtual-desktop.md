---
title: "Windows Virtual Desktop for Remote Work: Building It Properly"
description: "How to stand up Windows Virtual Desktop on the new Azure Resource Manager model: host pools, FSLogix profiles on Azure Files, scaling, and when not to use it."
author: Michael John Peña
draft: false
date: 2020-08-16
tags:
  - Azure
  - Virtual Desktop
  - Remote Work
  - COVID-19
  - Cost Optimization
---

In the first six months of the pandemic I heard "we need everyone working from home by Monday" from client after client. For organisations with legacy Windows applications, custom line-of-business tools, or strict data-residency requirements, handing out laptops doesn't solve the problem. Windows Virtual Desktop (WVD) delivers a managed Windows session from Azure to whatever device the user has at home. A demo takes an afternoon; a deployment that holds up for a thousand users on a Monday morning takes more care, and the design choices you make in week one stay with you for a long time.

## What changed this year

If you looked at WVD in 2019 and were put off, look again. The original release (now called "WVD classic") kept tenants, host pools and app groups in a separate service database that you managed with the `Microsoft.RDInfra.RDPowerShell` module. The Spring 2020 update moved every object into Azure Resource Manager. It went into public preview in April, and in late July Microsoft made the Azure portal integration and Teams audio/video redirection generally available (the [What's new in Windows Virtual Desktop](https://learn.microsoft.com/azure/virtual-desktop/whats-new) page and its archive keep the monthly record).

That matters more than it sounds. Host pools, application groups and workspaces are now ordinary Azure resources. You assign access with Azure RBAC, publish to Azure AD groups instead of individual users, deploy with ARM templates, and send diagnostics to Log Analytics like anything else. If you're starting today, start on the ARM model. If you have a classic deployment, plan a migration rather than building more on top of it, because the two models don't share objects.

## Why WVD, and why not

The reason I reach for WVD over a third-party VDI broker in Azure is **Windows 10 Enterprise multi-session**. It's only licensed to run on WVD, and it gives users a real Windows 10 desktop while packing many of them onto one VM, the way Remote Desktop Session Host did on Windows Server but without the "this app won't run on Server" problems. Microsoft runs the brokering, gateway, web access and diagnostics as a managed service. You pay for the VMs, storage and networking. You don't pay for the control plane.

Licensing is the first thing to check. Users need an eligible licence, such as Microsoft 365 E3/E5, F3 or Business Premium, or Windows 10 Enterprise E3/E5, to access Windows 10 desktops. If you're publishing Windows Server session hosts, you still need RDS CALs. The [WVD overview](https://learn.microsoft.com/azure/virtual-desktop/overview) lists the full set.

When I'd steer people away:

- **Users who already have managed Windows laptops and only need a few SaaS apps.** A VPN or, better, moving those apps behind Azure AD is cheaper than running desktops in the cloud.
- **No identity foundation.** Session hosts must be joined to Active Directory, either your own domain controllers or Azure AD Domain Services, and that directory must sync with Azure AD. If that isn't in place, it is the critical path, not the host pool.
- **Latency-sensitive work far from an Azure region.** Display protocol traffic doesn't like 200 ms round trips. Pick a region close to your users and test from real home connections, not the office LAN.
- **GPU-heavy design or engineering workloads** can work on NV-series VMs, but cost them separately. They don't follow the economics below.

## The building blocks

A WVD deployment has four objects, and getting their relationships right up front saves rework:

| Object | What it is | Design decision |
|---|---|---|
| Host pool | A set of identical session host VMs | Pooled (multi-session) or personal (one VM per user) |
| Application group | What's published from a host pool | A desktop group, or RemoteApp groups for individual apps |
| Workspace | What users see in the client | Group application groups by audience |
| Session host | The VM itself, running the WVD agent | VM size, image, sessions per host |

The security model is the part I lead with when a rushed rollout meets a cautious security team. Session hosts use reverse connect: the WVD agent makes outbound HTTPS (TCP 443) connections to the service, so hosts need no public IP and no inbound RDP port open to the internet, and the NSG can deny all inbound traffic. What they do need is outbound access to the documented list of required WVD URLs, so if you force-tunnel through a network virtual appliance or proxy, check that list against your firewall rules before you blame the host pool for failed registrations.

Here's the control-plane part using the `Az.DesktopVirtualization` PowerShell module, which talks to the new ARM resource provider:

```powershell
# Requires: Install-Module Az.DesktopVirtualization -RequiredVersion 1.0.0 (cmdlet parameters changed in later versions)
# Then: Connect-AzAccount
$rg       = "rg-wvd-prod"
$location = "eastus"   # WVD metadata location; session hosts can live in any region
$hostPool = "hp-general"

New-AzResourceGroup -Name $rg -Location $location

New-AzWvdHostPool -ResourceGroupName $rg `
    -Name $hostPool `
    -Location $location `
    -HostPoolType Pooled `
    -LoadBalancerType BreadthFirst `
    -MaxSessionLimit 8 `
    -RegistrationTokenOperation Update `
    -ExpirationTime $((Get-Date).ToUniversalTime().AddDays(7).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ'))

$hp = Get-AzWvdHostPool -ResourceGroupName $rg -Name $hostPool

New-AzWvdApplicationGroup -ResourceGroupName $rg `
    -Name "ag-desktop" `
    -Location $location `
    -HostPoolArmPath $hp.Id `
    -ApplicationGroupType Desktop

$ag = Get-AzWvdApplicationGroup -ResourceGroupName $rg -Name "ag-desktop"

New-AzWvdWorkspace -ResourceGroupName $rg `
    -Name "ws-corporate" `
    -Location $location `
    -ApplicationGroupReference $ag.Id

# Publish to an Azure AD group, not individual users
$group = Get-AzADGroup -DisplayName "<your-wvd-users-group>"
New-AzRoleAssignment -ObjectId $group.Id `
    -RoleDefinitionName "Desktop Virtualization User" `
    -ResourceName "ag-desktop" `
    -ResourceGroupName $rg `
    -ResourceType "Microsoft.DesktopVirtualization/applicationGroups"
```

One thing that catches people out: the WVD service metadata (host pool, workspace and app group definitions) can only be stored in US regions today (East US, East US 2, Central US, North Central US, South Central US, West US, West US 2, West Central US). That's metadata only. Your session host VMs, user profiles and data can sit in Australia East or wherever your users are. If your data-residency review asks the question, that's the answer.

### Session hosts

For session hosts, I use the portal's "Add virtual machines" flow or the Microsoft-provided ARM template rather than a hand-rolled template, because they handle the domain join, the WVD agent install, and registration with the host pool's token in one pass. Start from the Marketplace image for Windows 10 Enterprise multi-session with Microsoft 365 Apps, then build a custom image once you know what your line-of-business apps need.

My sizing starting point for knowledge workers is a D4s_v3 (4 vCPU, 16 GiB) at around six to eight users, which is why the host pool above caps sessions at 8, then adjusting from real CPU and memory counters after a week. That is deliberately more conservative than Microsoft's [multi-session sizing guidelines](https://learn.microsoft.com/windows-server/remote/remote-desktop-services/virtual-machine-recs), which allow about four medium users per vCPU, or roughly 16 on a D4s_v3: those numbers assume a well-behaved workload, and the first week of a rushed remote-work rollout usually brings Teams, browsers full of tabs and line-of-business apps nobody profiled, so I would rather add sessions per host once the counters justify it than start full and field complaints. Breadth-first load balancing spreads users across all running hosts, which gives the best experience. Depth-first fills one host before moving to the next, which pairs better with aggressive scale-down. Pick deliberately, because it drives both user experience and your bill.

## Profiles: FSLogix on Azure Files

Pooled desktops are only usable if a user's profile follows them to whatever host they land on. FSLogix profile containers solve this by mounting the profile as a VHD(X) from a file share at sign-in. Microsoft acquired FSLogix in 2018 and its [profile container](https://learn.microsoft.com/fslogix/overview-what-is-fslogix) is included with the same licences that entitle you to WVD.

For the share, Azure Files is now the simplest choice. Authentication with [on-premises AD DS](https://learn.microsoft.com/azure/storage/files/storage-files-identity-ad-ds-overview) became generally available earlier this year, alongside the existing Azure AD DS option, so you no longer need to run your own file server VMs to get Kerberos and NTFS permissions on profiles.

```bash
az storage account create \
    --name <yourprofilestorage> \
    --resource-group rg-wvd-prod \
    --location australiaeast \
    --sku Premium_LRS \
    --kind FileStorage

az storage share create \
    --name profiles \
    --account-name <yourprofilestorage> \
    --quota 1024
```

Then join the storage account to your domain with the AzFilesHybrid PowerShell module (`Join-AzStorageAccountForAuth`), assign the share-level RBAC role "Storage File Data SMB Share Contributor" to your WVD users group, and set NTFS permissions so each user can only reach their own folder. If you're on Azure AD DS instead, `az storage account update --enable-files-aadds true` replaces the domain-join step.

Premium file shares are billed on provisioned size, and IOPS scale with that size. Logon storms at 8:45 am are where undersized shares show up, so I provision for the IOPS, not just the capacity.

On each session host (or better, in your image or Group Policy), point FSLogix at the share:

```powershell
$regPath = "HKLM:\SOFTWARE\FSLogix\Profiles"
New-Item -Path $regPath -Force | Out-Null
New-ItemProperty -Path $regPath -Name "Enabled" -PropertyType DWord -Value 1 -Force
New-ItemProperty -Path $regPath -Name "VHDLocations" -PropertyType MultiString `
    -Value "\\<yourprofilestorage>.file.core.windows.net\profiles" -Force
New-ItemProperty -Path $regPath -Name "DeleteLocalProfileWhenVHDShouldApply" -PropertyType DWord -Value 1 -Force
New-ItemProperty -Path $regPath -Name "FlipFlopProfileDirectoryName" -PropertyType DWord -Value 1 -Force
```

`FlipFlopProfileDirectoryName` puts the username before the SID in folder names, which makes the share far easier to support. `DeleteLocalProfileWhenVHDShouldApply` clears out stale local profiles that would otherwise stop the container from attaching.

## Teams

Teams on a remote desktop used to mean audio and video hairpinning through the session host, which hurt both call quality and host CPU. With [media optimisation for Teams](https://learn.microsoft.com/azure/virtual-desktop/teams-on-avd) now GA, the Windows Desktop client offloads calls to the user's local device. It requires the `IsWVDEnvironment` registry value (a DWORD set to 1 under `HKLM\SOFTWARE\Microsoft\Teams`), the machine-wide (per-machine) Teams install, the Teams WebSocket service on the session host, and a current Windows Desktop client. For a remote-work rollout where every meeting is a Teams call, this is not optional.

## Scaling: the bill is in the idle hours

WVD has no built-in autoscale today. Microsoft's answer is the WVD scaling tool: a PowerShell runbook in Azure Automation, triggered on a schedule by a Logic App. It starts hosts during peak hours and drains and shuts them down off-peak. Use it, or write your own. Here's the core of the drain-and-stop step as a runbook fragment, authenticating with the Automation Run As account:

```powershell
# Import Az.Accounts, Az.Compute and Az.DesktopVirtualization into the Automation account first
param(
    [Parameter(Mandatory = $true)][string]$ResourceGroupName,
    [Parameter(Mandatory = $true)][string]$HostPoolName,
    [int]$MinimumHosts = 2
)

$conn = Get-AutomationConnection -Name "AzureRunAsConnection"
Connect-AzAccount -ServicePrincipal -Tenant $conn.TenantID `
    -ApplicationId $conn.ApplicationID -CertificateThumbprint $conn.CertificateThumbprint | Out-Null

$hosts = Get-AzWvdSessionHost -ResourceGroupName $ResourceGroupName -HostPoolName $HostPoolName |
    Where-Object { $_.Status -eq "Available" }

$idle = $hosts | Where-Object { $_.Session -eq 0 }
$toStop = [Math]::Min($idle.Count, [Math]::Max($hosts.Count - $MinimumHosts, 0))

foreach ($h in ($idle | Select-Object -First $toStop)) {
    $sessionHostName = $h.Name.Split('/')[1]          # e.g. wvd-host-0.contoso.local
    $vmName = $sessionHostName.Split('.')[0]

    # Drain first so no new logons land here
    Update-AzWvdSessionHost -ResourceGroupName $ResourceGroupName -HostPoolName $HostPoolName `
        -Name $sessionHostName -AllowNewSession:$false | Out-Null

    # Re-read the host: a user may have connected between the first check and the drain
    $current = Get-AzWvdSessionHost -ResourceGroupName $ResourceGroupName -HostPoolName $HostPoolName `
        -Name $sessionHostName
    if ($current.Session -eq 0) {
        Stop-AzVM -ResourceGroupName $ResourceGroupName -Name $vmName -Force | Out-Null
        Write-Output "Stopped $vmName"
    }
    else {
        Write-Output "$vmName has $($current.Session) session(s); leaving it draining for the next run"
    }
}
```

This assumes the VMs live in the same resource group as the host pool and that each VM's resource name matches its computer name (true for VMs created by the portal or the Microsoft template), and the morning start-up job must set `AllowNewSession` back to `$true`. The cost mistake I see most often is leaving session hosts running 24/7 because nobody built this. Pooled desktops are mostly idle overnight and at weekends, so a schedule-based start and stop is the single biggest lever on the bill. Reserved instances only make sense for the minimum host count that genuinely runs all day.

Personal host pools need a different approach. The drain-based script assumes pooled hosts that users can be steered away from; with one VM per user there is nowhere to drain to, so the usual answer is scheduled deallocation per VM outside that user's working hours. Nothing in WVD starts a deallocated VM when a user connects, so a user who signs in early to a deallocated personal desktop has to wait for someone, or something you build, to start it.

## Monitoring

Send host pool and workspace diagnostics to Log Analytics from day one. When a user says "it didn't connect", the Connection and Error tables tell you whether the problem is the client, the broker or the host.

```bash
az monitor diagnostic-settings create \
    --name wvd-diagnostics \
    --resource "/subscriptions/<subscription-id>/resourceGroups/rg-wvd-prod/providers/Microsoft.DesktopVirtualization/hostpools/hp-general" \
    --workspace "/subscriptions/<subscription-id>/resourceGroups/rg-monitoring/providers/Microsoft.OperationalInsights/workspaces/<your-log-analytics-workspace>" \
    --logs '[{"category":"Checkpoint","enabled":true},{"category":"Error","enabled":true},{"category":"Management","enabled":true},{"category":"Connection","enabled":true},{"category":"HostRegistration","enabled":true}]'
```

Add the Windows performance counters from the session hosts (processor, memory, logical disk and the user input delay counters) to the same workspace so you can tie a slow-session complaint to a busy host.

## What I'd do first

Fix identity before anything else: a synced AD that session hosts and Azure Files can both use. Build on the ARM model, publish to groups, and put profiles on Premium Azure Files with FSLogix. Turn on Teams optimisation before the first all-hands call. And build the start/stop schedule in the same sprint as the host pool, not after the first invoice arrives. A WVD environment that runs only when people are working is cheap. Pooled hosts that only need to run 10 to 12 hours on weekdays are paid for roughly three times over if they run around the clock.
