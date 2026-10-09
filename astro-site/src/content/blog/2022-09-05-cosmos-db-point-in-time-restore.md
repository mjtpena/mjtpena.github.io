---
title: "Point-in-Time Restore in Azure Cosmos DB"
description: "PITR works with the continuous backup feature to provide granular recovery options. You can restore entire accounts, specific databases, or individual…"
author: "Michael John Peña"
draft: false
date: 2022-09-05
tags: ["Azure", "Cosmos DB", "Backup", "Recovery", "PITR"]
---

## Understanding Point-in-Time Restore

PITR works with the continuous backup feature to provide granular recovery options. You can restore entire accounts, specific databases, or individual containers.

### Prerequisites for PITR

```csharp
// PITR requires continuous backup mode
// Check your account's backup policy first

using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.CosmosDB;

public class PITRPrerequisites
{
    public async Task<bool> CheckPITRCapabilityAsync(
        string subscriptionId,
        string resourceGroup,
        string accountName)
    {
        var credential = new DefaultAzureCredential();
        var armClient = new ArmClient(credential);

        var resourceId = CosmosDBAccountResource.CreateResourceIdentifier(
            subscriptionId, resourceGroup, accountName);

        var account = armClient.GetCosmosDBAccountResource(resourceId);
        var data = await account.GetAsync();

        var backupPolicy = data.Value.Data.BackupPolicy;

        if (backupPolicy is ContinuousModeBackupPolicy continuousPolicy)
        {
            Console.WriteLine("Continuous backup is enabled - PITR is available");
            Console.WriteLine($"Tier: {continuousPolicy.ContinuousModeProperties?.Tier}");
            return true;
        }

        Console.WriteLine("PITR requires continuous backup mode");
        return false;
    }
}
```

### Finding Restorable Resources

```bash
#!/bin/bash

# List all restorable database accounts
az cosmosdb restorable-database-account list \
    --location "eastus" \
    --output table

# Get the instance ID from the above command, then list restorable databases
INSTANCE_ID="your-instance-id"

az cosmosdb sql restorable-database list \
    --instance-id $INSTANCE_ID \
    --location "eastus"

# List restorable containers for a specific database
az cosmosdb sql restorable-container list \
    --instance-id $INSTANCE_ID \
    --location "eastus" \
    --database-rid "database-resource-id"

# Get restore timestamp range
az cosmosdb restorable-database-account show \
    --instance-id $INSTANCE_ID \
    --location "eastus" \
    --query "{oldestTime:oldestRestorableTime, account:accountName}"
```

### Performing a Point-in-Time Restore

```bash
#!/bin/bash

# Restore to a new account at a specific timestamp
az cosmosdb restore \
    --target-database-account-name "mycosmosdb-restored" \
    --account-name "mycosmosdb" \
    --restore-timestamp "2022-09-05T10:30:00Z" \
    --location "eastus" \
    --resource-group "myRG"

# Restore specific databases only
az cosmosdb restore \
    --target-database-account-name "mycosmosdb-restored" \
    --account-name "mycosmosdb" \
    --restore-timestamp "2022-09-05T10:30:00Z" \
    --location "eastus" \
    --resource-group "myRG" \
    --databases-to-restore name="ProductsDB" collections="Products" "Orders"

# Restore with specific containers
az cosmosdb restore \
    --target-database-account-name "mycosmosdb-restored" \
    --account-name "mycosmosdb" \
    --restore-timestamp "2022-09-05T10:30:00Z" \
    --location "eastus" \
    --resource-group "myRG" \
    --databases-to-restore name="ProductsDB" collections="Products"
```

