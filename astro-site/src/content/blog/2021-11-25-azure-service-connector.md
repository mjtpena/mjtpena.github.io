---
title: "Azure Service Connector: Simplified Service-to-Service Connections"
description: "Azure Service Connector eliminates the boilerplate of connecting services while implementing security best practices. It's a significant productivity boost…"
author: Michael John Pena
draft: false
date: 2021-11-25
tags:
  - Azure
  - Service Connector
  - DevOps
  - Cloud Native
  - Security
---

## What is Azure Service Connector?

Service Connector provides:

- **Automated configuration**: Connection strings and environment variables
- **Multiple auth types**: System identity, user identity, connection string, service principal
- **Network configuration**: Private endpoints and firewall rules
- **Validation**: Test connections before deployment

## Supported Services

**Compute Services (Source)**:
- App Service
- Azure Functions
- Container Apps
- Azure Spring Apps
- Azure Kubernetes Service

**Target Services**:
- Azure SQL Database
- Azure Database for PostgreSQL/MySQL
- Cosmos DB
- Azure Storage
- Service Bus
- Event Hubs
- Key Vault
- Azure Cache for Redis

## Creating Service Connections

### Azure CLI

```bash
# Connect App Service to Azure SQL with managed identity
az webapp connection create sql \
    --resource-group rg-myapp \
    --name mywebapp \
    --target-resource-group rg-data \
    --server mysqlserver \
    --database mydb \
    --system-identity

# Connect to Cosmos DB
az webapp connection create cosmos-sql \
    --resource-group rg-myapp \
    --name mywebapp \
    --target-resource-group rg-data \
    --account mycosmosaccount \
    --database mydb \
    --system-identity

# Connect to Storage with connection string
az webapp connection create storage-blob \
    --resource-group rg-myapp \
    --name mywebapp \
    --target-resource-group rg-data \
    --account mystorageaccount \
    --secret

# Connect to Service Bus with user-assigned identity
az webapp connection create servicebus \
    --resource-group rg-myapp \
    --name mywebapp \
    --target-resource-group rg-messaging \
    --namespace myservicebus \
    --user-identity "/subscriptions/.../userAssignedIdentities/myidentity"

# List connections
az webapp connection list \
    --resource-group rg-myapp \
    --name mywebapp

# Validate connection
az webapp connection validate \
    --resource-group rg-myapp \
    --name mywebapp \
    --connection myconnection
```

### Bicep Template

```bicep
param appServiceName string
param sqlServerName string
param databaseName string
param location string = resourceGroup().location

resource appService 'Microsoft.Web/sites@2021-02-01' existing = {
  name: appServiceName
}

resource sqlServer 'Microsoft.Sql/servers@2021-05-01-preview' existing = {
  name: sqlServerName
}

resource database 'Microsoft.Sql/servers/databases@2021-05-01-preview' existing = {
  parent: sqlServer
  name: databaseName
}

// Create service connection with managed identity
resource sqlConnection 'Microsoft.ServiceLinker/linkers@2022-05-01' = {
  name: 'sql-connection'
  scope: appService
  properties: {
    targetService: {
      type: 'AzureResource'
      id: database.id
    }
    authInfo: {
      authType: 'systemAssignedIdentity'
    }
    clientType: 'dotnet'
    vNetSolution: {
      type: 'privateLink'
    }
  }
}

// Create Cosmos DB connection
resource cosmosConnection 'Microsoft.ServiceLinker/linkers@2022-05-01' = {
  name: 'cosmos-connection'
  scope: appService
  properties: {
    targetService: {
      type: 'AzureResource'
      id: cosmosAccount.id
    }
    authInfo: {
      authType: 'systemAssignedIdentity'
    }
    clientType: 'dotnet'
  }
}

// Create Storage connection with secret
resource storageConnection 'Microsoft.ServiceLinker/linkers@2022-05-01' = {
  name: 'storage-connection'
  scope: appService
  properties: {
    targetService: {
      type: 'AzureResource'
      id: storageAccount.id
    }
    authInfo: {
      authType: 'secret'
    }
    clientType: 'dotnet'
  }
}
```

## Using Connections in Code

### .NET Application

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

// Service Connector configures these automatically
// Azure SQL with Managed Identity
builder.Services.AddDbContext<AppDbContext>(options =>
{
    var connectionString = builder.Configuration["AZURE_SQL_CONNECTIONSTRING"];
    options.UseSqlServer(connectionString);
});

