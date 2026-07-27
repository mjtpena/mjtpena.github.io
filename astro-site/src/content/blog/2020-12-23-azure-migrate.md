---
title: "Azure Migrate: Cloud Migration Made Simple"
author: Michael John Peña
draft: false
date: 2020-12-23
tags:
  - Azure
  - Migration
  - Cloud Adoption
  - VMware
---

Every migration project I've run has the same first two weeks: spreadsheet hell. What's running, what does it talk to, what's the dependency graph, what does it cost today. Azure Migrate replaces a lot of that grunt work. Discovery via appliance, dependency analysis, sizing recommendations, and migration tooling for VMs, databases, web apps, and even VDI. It's not magic—you still need owners and a rollback plan—but the data is dramatically better than what you'd get from manual interviews.

## Migration Workflow

```
Discover → Assess → Migrate → Optimize
    │         │         │         │
    └─────────┴─────────┴─────────┘
         Azure Migrate Hub
```

## Supported Sources

| Workload | Source |
|----------|--------|
| Servers | VMware, Hyper-V, Physical, AWS, GCP |
| Databases | SQL Server, MySQL, PostgreSQL |
| Web Apps | ASP.NET, Java, PHP |
| VDI | RDS, Citrix, VMware Horizon |

## Create Migrate Project

```bash
az migrate project create \
    --name my-migrate-project \
    --resource-group myRG \
    --location eastus
```

## Deploy Appliance (VMware)

1. Download appliance OVA from portal
2. Deploy in vCenter
3. Register with Azure Migrate project
4. Start discovery

```powershell
# On appliance, register with Azure
$appliance = Get-AzMigrateAppliance -ProjectName "my-migrate-project" -ResourceGroupName "myRG"
Register-AzMigrateAppliance -Appliance $appliance -CredentialPath "C:\creds"
```

## Discovery

```bash
# View discovered servers
az migrate discovered-server list \
    --migrate-project-name my-migrate-project \
    --resource-group myRG

# Output includes:
# - Server names
# - Operating systems
# - CPU, memory, disk
# - Running applications
# - Dependencies
```

## Assessment

```bash
# Create assessment
az migrate assessment create \
    --migrate-project-name my-migrate-project \
    --resource-group myRG \
    --assessment-name web-servers-assessment \
    --azure-location eastus \
    --azure-offer-code PAYG \
    --sizing-criteria PerformanceBased \
    --percentile Percentile95 \
    --time-range Month
```

Assessment provides:
- Azure VM sizing recommendations
- Monthly cost estimates
- Readiness status
- Migration blockers

## Server Migration (VMware)

```bash
# Enable replication
az migrate replication create \
    --migrate-project-name my-migrate-project \
    --resource-group myRG \
    --source-server-id discovered-server-id \
    --target-resource-group target-rg \
    --target-vm-name migrated-vm \
    --target-vnet target-vnet \
    --target-subnet default \
    --license-type WindowsServer

# Test migration
az migrate test-migrate \
    --replicating-item-name migrated-vm \
    --migrate-project-name my-migrate-project \
    --resource-group myRG \
    --test-network test-vnet

# Cutover (actual migration)
az migrate migrate \
    --replicating-item-name migrated-vm \
    --migrate-project-name my-migrate-project \
    --resource-group myRG
```

## Database Migration

```bash
# SQL Server to Azure SQL
# Use Database Migration Service

az dms create \
    --name my-dms \
    --resource-group myRG \
    --location eastus \
    --sku-name Premium_4vCores \
    --subnet /subscriptions/.../subnets/dms-subnet

az dms project create \
    --name sql-migration \
    --service-name my-dms \
    --resource-group myRG \
    --source-platform SQL \
    --target-platform SQLDB
```

## Web App Migration

```powershell
# Use App Service Migration Assistant
# Scans IIS sites and creates migration plan

Invoke-WebRequest -Uri "https://appmigration.microsoft.com/api/download" -OutFile "AppServiceMigrationAssistant.msi"
msiexec /i AppServiceMigrationAssistant.msi /quiet
```

## Dependency Analysis

```bash
# Enable agentless dependency analysis
az migrate dependency-analysis enable \
    --migrate-project-name my-migrate-project \
    --resource-group myRG \
    --server-id discovered-server-id

# View dependencies
az migrate dependency list \
    --migrate-project-name my-migrate-project \
    --resource-group myRG \
    --server-id discovered-server-id
```

## Migration Waves

Plan migrations in groups:
1. Non-critical workloads (pilot)
2. Development/test servers
3. Production workloads
4. Business-critical systems

Azure Migrate: your path to the cloud.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
