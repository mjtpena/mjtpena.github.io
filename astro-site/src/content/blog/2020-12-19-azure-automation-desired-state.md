---
title: "Azure Automation DSC: Desired State Configuration"
author: Michael John Peña
draft: false
date: 2020-12-19
tags:
  - Azure
  - Automation
  - DSC
  - Configuration Management

---

I wrote "Azure Automation DSC: Desired State Configuration" to share practical, production-minded guidance on this topic.

## DSC Configuration

```powershell
# WebServerConfig.ps1
Configuration WebServerConfig
{
    param (
        [string]$NodeName = 'localhost'
    )

    Import-DscResource -ModuleName PSDesiredStateConfiguration
    Import-DscResource -ModuleName xWebAdministration

    Node $NodeName
    {
        # Ensure IIS is installed
        WindowsFeature WebServer
        {
            Ensure = 'Present'
            Name   = 'Web-Server'
        }

        WindowsFeature AspNet45
        {
            Ensure = 'Present'
            Name   = 'Web-Asp-Net45'
            DependsOn = '[WindowsFeature]WebServer'
        }

        # Create website directory
        File WebContent
        {
            Ensure = 'Present'
            Type = 'Directory'
            DestinationPath = 'C:\inetpub\mysite'
        }

        # Configure website
        xWebsite DefaultSite
        {
            Ensure = 'Present'
            Name = 'Default Web Site'
            State = 'Stopped'
            PhysicalPath = 'C:\inetpub\wwwroot'
            DependsOn = '[WindowsFeature]WebServer'
        }

        xWebsite MySite
        {
            Ensure = 'Present'
            Name = 'MySite'
            State = 'Started'
            PhysicalPath = 'C:\inetpub\mysite'
            BindingInfo = @(
                MSFT_xWebBindingInformation
                {
                    Protocol = 'HTTP'
                    Port = 80
                    HostName = 'mysite.company.com'
                }
            )
            DependsOn = '[File]WebContent', '[xWebsite]DefaultSite'
        }
    }
}
```

## Upload to Azure Automation

```powershell
# Connect to Azure
Connect-AzAccount

# Import configuration
Import-AzAutomationDscConfiguration `
    -SourcePath ".\WebServerConfig.ps1" `
    -ResourceGroupName "myRG" `
    -AutomationAccountName "my-automation" `
    -Published
```

## Compile Configuration

```powershell
# Compile with parameters
$ConfigData = @{
    AllNodes = @(
        @{
            NodeName = 'WebServer01'
            Role = 'Web'
        },
        @{
            NodeName = 'WebServer02'
            Role = 'Web'
        }
    )
}

Start-AzAutomationDscCompilationJob `
    -ConfigurationName "WebServerConfig" `
    -ConfigurationData $ConfigData `
    -ResourceGroupName "myRG" `
    -AutomationAccountName "my-automation"
```

## Register Nodes

```powershell
# Azure VM
Register-AzAutomationDscNode `
    -AzureVMName "WebServer01" `
    -AzureVMResourceGroup "myRG" `
    -NodeConfigurationName "WebServerConfig.WebServer01" `
    -ResourceGroupName "myRG" `
    -AutomationAccountName "my-automation" `
    -RebootNodeIfNeeded $true `
    -RefreshFrequencyMins 30 `
    -ConfigurationModeFrequencyMins 15 `
    -ConfigurationMode "ApplyAndAutoCorrect"
```

## On-Premises Registration

```powershell
# Generate registration key
$regInfo = Get-AzAutomationRegistrationInfo `
    -ResourceGroupName "myRG" `
    -AutomationAccountName "my-automation"

# On the target machine
[DscLocalConfigurationManager()]
Configuration LCMConfig
{
    Node localhost
    {
        Settings
        {
            RefreshMode = 'Pull'
            RefreshFrequencyMins = 30
            ConfigurationModeFrequencyMins = 15
            ConfigurationMode = 'ApplyAndAutoCorrect'
            RebootNodeIfNeeded = $true
        }

        ConfigurationRepositoryWeb AzureAutomation
        {
            ServerUrl = $regInfo.Endpoint
            RegistrationKey = $regInfo.PrimaryKey
            ConfigurationNames = @('WebServerConfig.localhost')
        }
    }
}

LCMConfig
Set-DscLocalConfigurationManager -Path .\LCMConfig
```

## Check Compliance

```powershell
# Get node status
Get-AzAutomationDscNode `
    -ResourceGroupName "myRG" `
    -AutomationAccountName "my-automation" |
    Select-Object Name, Status, LastSeen

# Get compliance report
Get-AzAutomationDscNodeReport `
    -ResourceGroupName "myRG" `
    -AutomationAccountName "my-automation" `
    -NodeId "node-guid" |
    Select-Object Status, StartTime, ReportFormatVersion
```

## Linux Configuration

```powershell
Configuration LinuxWebServer
{
    Import-DscResource -ModuleName nx

    Node 'LinuxServer01'
    {
        nxPackage nginx
        {
            Name = 'nginx'
            Ensure = 'Present'
            PackageManager = 'apt'
        }

        nxService nginxService
        {
            Name = 'nginx'
            State = 'running'
            Enabled = $true
            DependsOn = '[nxPackage]nginx'
        }

        nxFile webRoot
        {
            DestinationPath = '/var/www/html/index.html'
            Contents = '<html><body>Hello from DSC!</body></html>'
            Ensure = 'Present'
            Type = 'File'
            Owner = 'www-data'
        }
    }
}
```

DSC: configuration as code for infrastructure compliance.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
