---
title: Maximizing Value with Azure Hybrid Benefit
author: Michael John Peña
draft: false
date: 2021-02-27
url: /blog/azure-hybrid-benefit/
tags:
  - Azure
  - Hybrid Benefit
  - Licensing
  - Cost Optimization
  - Windows Server
---

Azure Hybrid Benefit is the discount that nobody in finance remembers to claim and every consultant I know flags in the first cost review. If you have Windows Server or SQL Server licences with Software Assurance, you can apply them to Azure VMs and SQL MI/DB—up to 40% off Windows VMs, up to 55% off SQL Server, and Hybrid Benefit stacks with Reserved Instances for savings that can reach 80% in some configurations. The mechanism is straightforward; the organisational challenge is getting procurement to confirm which licences have Software Assurance before someone buys a reserved instance at full price.

## Understanding Azure Hybrid Benefit

Azure Hybrid Benefit covers:

- **Windows Server** - Use existing Windows Server licenses
- **SQL Server** - Use existing SQL Server licenses
- **Red Hat Enterprise Linux** - Bring existing subscriptions
- **SUSE Linux Enterprise** - Bring existing subscriptions

## Windows Server Hybrid Benefit

### Calculating Savings

```python
def calculate_windows_hybrid_benefit_savings(vm_size, region, hours_per_month=730):
    """Calculate potential savings with Windows Server Hybrid Benefit."""

    # Sample pricing (check current Azure pricing for actual rates)
    pricing = {
        "Standard_D2s_v3": {
            "windows": 0.188,  # Per hour with Windows license
            "linux": 0.096    # Per hour base compute
        },
        "Standard_D4s_v3": {
            "windows": 0.376,
            "linux": 0.192
        },
        "Standard_D8s_v3": {
            "windows": 0.752,
            "linux": 0.384
        }
    }

    if vm_size not in pricing:
        return None

    rates = pricing[vm_size]

    monthly_windows = rates["windows"] * hours_per_month
    monthly_hybrid = rates["linux"] * hours_per_month  # With AHB, you pay Linux rate
    monthly_savings = monthly_windows - monthly_hybrid
    annual_savings = monthly_savings * 12
    savings_percentage = (monthly_savings / monthly_windows) * 100

    return {
        "vm_size": vm_size,
        "monthly_without_ahb": monthly_windows,
        "monthly_with_ahb": monthly_hybrid,
        "monthly_savings": monthly_savings,
        "annual_savings": annual_savings,
        "savings_percentage": savings_percentage
    }

# Calculate for different VM sizes
for vm in ["Standard_D2s_v3", "Standard_D4s_v3", "Standard_D8s_v3"]:
    result = calculate_windows_hybrid_benefit_savings(vm, "eastus")
    print(f"{vm}:")
    print(f"  Without AHB: ${result['monthly_without_ahb']:,.2f}/month")
    print(f"  With AHB: ${result['monthly_with_ahb']:,.2f}/month")
    print(f"  Savings: ${result['annual_savings']:,.2f}/year ({result['savings_percentage']:.1f}%)")
    print()
```

### Enabling on VMs

```bash
# Enable AHB on existing VM
az vm update \
    --name myVM \
    --resource-group myResourceGroup \
    --license-type Windows_Server

# Create new VM with AHB
az vm create \
    --name myVM \
    --resource-group myResourceGroup \
    --image Win2019Datacenter \
    --size Standard_D2s_v3 \
    --admin-username azureuser \
    --admin-password 'YourPassword123!' \
    --license-type Windows_Server

# Check AHB status
az vm get-instance-view \
    --name myVM \
    --resource-group myResourceGroup \
    --query "licenseType"
```

### Bulk Enable with PowerShell

```powershell
# Enable AHB on all Windows VMs in a subscription
$vms = Get-AzVM | Where-Object { $_.StorageProfile.OsDisk.OsType -eq "Windows" }

foreach ($vm in $vms) {
    if ($vm.LicenseType -ne "Windows_Server") {
        Write-Host "Enabling AHB on $($vm.Name)..."
        $vm.LicenseType = "Windows_Server"
        Update-AzVM -ResourceGroupName $vm.ResourceGroupName -VM $vm
    }
}

# Generate report of AHB status
$report = Get-AzVM | Select-Object Name, ResourceGroupName, @{
    Name = "OsType"
    Expression = { $_.StorageProfile.OsDisk.OsType }
}, @{
    Name = "LicenseType"
    Expression = { $_.LicenseType }
}, @{
    Name = "AHBEnabled"
    Expression = { $_.LicenseType -eq "Windows_Server" }
}

$report | Export-Csv -Path "ahb-status.csv" -NoTypeInformation
```

