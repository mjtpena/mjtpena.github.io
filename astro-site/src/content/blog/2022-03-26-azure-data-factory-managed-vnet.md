---
title: "Azure Data Factory Managed Virtual Network: Secure Data Integration"
author: Michael John Peña
draft: false
date: 2022-03-26
tags:
  - Azure
  - Data Factory
  - Networking
  - Security
  - Data Engineering

---

I wrote "Azure Data Factory Managed Virtual Network: Secure Data Integration" to share practical, production-minded guidance on this topic.

## Understanding Managed VNet

Managed VNet provides:
- **Isolated network**: Your integration runtime runs in a Microsoft-managed VNet
- **Private endpoints**: Connect privately to Azure services
- **No VNet management**: No peering, routing, or NSG configuration needed
- **Outbound control**: Control which resources can be accessed

## Enabling Managed VNet

### Create Data Factory with Managed VNet

```bash
# Azure CLI
az datafactory create \
    --resource-group myResourceGroup \
    --factory-name myDataFactory \
    --location eastus

# Enable Managed VNet Integration Runtime
az datafactory integration-runtime managed-virtual-network create \
    --resource-group myResourceGroup \
    --factory-name myDataFactory \
    --integration-runtime-name ManagedVnetIR \
    --type Managed \
    --managed-virtual-network-reference referenceName=default
```

### Terraform Configuration

```hcl
resource "azurerm_data_factory" "example" {
  name                = "adf-managed-vnet"
  location            = azurerm_resource_group.example.location
  resource_group_name = azurerm_resource_group.example.name

  managed_virtual_network_enabled = true

  identity {
    type = "SystemAssigned"
  }
}

resource "azurerm_data_factory_integration_runtime_azure" "managed_vnet" {
  name            = "ManagedVnetRuntime"
  data_factory_id = azurerm_data_factory.example.id
  location        = azurerm_resource_group.example.location

  virtual_network_enabled = true
}
```

## Creating Managed Private Endpoints

### To Azure SQL Database

```python
# Using Azure SDK
from azure.mgmt.datafactory import DataFactoryManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
client = DataFactoryManagementClient(credential, subscription_id)

# Create managed private endpoint
managed_pe = {
    "properties": {
        "privateLinkResourceId": "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Sql/servers/myserver",
        "groupId": "sqlServer",
        "fqdns": ["myserver.database.windows.net"]
    }
}

client.managed_private_endpoints.create_or_update(
    resource_group_name="myResourceGroup",
    factory_name="myDataFactory",
    managed_virtual_network_name="default",
    managed_private_endpoint_name="SqlServerPrivateEndpoint",
    managed_private_endpoint=managed_pe
)
```

### To Azure Storage

```bash
# Azure CLI
az datafactory managed-private-endpoint create \
    --resource-group myResourceGroup \
    --factory-name myDataFactory \
    --managed-virtual-network-name default \
    --managed-private-endpoint-name StoragePrivateEndpoint \
    --private-link-resource-id "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/mystorageaccount" \
    --group-id blob
```

### To Key Vault

```hcl
resource "azurerm_data_factory_managed_private_endpoint" "keyvault" {
  name               = "KeyVaultPrivateEndpoint"
  data_factory_id    = azurerm_data_factory.example.id
  target_resource_id = azurerm_key_vault.example.id
  subresource_name   = "vault"
}
```

## Approving Private Endpoint Connections

After creating managed private endpoints, they must be approved:

```bash
# List pending connections
az network private-endpoint-connection list \
    --resource-group myResourceGroup \
    --name mystorageaccount \
    --type Microsoft.Storage/storageAccounts

# Approve connection
az network private-endpoint-connection approve \
    --resource-group myResourceGroup \
    --resource-name mystorageaccount \
    --name "myDataFactory.StoragePrivateEndpoint" \
    --type Microsoft.Storage/storageAccounts
```

## Configuring Linked Services

### Azure SQL with Private Endpoint

```json
{
    "name": "AzureSqlPrivate",
    "type": "Microsoft.DataFactory/factories/linkedservices",
    "properties": {
        "type": "AzureSqlDatabase",
        "typeProperties": {
            "connectionString": {
                "type": "AzureKeyVaultSecret",
                "store": {
                    "referenceName": "AzureKeyVault",
                    "type": "LinkedServiceReference"
                },
                "secretName": "sql-connection-string"
            }
        },
        "connectVia": {
            "referenceName": "ManagedVnetRuntime",
            "type": "IntegrationRuntimeReference"
        }
    }
}
```

### Azure Blob Storage with Private Endpoint

```json
{
    "name": "BlobStoragePrivate",
    "type": "Microsoft.DataFactory/factories/linkedservices",
    "properties": {
        "type": "AzureBlobStorage",
        "typeProperties": {
            "serviceEndpoint": "https://mystorageaccount.blob.core.windows.net/",
            "accountKind": "StorageV2",
            "credential": {
                "referenceName": "ManagedIdentityCredential",
                "type": "CredentialReference"
            }
        },
        "connectVia": {
            "referenceName": "ManagedVnetRuntime",
            "type": "IntegrationRuntimeReference"
        }
    }
}
```

## Data Flow with Managed VNet

