---
title: "Azure SQL Managed Instance: SQL Server in the Cloud"
description: "Things you can't do in Azure SQL Database but can in Managed Instance. Real-time replication from on-premises SQL Server to Managed Instance - useful for…"
author: Michael John Peña
draft: false
date: 2020-09-10
tags:
  - Azure
  - SQL Server
  - Database
  - Migration
---

## Why Managed Instance?

- 100% SQL Server compatibility
- SQL Agent jobs
- Cross-database queries
- CLR support
- Linked servers
- Service Broker

Things you can't do in Azure SQL Database but can in Managed Instance.

## Migration Approach

```bash
# Using Azure Database Migration Service
az dms project task create \
    --resource-group migration-rg \
    --service-name dms-service \
    --project-name sql-migration \
    --name migrate-db \
    --source-connection-json @source.json \
    --target-connection-json @target.json \
    --database-options-json @dboptions.json
```

## Key Features

### VNet Integration

Managed Instance runs inside your VNet - no public endpoint by default:

```hcl
resource "azurerm_sql_managed_instance" "mi" {
  name                         = "my-managed-instance"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  subnet_id                    = azurerm_subnet.mi.id
  administrator_login          = "miadmin"
  administrator_login_password = var.mi_password
  sku_name                     = "GP_Gen5_8"
}
```

### Link Feature (Preview)

Real-time replication from on-premises SQL Server to Managed Instance - useful for migration and hybrid scenarios.

## Cost Optimization

- Reserve capacity for significant savings (up to 55%)
- Use Azure Hybrid Benefit if you have SQL licenses
- Start with General Purpose, scale to Business Critical if needed

Managed Instance is the best choice for lift-and-shift SQL Server migrations where full compatibility matters.