## SQL Server Hybrid Benefit

### SQL Database

```bash
# Enable AHB on Azure SQL Database
az sql db update \
    --name myDatabase \
    --server myServer \
    --resource-group myResourceGroup \
    --license-type BasePrice

# Create new SQL Database with AHB
az sql db create \
    --name myDatabase \
    --server myServer \
    --resource-group myResourceGroup \
    --edition GeneralPurpose \
    --family Gen5 \
    --capacity 2 \
    --license-type BasePrice
```

### SQL Managed Instance

```bash
# Enable AHB on SQL Managed Instance
az sql mi update \
    --name myManagedInstance \
    --resource-group myResourceGroup \
    --license-type BasePrice

# Check license type
az sql mi show \
    --name myManagedInstance \
    --resource-group myResourceGroup \
    --query "licenseType"
```

### SQL Server on Azure VMs

```bash
# Register VM with SQL IaaS extension and enable AHB
az sql vm create \
    --name myVM \
    --resource-group myResourceGroup \
    --location eastus \
    --license-type AHUB \
    --sql-mgmt-type Full

# Update existing SQL VM
az sql vm update \
    --name myVM \
    --resource-group myResourceGroup \
    --sql-mgmt-type Full \
    --license-type AHUB
```

## License Compliance Tracking

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.compute import ComputeManagementClient
from azure.mgmt.sql import SqlManagementClient
import pandas as pd

def audit_hybrid_benefit_usage(subscription_id):
    """Audit Azure Hybrid Benefit usage across resources."""

    credential = DefaultAzureCredential()
    compute_client = ComputeManagementClient(credential, subscription_id)
    sql_client = SqlManagementClient(credential, subscription_id)

    report = []

    # Audit VMs
    vms = compute_client.virtual_machines.list_all()
    for vm in vms:
        os_type = vm.storage_profile.os_disk.os_type
        if os_type == "Windows":
            report.append({
                "resource_type": "Virtual Machine",
                "resource_name": vm.name,
                "resource_group": vm.id.split("/")[4],
                "os_type": "Windows",
                "ahb_enabled": vm.license_type == "Windows_Server",
                "vm_size": vm.hardware_profile.vm_size
            })

    # Audit SQL Databases
    servers = sql_client.servers.list()
    for server in servers:
        rg = server.id.split("/")[4]
        databases = sql_client.databases.list_by_server(rg, server.name)
        for db in databases:
            if db.name != "master":
                report.append({
                    "resource_type": "SQL Database",
                    "resource_name": f"{server.name}/{db.name}",
                    "resource_group": rg,
                    "os_type": "SQL Server",
                    "ahb_enabled": db.license_type == "BasePrice",
                    "vm_size": f"{db.sku.name} {db.sku.capacity} vCores"
                })

    # Audit SQL Managed Instances
    managed_instances = sql_client.managed_instances.list()
    for mi in managed_instances:
        rg = mi.id.split("/")[4]
        report.append({
            "resource_type": "SQL Managed Instance",
            "resource_name": mi.name,
            "resource_group": rg,
            "os_type": "SQL Server",
            "ahb_enabled": mi.license_type == "BasePrice",
            "vm_size": f"{mi.sku.name} {mi.v_cores} vCores"
        })

    return pd.DataFrame(report)

# Generate audit report
audit_df = audit_hybrid_benefit_usage(subscription_id)

# Summary
print("Azure Hybrid Benefit Audit Summary")
print("=" * 50)
print(f"Total resources: {len(audit_df)}")
print(f"AHB enabled: {audit_df['ahb_enabled'].sum()}")
print(f"AHB not enabled: {(~audit_df['ahb_enabled']).sum()}")
print()
print("By resource type:")
print(audit_df.groupby(['resource_type', 'ahb_enabled']).size().unstack(fill_value=0))

