---
title: Azure Migrate - Planning and Executing Cloud Migrations
description: "Azure Migrate is the tool that turns a migration conversation from \"we think we have about 300 servers\" to \"we have 287 servers, here's the dependency map…"
author: Michael John Peña
draft: false
date: 2021-04-28
url: /blog/azure-migrate-cloud-migration-assessment/
tags:
  - Azure
  - Migration
  - Cloud Adoption
  - Assessment
  - Modernization
---

Azure Migrate is the tool that turns a migration conversation from "we think we have about 300 servers" to "we have 287 servers, here's the dependency map, and here's the estimated TCO for the first twelve months in Azure." The discovery agent installs on a few VMs and maps everything the estate talks to—servers, SQL instances, web apps, VMware VMs. The assessment then translates that to Azure SKU recommendations based on actual utilisation data, not peak capacity. The dependency mapping is what I find most valuable: it surfaces the "we forgot that service talks to an on-prem SMTP relay" conversations before they become migration-day incidents.

## Understanding Azure Migrate

### Core Capabilities

```
┌────────────────────────────────────────────────────────────┐
│                     Azure Migrate                           │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Discovery                Assessment              Migration │
│  ─────────               ──────────              ───────── │
│  • Server discovery      • Readiness             • Servers │
│  • Application mapping   • Sizing                • Databases│
│  • Dependency analysis   • Cost estimation       • Apps    │
│  • Performance data      • Compatibility         • Data    │
│                                                             │
├────────────────────────────────────────────────────────────┤
│  Supported Scenarios:                                       │
│  • VMware VMs → Azure VMs                                  │
│  • Hyper-V VMs → Azure VMs                                 │
│  • Physical servers → Azure VMs                            │
│  • AWS/GCP VMs → Azure VMs                                 │
│  • SQL Server → Azure SQL                                  │
│  • Web apps → Azure App Service                            │
│  • VDI → Azure Virtual Desktop                             │
└────────────────────────────────────────────────────────────┘
```

## Setting Up Azure Migrate

### Create Migration Project

```bash
# Create resource group
az group create --name migration-rg --location eastus

# Register providers
az provider register --namespace Microsoft.OffAzure
az provider register --namespace Microsoft.Migrate

# Create migrate project (via portal or ARM template)
az deployment group create \
    --resource-group migration-rg \
    --template-file migrate-project.json
```

### ARM Template for Migrate Project

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "projectName": {
      "type": "string",
      "defaultValue": "datacenter-migration"
    }
  },
  "resources": [
    {
      "type": "Microsoft.Migrate/migrateProjects",
      "apiVersion": "2020-05-01",
      "name": "[parameters('projectName')]",
      "location": "eastus",
      "properties": {}
    }
  ]
}
```

## Discovery Phase

### Deploy Appliance for VMware

```bash
# Download OVA from Azure portal
# Deploy to vCenter

# Appliance configuration
Appliance Requirements:
  - 8 vCPUs
  - 32 GB RAM
  - 80 GB disk
  - Network access to vCenter and Azure
