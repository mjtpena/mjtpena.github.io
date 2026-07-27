---
title: "Azure Data Factory Linked Services: Connect Everything"
author: Michael John Peña
draft: false
date: 2020-10-23
tags:
  - Azure
  - Data Factory
  - Data Engineering
  - Integration

---

I wrote "Azure Data Factory Linked Services: Connect Everything" to share practical, production-minded guidance on this topic.

## Common Linked Services

### Azure Blob Storage

```json
{
    "name": "AzureBlobStorageLS",
    "type": "Microsoft.DataFactory/factories/linkedservices",
    "properties": {
        "type": "AzureBlobStorage",
        "typeProperties": {
            "connectionString": {
                "type": "AzureKeyVaultSecret",
                "store": {
                    "referenceName": "AzureKeyVaultLS",
                    "type": "LinkedServiceReference"
                },
                "secretName": "StorageConnectionString"
            }
        }
    }
}
```

### Azure SQL Database

```json
{
    "name": "AzureSqlLS",
    "properties": {
        "type": "AzureSqlDatabase",
        "typeProperties": {
            "connectionString": "Server=tcp:myserver.database.windows.net;Database=mydb;",
            "authenticationType": "ManagedIdentity"
        }
    }
}
```

### Azure Data Lake Storage Gen2

```json
{
    "name": "ADLSGen2LS",
    "properties": {
        "type": "AzureBlobFS",
        "typeProperties": {
            "url": "https://mystorageaccount.dfs.core.windows.net",
            "accountKey": {
                "type": "AzureKeyVaultSecret",
                "store": {
                    "referenceName": "AzureKeyVaultLS",
                    "type": "LinkedServiceReference"
                },
                "secretName": "ADLSKey"
            }
        }
    }
}
```

### Azure Synapse Analytics

```json
{
    "name": "SynapseLS",
    "properties": {
        "type": "AzureSqlDW",
        "typeProperties": {
            "connectionString": "Server=tcp:mysynapse.sql.azuresynapse.net;Database=pool1;",
            "authenticationType": "ManagedIdentity"
        }
    }
}
```

### Cosmos DB

```json
{
    "name": "CosmosDbLS",
    "properties": {
        "type": "CosmosDb",
        "typeProperties": {
            "connectionString": {
                "type": "AzureKeyVaultSecret",
                "store": { "referenceName": "AzureKeyVaultLS", "type": "LinkedServiceReference" },
                "secretName": "CosmosConnectionString"
            },
            "database": "mydb"
        }
    }
}
```

### SQL Server (On-Premises)

```json
{
    "name": "OnPremSqlLS",
    "properties": {
        "type": "SqlServer",
        "typeProperties": {
            "connectionString": "Server=myserver;Database=mydb;Integrated Security=True",
            "userName": "myuser",
            "password": {
                "type": "AzureKeyVaultSecret",
                "store": { "referenceName": "AzureKeyVaultLS", "type": "LinkedServiceReference" },
                "secretName": "SqlPassword"
            }
        },
        "connectVia": {
            "referenceName": "SelfHostedIR",
            "type": "IntegrationRuntimeReference"
        }
    }
}
```

## Key Vault Integration

```json
{
    "name": "AzureKeyVaultLS",
    "properties": {
        "type": "AzureKeyVault",
        "typeProperties": {
            "baseUrl": "https://mykeyvault.vault.azure.net/"
        }
    }
}
```

## Managed Identity Authentication

Best practice: use Managed Identity where supported.

```json
{
    "properties": {
        "type": "AzureBlobStorage",
        "typeProperties": {
            "serviceEndpoint": "https://mystorageaccount.blob.core.windows.net",
            "authenticationType": "ManagedIdentity"
        }
    }
}
```

## Parameterized Linked Services

```json
{
    "name": "ParameterizedSqlLS",
    "properties": {
        "type": "AzureSqlDatabase",
        "parameters": {
            "serverName": { "type": "String" },
            "databaseName": { "type": "String" }
        },
        "typeProperties": {
            "connectionString": "Server=tcp:@{linkedService().serverName}.database.windows.net;Database=@{linkedService().databaseName};"
        }
    }
}
```

## Best Practices

1. Store secrets in Key Vault
2. Use Managed Identity where possible
3. Parameterize for multiple environments
4. Use Self-Hosted IR for on-premises

Linked Services are the foundation of Data Factory connectivity.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