### Programmatic Restore with ARM

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "restoreTimestamp": {
            "type": "string",
            "metadata": {
                "description": "ISO 8601 timestamp for restore point"
            }
        },
        "sourceAccountName": {
            "type": "string"
        },
        "targetAccountName": {
            "type": "string"
        }
    },
    "resources": [
        {
            "type": "Microsoft.DocumentDB/databaseAccounts",
            "apiVersion": "2022-05-15",
            "name": "[parameters('targetAccountName')]",
            "location": "[resourceGroup().location]",
            "properties": {
                "createMode": "Restore",
                "restoreParameters": {
                    "restoreMode": "PointInTime",
                    "restoreSource": "[resourceId('Microsoft.DocumentDB/databaseAccounts', parameters('sourceAccountName'))]",
                    "restoreTimestampInUtc": "[parameters('restoreTimestamp')]",
                    "databasesToRestore": [
                        {
                            "databaseName": "ProductsDB",
                            "collectionNames": ["Products", "Orders", "Customers"]
                        }
                    ]
                },
                "databaseAccountOfferType": "Standard",
                "locations": [
                    {
                        "locationName": "[resourceGroup().location]",
                        "failoverPriority": 0
                    }
                ]
            }
        }
    ]
}
```

### Post-Restore Validation

```csharp
public class RestoreValidator
{
    private readonly CosmosClient _sourceClient;
    private readonly CosmosClient _restoredClient;
    private readonly ILogger<RestoreValidator> _logger;

    public RestoreValidator(
        string sourceConnectionString,
        string restoredConnectionString,
        ILogger<RestoreValidator> logger)
    {
        _sourceClient = new CosmosClient(sourceConnectionString);
        _restoredClient = new CosmosClient(restoredConnectionString);
        _logger = logger;
    }

    public async Task<ValidationResult> ValidateRestoreAsync(
        string databaseId,
        string containerId)
    {
        var result = new ValidationResult();

        var sourceContainer = _sourceClient.GetContainer(databaseId, containerId);
        var restoredContainer = _restoredClient.GetContainer(databaseId, containerId);

        // Compare document counts
        var sourceCount = await GetDocumentCountAsync(sourceContainer);
        var restoredCount = await GetDocumentCountAsync(restoredContainer);

        result.SourceCount = sourceCount;
        result.RestoredCount = restoredCount;

        _logger.LogInformation(
            $"Source count: {sourceCount}, Restored count: {restoredCount}");

        // Sample data comparison
        var sampleIds = await GetSampleDocumentIdsAsync(restoredContainer, 100);

        foreach (var id in sampleIds)
        {
            var restored = await TryGetDocumentAsync(restoredContainer, id);
            if (restored != null)
            {
                result.ValidatedDocuments++;
            }
            else
            {
                result.MissingDocuments++;
                _logger.LogWarning($"Document {id} not found in restored container");
            }
        }

        result.IsValid = result.MissingDocuments == 0;
        return result;
    }

    private async Task<int> GetDocumentCountAsync(Container container)
    {
        var query = new QueryDefinition("SELECT VALUE COUNT(1) FROM c");
        using var iterator = container.GetItemQueryIterator<int>(query);

        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync();
            return response.FirstOrDefault();
        }

        return 0;
    }

    private async Task<List<string>> GetSampleDocumentIdsAsync(Container container, int count)
    {
        var query = new QueryDefinition($"SELECT c.id FROM c OFFSET 0 LIMIT {count}");
        var ids = new List<string>();

        using var iterator = container.GetItemQueryIterator<dynamic>(query);
        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync();
            ids.AddRange(response.Select(d => (string)d.id));
        }

        return ids;
    }

    private async Task<dynamic> TryGetDocumentAsync(Container container, string id)
    {
        try
        {
            var response = await container.ReadItemAsync<dynamic>(
                id,
                PartitionKey.None);
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }
}

public class ValidationResult
{
    public int SourceCount { get; set; }
    public int RestoredCount { get; set; }
    public int ValidatedDocuments { get; set; }
    public int MissingDocuments { get; set; }
    public bool IsValid { get; set; }
}
```

## Best Practices

1. **Document restore points** - Keep records of critical timestamps
2. **Test restores regularly** - Verify your disaster recovery process
3. **Use appropriate retention** - Choose 7 or 30 days based on requirements
4. **Validate after restore** - Always verify data integrity post-restore
5. **Plan for RTO** - Restore time depends on data size

Point-in-time restore is your safety net for protecting critical data in Azure Cosmos DB.