// Cosmos DB with Managed Identity
builder.Services.AddSingleton(sp =>
{
    var endpoint = builder.Configuration["AZURE_COSMOS_ENDPOINT"];
    var credential = new DefaultAzureCredential();
    return new CosmosClient(endpoint, credential);
});

// Storage with Managed Identity
builder.Services.AddSingleton(sp =>
{
    var endpoint = builder.Configuration["AZURE_STORAGE_ENDPOINT"];
    var credential = new DefaultAzureCredential();
    return new BlobServiceClient(new Uri(endpoint), credential);
});

// Service Bus with Managed Identity
builder.Services.AddSingleton(sp =>
{
    var fullyQualifiedNamespace = builder.Configuration["AZURE_SERVICEBUS_FULLYQUALIFIEDNAMESPACE"];
    var credential = new DefaultAzureCredential();
    return new ServiceBusClient(fullyQualifiedNamespace, credential);
});

// Redis with connection string
builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = builder.Configuration["AZURE_REDIS_CONNECTIONSTRING"];
});

var app = builder.Build();
app.Run();
```

### Using DefaultAzureCredential

```csharp
using Azure.Identity;
using Azure.Storage.Blobs;
using Azure.Messaging.ServiceBus;
using Microsoft.Azure.Cosmos;

public class AzureServiceFactory
{
    private readonly DefaultAzureCredential _credential;
    private readonly IConfiguration _config;

    public AzureServiceFactory(IConfiguration config)
    {
        _config = config;

        // DefaultAzureCredential works with:
        // - Managed Identity (in Azure)
        // - Visual Studio credentials (locally)
        // - Azure CLI credentials (locally)
        // - Environment variables
        _credential = new DefaultAzureCredential(new DefaultAzureCredentialOptions
        {
            ExcludeInteractiveBrowserCredential = true,
            ExcludeSharedTokenCacheCredential = true
        });
    }

    public BlobServiceClient CreateBlobClient()
    {
        var endpoint = _config["AZURE_STORAGE_ENDPOINT"]
            ?? throw new InvalidOperationException("Storage endpoint not configured");

        return new BlobServiceClient(new Uri(endpoint), _credential);
    }

    public CosmosClient CreateCosmosClient()
    {
        var endpoint = _config["AZURE_COSMOS_ENDPOINT"]
            ?? throw new InvalidOperationException("Cosmos endpoint not configured");

        return new CosmosClient(endpoint, _credential, new CosmosClientOptions
        {
            SerializerOptions = new CosmosSerializationOptions
            {
                PropertyNamingPolicy = CosmosPropertyNamingPolicy.CamelCase
            }
        });
    }

    public ServiceBusClient CreateServiceBusClient()
    {
        var namespace = _config["AZURE_SERVICEBUS_FULLYQUALIFIEDNAMESPACE"]
            ?? throw new InvalidOperationException("Service Bus namespace not configured");

        return new ServiceBusClient(namespace, _credential);
    }
}
```

### Node.js Application

```javascript
// app.js
const { DefaultAzureCredential } = require("@azure/identity");
const { BlobServiceClient } = require("@azure/storage-blob");
const { CosmosClient } = require("@azure/cosmos");
const { ServiceBusClient } = require("@azure/service-bus");

const credential = new DefaultAzureCredential();

// Storage - Service Connector sets AZURE_STORAGE_ENDPOINT
const blobClient = new BlobServiceClient(
    process.env.AZURE_STORAGE_ENDPOINT,
    credential
);

// Cosmos DB - Service Connector sets AZURE_COSMOS_ENDPOINT
const cosmosClient = new CosmosClient({
    endpoint: process.env.AZURE_COSMOS_ENDPOINT,
    aadCredentials: credential
});

// Service Bus - Service Connector sets AZURE_SERVICEBUS_FULLYQUALIFIEDNAMESPACE
const serviceBusClient = new ServiceBusClient(
    process.env.AZURE_SERVICEBUS_FULLYQUALIFIEDNAMESPACE,
    credential
);

// SQL Server with mssql package
const sql = require('mssql');