```

### Configure Discovery

```python
# Example: Discovery configuration via API
import requests
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("https://management.azure.com/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

# Start discovery
discovery_config = {
    "properties": {
        "discoverySiteId": "/subscriptions/.../discoverySites/vmware-site",
        "vCenterEndpoint": "vcenter.company.local",
        "vCenterUsername": "administrator@vsphere.local",
        "friendlyName": "Production VMware"
    }
}

response = requests.put(
    f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/migration-rg/providers/Microsoft.OffAzure/vmwareSites/vmware-site?api-version=2020-07-07",
    headers=headers,
    json=discovery_config
)
```

### Application Dependency Analysis

```bash
# Enable dependency analysis (agentless)
az rest --method post \
    --uri "https://management.azure.com/subscriptions/{sub}/resourceGroups/migration-rg/providers/Microsoft.Migrate/migrateProjects/datacenter-migration/solutions/Servers-Discovery-ServerDependencyAnalysis/startDependencyMapping?api-version=2020-05-01" \
    --body '{"machines": ["machine-1", "machine-2"]}'

# Or install agents for detailed analysis
# Download and install:
# - Microsoft Monitoring Agent
# - Dependency Agent
```

## Assessment Phase

### Create Assessment

```python
# Assessment configuration
assessment_config = {
    "properties": {
        "azureLocation": "eastus",
        "azurePricingTier": "Standard",
        "azureHybridUseBenefit": "Yes",
        "reservedInstance": "RI3Year",
        "sizingCriterion": "PerformanceBased",
        "performanceHistory": "Month",
        "percentile": 95,
        "scalingFactor": 1.0,
        "currency": "USD",
        "azureOfferCode": "MS-AZR-0017P",
        "vmUptime": {
            "daysPerMonth": 31,
            "hoursPerDay": 24
        }
    }
}

# Create assessment group
group = {
    "properties": {
        "machines": ["vm-1", "vm-2", "vm-3", "vm-4"]
    }
}
```

### Assessment Types

```yaml
Azure VM Assessment:
  - Right-sizing recommendations
  - Cost estimates
  - Readiness analysis
  - Confidence ratings

Azure SQL Assessment:
  - SQL Server compatibility
  - Target recommendations (SQL MI, SQL DB, SQL VM)
  - Performance requirements
  - Migration blockers

Azure App Service Assessment:
  - Web app compatibility
  - Framework support
  - Configuration requirements
  - Modernization recommendations

AVS Assessment:
  - VMware environment sizing
  - Node requirements
  - Network configuration
```

### Analyze Assessment Results

```python
# Get assessment results
def analyze_assessment(project_name, assessment_name):
    # Get assessed machines
    machines = get_assessed_machines(project_name, assessment_name)

    summary = {
        "total_machines": len(machines),
        "ready": 0,
        "ready_with_conditions": 0,
        "not_ready": 0,
        "unknown": 0,
        "estimated_cost": 0,
        "recommendations": []
    }

    for machine in machines:
        readiness = machine["properties"]["suitability"]
        if readiness == "Suitable":
            summary["ready"] += 1
        elif readiness == "ConditionallySuitable":
            summary["ready_with_conditions"] += 1
        elif readiness == "NotSuitable":
            summary["not_ready"] += 1
        else:
            summary["unknown"] += 1

        # Collect cost estimate
        monthly_cost = machine["properties"]["monthlyComputeCost"]
        monthly_cost += machine["properties"]["monthlyStorageCost"]
        summary["estimated_cost"] += monthly_cost

        # Collect sizing recommendation
        summary["recommendations"].append({
            "machine": machine["name"],
            "current_size": f"{machine['properties']['numberOfCores']} cores, {machine['properties']['megabytesOfMemory']/1024:.0f} GB",
            "recommended_size": machine["properties"]["recommendedSize"],
            "monthly_cost": monthly_cost
        })

    return summary

results = analyze_assessment("datacenter-migration", "wave-1-assessment")
print(f"Ready for migration: {results['ready']}/{results['total_machines']}")
print(f"Estimated monthly cost: ${results['estimated_cost']:,.2f}")
```

## Migration Execution

### Server Replication

```bash
# Enable replication for a VM
az rest --method put \
    --uri "https://management.azure.com/subscriptions/{sub}/resourceGroups/migration-rg/providers/Microsoft.RecoveryServices/vaults/migration-vault/replicationFabrics/vmware-fabric/replicationProtectionContainers/vmware-container/replicationProtectedItems/vm-1?api-version=2021-02-10" \
    --body @replication-config.json
```

### Replication Configuration

```json
{
  "properties": {
    "policyId": "/subscriptions/.../replicationPolicies/migration-policy",
    "providerSpecificDetails": {
      "instanceType": "InMageRcm",
      "fabricDiscoveryMachineId": "/subscriptions/.../machines/vm-1",
      "targetResourceGroupId": "/subscriptions/.../resourceGroups/production-rg",
      "targetNetworkId": "/subscriptions/.../virtualNetworks/prod-vnet",
      "targetSubnetName": "app-subnet",
      "targetVmName": "vm-1-azure",
      "targetVmSize": "Standard_D4s_v3",
      "licenseType": "WindowsServer"
    }
  }
}
```

### Test Migration

```python
def perform_test_migration(machine_name, test_vnet_id):
    """Perform test failover to validate migration"""

    # Start test migration
    test_config = {
        "properties": {
            "networkId": test_vnet_id,
            "skipShutdown": False
        }
    }

    response = requests.post(
        f"{base_url}/replicationProtectedItems/{machine_name}/testFailover",
        headers=headers,
        json=test_config
    )

    job_id = response.json()["name"]

    # Monitor test migration
    while True:
        status = get_job_status(job_id)
        print(f"Test migration status: {status}")

        if status in ["Succeeded", "Failed"]:
            break
        time.sleep(30)

    return status

# Run test migration
result = perform_test_migration("vm-1", test_vnet_id)

# Validate migrated VM
# - Verify application functionality
# - Check network connectivity
# - Validate data integrity

# Cleanup test migration
cleanup_test_migration("vm-1")
```

### Production Migration

```python
def execute_migration(machines, migration_window):
    """Execute production migration for a group of machines"""

    results = []

    # Pre-migration checks
    for machine in machines:
        checks = run_premigration_checks(machine)
        if not checks["passed"]:
            print(f"Pre-migration checks failed for {machine}: {checks['issues']}")
            continue

    # Wait for migration window
    while datetime.now() < migration_window["start"]:
        time.sleep(60)

    # Perform final replication sync
    for machine in machines:
        trigger_final_sync(machine)

    # Wait for sync completion
    all_synced = False
    while not all_synced:
        sync_status = [check_sync_status(m) for m in machines]
        all_synced = all(s == "Synchronized" for s in sync_status)
        time.sleep(30)

    # Perform cutover
    for machine in machines:
        # Shutdown source VM
        shutdown_source_vm(machine)

        # Complete migration
        result = complete_migration(machine)
        results.append({
            "machine": machine,
            "status": result["status"],
            "azure_vm_id": result.get("targetVmId")
        })

    # Post-migration validation
    for result in results:
        if result["status"] == "Succeeded":
            validate_migrated_vm(result["azure_vm_id"])

    return results
```

## Database Migration

### Using Database Migration Service

```bash
# Create DMS instance
az dms create \
    --resource-group migration-rg \
    --name database-migration-service \
    --location eastus \
    --sku-name Premium_4vCores \
    --subnet /subscriptions/.../subnets/dms-subnet

# Create migration project
az dms project create \
    --resource-group migration-rg \
    --service-name database-migration-service \
    --name sql-migration-project \
    --source-platform SQL \
    --target-platform SQLMI
```

### Migration Task Configuration

```json
{
  "taskType": "Migrate.SqlServer.AzureSqlDbMI",
  "input": {
    "sourceConnectionInfo": {
      "type": "SqlConnectionInfo",
      "dataSource": "sqlserver.company.local",
      "authentication": "SqlAuthentication",
      "userName": "migrationuser",
      "password": "password"
    },
    "targetConnectionInfo": {
      "type": "SqlConnectionInfo",
      "dataSource": "myinstance.database.windows.net",
      "authentication": "SqlAuthentication",
      "userName": "sqladmin",
      "password": "password"
    },
    "selectedDatabases": [
      {
        "name": "SalesDB",
        "restoreDatabaseName": "SalesDB",
        "backupFileShare": {
          "path": "\\\\fileserver\\sqlbackups"
        }
      }
    ],
    "backupBlobShare": {
      "sasUri": "https://storage.blob.core.windows.net/backups?sv=..."
    }
  }
}
```

## Migration Waves Planning

```python
# Wave planning based on dependencies
def plan_migration_waves(machines, dependencies):
    """Plan migration waves based on dependencies and constraints"""

    waves = []
    migrated = set()

    while len(migrated) < len(machines):
        current_wave = []

        for machine in machines:
            if machine in migrated:
                continue

            # Check if all dependencies are migrated
            machine_deps = dependencies.get(machine, [])
            if all(dep in migrated for dep in machine_deps):
                current_wave.append(machine)

        if not current_wave:
            # Circular dependency - break with the least dependent
            remaining = [m for m in machines if m not in migrated]
            current_wave = [min(remaining, key=lambda m: len(dependencies.get(m, [])))]

        waves.append({
            "wave_number": len(waves) + 1,
            "machines": current_wave,
            "estimated_duration": estimate_migration_duration(current_wave)
        })

        migrated.update(current_wave)

    return waves

# Example usage
dependencies = {
    "web-server": ["app-server", "db-server"],
    "app-server": ["db-server"],
    "db-server": [],
    "reporting-server": ["db-server"]
}

machines = list(dependencies.keys())
waves = plan_migration_waves(machines, dependencies)

for wave in waves:
    print(f"Wave {wave['wave_number']}: {wave['machines']}")
```

## Best Practices

1. **Assess before migrating** - Understand readiness and dependencies
2. **Test migrations first** - Validate before production cutover
3. **Plan migration waves** - Group by dependencies and risk
4. **Communicate downtime** - Set clear expectations
5. **Have rollback plans** - Keep source systems ready
6. **Monitor closely** - Watch performance post-migration
7. **Document everything** - Track decisions and configurations
8. **Optimize after migration** - Right-size and tune resources

## Conclusion

Azure Migrate provides a comprehensive toolkit for planning and executing cloud migrations. From initial discovery and assessment through test migrations and production cutover, the platform guides you through each phase of the migration journey. By following a structured approach and leveraging the assessment capabilities, you can minimize risk and ensure successful migrations.