```json
{
    "name": "SecureDataFlow",
    "properties": {
        "type": "MappingDataFlow",
        "typeProperties": {
            "compute": {
                "coreCount": 8,
                "computeType": "General"
            }
        }
    }
}
```

Data Flows automatically use the managed VNet when connected to private endpoints.

## Supported Services

Managed private endpoints support:

| Service | Group ID |
|---------|----------|
| Azure SQL Database | sqlServer |
| Azure SQL Managed Instance | managedInstance |
| Azure Synapse Analytics | sql, sqlOnDemand |
| Azure Blob Storage | blob, dfs |
| Azure Data Lake Storage Gen2 | dfs |
| Azure Cosmos DB | Sql |
| Azure Key Vault | vault |
| Azure Purview | account |
| Azure Databricks | databricks_ui_api |

## Security Considerations

### Outbound Traffic Control

```python
# Check managed private endpoint status
endpoints = client.managed_private_endpoints.list_by_factory(
    resource_group_name="myResourceGroup",
    factory_name="myDataFactory",
    managed_virtual_network_name="default"
)

for endpoint in endpoints:
    print(f"Endpoint: {endpoint.name}")
    print(f"Status: {endpoint.properties.provisioning_state}")
    print(f"Connection State: {endpoint.properties.connection_state.status}")
```

### Diagnostic Logging

```bash
# Enable diagnostic settings
az monitor diagnostic-settings create \
    --name adf-diagnostics \
    --resource "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.DataFactory/factories/myDataFactory" \
    --logs '[{"category": "PipelineRuns", "enabled": true}, {"category": "TriggerRuns", "enabled": true}, {"category": "ActivityRuns", "enabled": true}]' \
    --workspace "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/myworkspace"
```

## Pipeline Example

```json
{
    "name": "SecureCopyPipeline",
    "properties": {
        "activities": [
            {
                "name": "CopyFromSqlToBlob",
                "type": "Copy",
                "inputs": [
                    {
                        "referenceName": "SqlSourceDataset",
                        "type": "DatasetReference"
                    }
                ],
                "outputs": [
                    {
                        "referenceName": "BlobSinkDataset",
                        "type": "DatasetReference"
                    }
                ],
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": "SELECT * FROM Sales WHERE ModifiedDate > @{pipeline().parameters.LastLoadDate}"
                    },
                    "sink": {
                        "type": "ParquetSink"
                    }
                }
            }
        ]
    }
}
```

## Hybrid Scenarios

### Connect to On-Premises via ExpressRoute

```hcl
# While managed VNet doesn't directly connect to on-prem,
# you can use Self-Hosted IR for on-prem sources

resource "azurerm_data_factory_integration_runtime_self_hosted" "onprem" {
  name            = "OnPremRuntime"
  data_factory_id = azurerm_data_factory.example.id
}

# Use managed VNet for Azure resources
# Use self-hosted IR for on-premises
```

### Mixed Integration Runtime Usage

```json
{
    "name": "HybridPipeline",
    "properties": {
        "activities": [
            {
                "name": "CopyFromOnPrem",
                "type": "Copy",
                "typeProperties": {
                    "source": {
                        "type": "SqlServerSource"
                    },
                    "sink": {
                        "type": "ParquetSink"
                    }
                },
                "linkedServiceName": {
                    "referenceName": "OnPremSqlServer",
                    "type": "LinkedServiceReference"
                }
            },
            {
                "name": "TransformInDataFlow",
                "type": "ExecuteDataFlow",
                "dependsOn": [{"activity": "CopyFromOnPrem", "dependencyConditions": ["Succeeded"]}],
                "typeProperties": {
                    "dataflow": {
                        "referenceName": "TransformationFlow",
                        "type": "DataFlowReference"
                    },
                    "integrationRuntime": {
                        "referenceName": "ManagedVnetRuntime",
                        "type": "IntegrationRuntimeReference"
                    }
                }
            }
        ]
    }
}
```

## Cost Considerations

- Managed VNet IR has a time-based cost (per hour of activity)
- Private endpoints have minimal additional cost
- Consider TTL settings for data flow debug sessions

```json
{
    "properties": {
        "type": "Managed",
        "typeProperties": {
            "computeProperties": {
                "dataFlowProperties": {
                    "computeType": "General",
                    "coreCount": 8,
                    "timeToLive": 10
                }
            }
        }
    }
}
```

## Best Practices

1. **Use managed identity**: Avoid storing credentials
2. **Create endpoints early**: Approval can take time
3. **Monitor endpoint health**: Check connection states regularly
4. **Plan for TTL**: Balance cost vs startup time
5. **Document endpoints**: Track which resources have private access

## Conclusion

Azure Data Factory Managed Virtual Network simplifies secure data integration:
- No VNet management overhead
- Private connectivity to Azure services
- Built-in security through private endpoints
- Seamless integration with data flows

For organizations requiring private data access without network complexity, managed VNet is the recommended approach.

## Resources

- [Managed Virtual Network Documentation](https://docs.microsoft.com/en-us/azure/data-factory/managed-virtual-network-private-endpoint)
- [Managed Private Endpoints](https://docs.microsoft.com/en-us/azure/data-factory/managed-virtual-network-private-endpoint#managed-private-endpoints)
- [Data Flow Network Security](https://docs.microsoft.com/en-us/azure/data-factory/data-flow-private-link)