async function connectToSql() {
    // Service Connector sets AZURE_SQL_CONNECTIONSTRING
    const connectionString = process.env.AZURE_SQL_CONNECTIONSTRING;

    const config = {
        connectionString: connectionString,
        options: {
            encrypt: true
        }
    };

    await sql.connect(config);
}
```

## Private Endpoint Configuration

```bicep
param appServiceName string
param sqlServerName string
param vnetName string
param privateEndpointSubnetName string

resource vnet 'Microsoft.Network/virtualNetworks@2021-05-01' existing = {
  name: vnetName
}

resource peSubnet 'Microsoft.Network/virtualNetworks/subnets@2021-05-01' existing = {
  parent: vnet
  name: privateEndpointSubnetName
}

resource appService 'Microsoft.Web/sites@2021-02-01' existing = {
  name: appServiceName
}

resource sqlServer 'Microsoft.Sql/servers@2021-05-01-preview' existing = {
  name: sqlServerName
}

// Service Connector with private endpoint
resource sqlConnectionPrivate 'Microsoft.ServiceLinker/linkers@2022-05-01' = {
  name: 'sql-connection-private'
  scope: appService
  properties: {
    targetService: {
      type: 'AzureResource'
      id: sqlServer.id
    }
    authInfo: {
      authType: 'systemAssignedIdentity'
    }
    vNetSolution: {
      type: 'privateLink'
      deleteOrUpdateBehavior: 'Default'
    }
    clientType: 'dotnet'
  }
}

// The connection creates:
// 1. Private endpoint in the specified subnet
// 2. Private DNS zone and link
// 3. Managed identity role assignment
// 4. App settings with connection string
```

## Managing Connections

### PowerShell

```powershell
# Get all connections for an app
$connections = Get-AzServiceLinker -ResourceGroupName "rg-myapp" -ResourceName "mywebapp" -ResourceType "Microsoft.Web/sites"

# Update connection
Update-AzServiceLinker `
    -ResourceGroupName "rg-myapp" `
    -ResourceName "mywebapp" `
    -ResourceType "Microsoft.Web/sites" `
    -LinkerName "sql-connection" `
    -AuthType "systemAssignedIdentity"

# Validate all connections
foreach ($connection in $connections) {
    $result = Test-AzServiceLinkerConnection `
        -ResourceGroupName "rg-myapp" `
        -ResourceName "mywebapp" `
        -ResourceType "Microsoft.Web/sites" `
        -LinkerName $connection.Name

    if ($result.Status -ne "Healthy") {
        Write-Warning "Connection $($connection.Name) is unhealthy: $($result.Message)"
    }
}

# Delete connection
Remove-AzServiceLinker `
    -ResourceGroupName "rg-myapp" `
    -ResourceName "mywebapp" `
    -ResourceType "Microsoft.Web/sites" `
    -LinkerName "old-connection"
```

### Terraform

```hcl
# Service Connector for App Service to SQL
resource "azurerm_app_service_connection" "sql" {
  name               = "sql-connection"
  app_service_id     = azurerm_linux_web_app.app.id
  target_resource_id = azurerm_mssql_database.db.id
  client_type        = "dotnet"

  authentication {
    type = "systemAssignedIdentity"
  }
}

# Service Connector to Cosmos DB
resource "azurerm_app_service_connection" "cosmos" {
  name               = "cosmos-connection"
  app_service_id     = azurerm_linux_web_app.app.id
  target_resource_id = azurerm_cosmosdb_account.cosmos.id
  client_type        = "dotnet"

  authentication {
    type = "systemAssignedIdentity"
  }
}

# Service Connector to Storage
resource "azurerm_app_service_connection" "storage" {
  name               = "storage-connection"
  app_service_id     = azurerm_linux_web_app.app.id
  target_resource_id = azurerm_storage_account.storage.id
  client_type        = "dotnet"

  authentication {
    type = "systemAssignedIdentity"
  }
}
```

Azure Service Connector eliminates the boilerplate of connecting services while implementing security best practices. It's a significant productivity boost for developers building cloud-native applications.

## Resources

- [Service Connector Documentation](https://docs.microsoft.com/en-us/azure/service-connector/overview)
- [Supported Services](https://docs.microsoft.com/en-us/azure/service-connector/overview#supported-connections)
- [DefaultAzureCredential](https://docs.microsoft.com/en-us/dotnet/api/azure.identity.defaultazurecredential)