# Export full report
audit_df.to_csv("ahb-audit-report.csv", index=False)
```

## ARM Template with Hybrid Benefit

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "vmName": {
            "type": "string"
        },
        "enableHybridBenefit": {
            "type": "bool",
            "defaultValue": true
        }
    },
    "resources": [
        {
            "type": "Microsoft.Compute/virtualMachines",
            "apiVersion": "2021-07-01",
            "name": "[parameters('vmName')]",
            "location": "[resourceGroup().location]",
            "properties": {
                "licenseType": "[if(parameters('enableHybridBenefit'), 'Windows_Server', json('null'))]",
                "hardwareProfile": {
                    "vmSize": "Standard_D2s_v3"
                },
                "storageProfile": {
                    "imageReference": {
                        "publisher": "MicrosoftWindowsServer",
                        "offer": "WindowsServer",
                        "sku": "2019-Datacenter",
                        "version": "latest"
                    }
                }
            }
        },
        {
            "type": "Microsoft.Sql/servers/databases",
            "apiVersion": "2021-08-01-preview",
            "name": "[concat(parameters('sqlServerName'), '/myDatabase')]",
            "location": "[resourceGroup().location]",
            "properties": {
                "licenseType": "[if(parameters('enableHybridBenefit'), 'BasePrice', 'LicenseIncluded')]"
            },
            "sku": {
                "name": "GP_Gen5",
                "tier": "GeneralPurpose",
                "family": "Gen5",
                "capacity": 2
            }
        }
    ]
}
```

## Combining with Reservations

The maximum savings come from combining Hybrid Benefit with Reserved Instances:

```python
def calculate_combined_savings(vm_size, commitment_years=1):
    """Calculate savings from combining AHB and Reserved Instances."""

    # Sample rates (check actual Azure pricing)
    base_rates = {
        "Standard_D4s_v3": {
            "payg_windows": 0.376,      # Pay-as-you-go with Windows
            "payg_linux": 0.192,        # Pay-as-you-go Linux (AHB rate)
            "ri_1yr_discount": 0.37,    # 1-year RI discount
            "ri_3yr_discount": 0.56     # 3-year RI discount
        }
    }

    rates = base_rates[vm_size]
    hours_per_year = 8760

    # Scenario 1: Pay-as-you-go
    payg_cost = rates["payg_windows"] * hours_per_year

    # Scenario 2: AHB only
    ahb_cost = rates["payg_linux"] * hours_per_year

    # Scenario 3: RI only (no AHB)
    ri_discount = rates["ri_3yr_discount"] if commitment_years == 3 else rates["ri_1yr_discount"]
    ri_cost = rates["payg_windows"] * hours_per_year * (1 - ri_discount)

    # Scenario 4: AHB + RI (maximum savings)
    combined_cost = rates["payg_linux"] * hours_per_year * (1 - ri_discount)

    return {
        "vm_size": vm_size,
        "payg_annual": payg_cost,
        "ahb_only_annual": ahb_cost,
        "ri_only_annual": ri_cost,
        "combined_annual": combined_cost,
        "ahb_savings": payg_cost - ahb_cost,
        "ri_savings": payg_cost - ri_cost,
        "combined_savings": payg_cost - combined_cost,
        "combined_savings_percent": ((payg_cost - combined_cost) / payg_cost) * 100
    }

# Calculate combined savings
result = calculate_combined_savings("Standard_D4s_v3", commitment_years=3)
print(f"VM Size: {result['vm_size']}")
print(f"\nAnnual Costs:")
print(f"  Pay-as-you-go: ${result['payg_annual']:,.2f}")
print(f"  AHB only: ${result['ahb_only_annual']:,.2f}")
print(f"  3-year RI only: ${result['ri_only_annual']:,.2f}")
print(f"  AHB + 3-year RI: ${result['combined_annual']:,.2f}")
print(f"\nCombined savings: ${result['combined_savings']:,.2f}/year ({result['combined_savings_percent']:.1f}%)")
```

## Best Practices

1. **Audit existing licenses** before applying AHB
2. **Track license compliance** with regular audits
3. **Combine with Reserved Instances** for maximum savings
4. **Use Policy** to enforce AHB on new deployments
5. **Monitor for changes** in license status
6. **Document license allocations** for compliance

## Conclusion

Azure Hybrid Benefit is one of the easiest ways to reduce Azure costs if you have existing Windows Server or SQL Server licenses with Software Assurance. Combined with Reserved Instances, you can achieve savings of 70% or more compared to pay-as-you-go pricing.

Review your existing license inventory and implement AHB across your Azure estate for immediate cost savings.
