---
title: "Continuous Backup in Azure Cosmos DB"
description: "Unlike periodic backup mode, continuous backup captures every change as it happens, allowing granular point-in-time recovery down to the second."
author: "Michael John Peña"
draft: false
date: 2022-09-04
tags: ["Azure", "Cosmos DB", "Backup", "Disaster Recovery"]
---

## Understanding Continuous Backup

Unlike periodic backup mode, continuous backup captures every change as it happens, allowing granular point-in-time recovery down to the second.

### Enabling Continuous Backup

```csharp
using Microsoft.Azure.Cosmos;

// Create account with continuous backup (via ARM template or CLI)
// az cosmosdb create --name mycosmosdb --resource-group myRG --backup-policy-type Continuous

// Connect to the account
var cosmosClient = new CosmosClient(
    connectionString,
    new CosmosClientOptions
    {
        ApplicationName = "BackupDemo",
        ConsistencyLevel = ConsistencyLevel.Session
    });

// Continuous backup is configured at the account level
// All databases and containers inherit this setting
```

### ARM Template for Continuous Backup

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "resources": [
        {
            "type": "Microsoft.DocumentDB/databaseAccounts",
            "apiVersion": "2022-05-15",
            "name": "[parameters('accountName')]",
            "location": "[parameters('location')]",
            "properties": {
                "databaseAccountOfferType": "Standard",
                "backupPolicy": {
                    "type": "Continuous",
                    "continuousModeProperties": {
                        "tier": "Continuous30Days"
                    }
                },
                "locations": [
                    {
                        "locationName": "[parameters('location')]",
                        "failoverPriority": 0
                    }
                ]
            }
        }
    ]
}
```

### Checking Backup Status

```csharp
public class BackupManager
{
    private readonly CosmosClient _client;

    public BackupManager(CosmosClient client)
    {
        _client = client;
    }

    public async Task<AccountProperties> GetAccountPropertiesAsync()
    {
        var account = await _client.ReadAccountAsync();

        Console.WriteLine($"Account ID: {account.Id}");
        Console.WriteLine($"Consistency Level: {account.ConsistencyLevel}");
        Console.WriteLine($"Regions: {string.Join(", ", account.ReadableRegions.Select(r => r.Name))}");

        return account;
    }

    // Note: Actual backup status requires Azure Resource Manager API
    public async Task CheckBackupStatusAsync(
        string subscriptionId,
        string resourceGroup,
        string accountName)
    {
        // Use Azure Management SDK
        var credential = new DefaultAzureCredential();
        var armClient = new ArmClient(credential);

        var resourceId = CosmosDBAccountResource.CreateResourceIdentifier(
            subscriptionId, resourceGroup, accountName);

        var cosmosAccount = armClient.GetCosmosDBAccountResource(resourceId);
        var accountData = await cosmosAccount.GetAsync();

        Console.WriteLine($"Backup Policy: {accountData.Value.Data.BackupPolicy.BackupPolicyType}");
    }
}
```

### Working with Continuous Backup Data

```csharp
public class DataProtectionService
{
    private readonly Container _container;
    private readonly ILogger<DataProtectionService> _logger;

    public DataProtectionService(Container container, ILogger<DataProtectionService> logger)
    {
        _container = container;
        _logger = logger;
    }

    // Track timestamps for potential restore points
    public async Task<string> CreateDocumentWithTimestampAsync<T>(T document) where T : class
    {
        var timestamp = DateTime.UtcNow;

        var response = await _container.CreateItemAsync(document);

        _logger.LogInformation(
            $"Document created at {timestamp:O}. " +
            $"Can restore to this point within retention period.");

        return timestamp.ToString("O");
    }

    // Simulate tracking restore points
    public class RestorePointTracker
    {
        private readonly List<RestorePoint> _restorePoints = new();

        public void RecordRestorePoint(string description)
        {
            _restorePoints.Add(new RestorePoint
            {
                Timestamp = DateTime.UtcNow,
                Description = description
            });
        }

        public IEnumerable<RestorePoint> GetRestorePoints() => _restorePoints.AsReadOnly();
    }

    public class RestorePoint
    {
        public DateTime Timestamp { get; set; }
        public string Description { get; set; }
    }
}
```

### Azure CLI Commands for Continuous Backup

```bash
#!/bin/bash

# Check current backup policy
az cosmosdb show \
    --name mycosmosdb \
    --resource-group myRG \
    --query "backupPolicy"

# List restorable database accounts
az cosmosdb restorable-database-account list \
    --location "East US"

# Get restorable timestamps
az cosmosdb sql restorable-database list \
    --instance-id <instance-id> \
    --location "East US"

# Get restorable containers
az cosmosdb sql restorable-container list \
    --instance-id <instance-id> \
    --location "East US" \
    --database-rid <database-rid>
```

### Implementing Backup Verification

```csharp
public class BackupVerificationService
{
    private readonly Container _sourceContainer;
    private readonly ILogger _logger;

    public async Task VerifyDataIntegrityAsync()
    {
        // Count documents
        var countQuery = new QueryDefinition("SELECT VALUE COUNT(1) FROM c");
        using var iterator = _sourceContainer.GetItemQueryIterator<int>(countQuery);

        var count = 0;
        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync();
            count = response.FirstOrDefault();
        }

        _logger.LogInformation($"Current document count: {count}");

        // Sample checksum verification
        var checksumQuery = new QueryDefinition(
            "SELECT c.id, c._ts FROM c ORDER BY c._ts DESC OFFSET 0 LIMIT 100");

        using var checksumIterator = _sourceContainer.GetItemQueryIterator<dynamic>(checksumQuery);

        var latestTimestamp = DateTime.MinValue;
        while (checksumIterator.HasMoreResults)
        {
            var response = await checksumIterator.ReadNextAsync();
            foreach (var doc in response)
            {
                var ts = DateTimeOffset.FromUnixTimeSeconds((long)doc._ts).UtcDateTime;
                if (ts > latestTimestamp) latestTimestamp = ts;
            }
        }

        _logger.LogInformation($"Latest document timestamp: {latestTimestamp:O}");
        _logger.LogInformation("Data integrity verification complete.");
    }
}
```

## Key Features of Continuous Backup

1. **30-day or 7-day retention** - Choose based on your compliance needs
2. **Second-level granularity** - Restore to any point in time
3. **Account-level configuration** - Applies to all databases and containers
4. **Self-service restore** - Restore via Azure Portal, CLI, or SDK
5. **No performance impact** - Backups don't affect production throughput

Continuous backup provides peace of mind for mission-critical applications where data loss is unacceptable.
