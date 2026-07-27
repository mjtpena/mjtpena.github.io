---
title: "Azure Key Vault Secret Rotation: Automating Credential Management"
author: Michael John Peña
draft: false
date: 2022-02-16
url: /blog/azure-key-vault-rotation/
tags:
  - azure
  - key-vault
  - secrets
  - automation

---

I wrote "Azure Key Vault Secret Rotation: Automating Credential Management" to share practical, production-minded guidance on this topic.

## Automatic Rotation for Storage Accounts

```bicep
// Enable automatic rotation for storage account keys
resource keyVault 'Microsoft.KeyVault/vaults@2021-11-01-preview' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
  }
}

resource storageAccountKey 'Microsoft.KeyVault/vaults/secrets@2021-11-01-preview' = {
  parent: keyVault
  name: 'storage-account-key'
  properties: {
    value: storageAccount.listKeys().keys[0].value
    attributes: {
      enabled: true
      exp: dateTimeAdd(utcNow(), 'P90D')  // Expire in 90 days
    }
    contentType: 'application/vnd.ms-StorageAccountAccessKey'
  }
}
```

## Event-Based Rotation with Azure Functions

```csharp
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;
using Microsoft.Azure.WebJobs;
using Microsoft.Extensions.Logging;

public class SecretRotationFunction
{
    private readonly SecretClient _secretClient;

    public SecretRotationFunction()
    {
        var credential = new DefaultAzureCredential();
        _secretClient = new SecretClient(
            new Uri(Environment.GetEnvironmentVariable("KeyVaultUri")),
            credential);
    }

    [FunctionName("RotateStorageKey")]
    public async Task RotateStorageKey(
        [EventGridTrigger] EventGridEvent eventGridEvent,
        ILogger log)
    {
        var secretName = eventGridEvent.Subject;

        if (eventGridEvent.EventType == "Microsoft.KeyVault.SecretNearExpiry")
        {
            log.LogInformation($"Secret {secretName} is near expiry, rotating...");

            // Get current secret metadata
            var currentSecret = await _secretClient.GetSecretAsync(secretName);
            var tags = currentSecret.Value.Properties.Tags;

            if (tags.TryGetValue("ResourceId", out var resourceId))
            {
                // Rotate the storage key
                var newKey = await RotateStorageAccountKeyAsync(resourceId);

                // Update the secret
                await _secretClient.SetSecretAsync(
                    secretName,
                    newKey,
                    new SecretContentType("application/vnd.ms-StorageAccountAccessKey"));

                log.LogInformation($"Successfully rotated secret {secretName}");
            }
        }
    }

    private async Task<string> RotateStorageAccountKeyAsync(string resourceId)
    {
        var credential = new DefaultAzureCredential();
        var armClient = new ArmClient(credential);

        var storageAccount = armClient.GetStorageAccountResource(new ResourceIdentifier(resourceId));

        // Regenerate key1
        var keys = await storageAccount.RegenerateKeyAsync(
            new StorageAccountRegenerateKeyContent("key1"));

        return keys.Value.Keys.First(k => k.KeyName == "key1").Value;
    }
}
```

## Event Grid Configuration

```bicep
// Configure Event Grid for secret expiry notifications
resource eventGridSubscription 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2021-12-01' = {
  parent: keyVaultTopic
  name: 'secret-expiry-subscription'
  properties: {
    destination: {
      endpointType: 'AzureFunction'
      properties: {
        resourceId: functionApp.id
        maxEventsPerBatch: 1
        preferredBatchSizeInKilobytes: 64
      }
    }
    filter: {
      includedEventTypes: [
        'Microsoft.KeyVault.SecretNearExpiry'
        'Microsoft.KeyVault.SecretExpired'
      ]
      subjectBeginsWith: ''
      subjectEndsWith: ''
    }
    eventDeliverySchema: 'EventGridSchema'
    retryPolicy: {
      maxDeliveryAttempts: 30
      eventTimeToLiveInMinutes: 1440
    }
  }
}

resource keyVaultTopic 'Microsoft.EventGrid/systemTopics@2021-12-01' = {
  name: 'keyvault-events'
  location: location
  properties: {
    source: keyVault.id
    topicType: 'Microsoft.KeyVault.vaults'
  }
}
```

## SQL Server Password Rotation

```csharp
public class SqlPasswordRotator
{
    private readonly SecretClient _secretClient;
    private readonly string _sqlServerResourceId;

    public async Task RotateSqlPasswordAsync(string secretName)
    {
        // Generate new secure password
        var newPassword = GenerateSecurePassword();

        // Update SQL Server
        await UpdateSqlServerPasswordAsync(newPassword);

        // Update Key Vault secret
        var secret = new KeyVaultSecret(secretName, newPassword)
        {
            Properties =
            {
                ExpiresOn = DateTimeOffset.UtcNow.AddDays(90),
                Tags =
                {
                    ["ResourceId"] = _sqlServerResourceId,
                    ["RotatedAt"] = DateTime.UtcNow.ToString("O")
                }
            }
        };

        await _secretClient.SetSecretAsync(secret);

        // Store old password temporarily for rollback
        var oldSecretName = $"{secretName}-previous";
        await _secretClient.SetSecretAsync(
            oldSecretName,
            await GetCurrentPasswordAsync(secretName));
    }

    private string GenerateSecurePassword()
    {
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
        var random = RandomNumberGenerator.Create();
        var bytes = new byte[32];
        random.GetBytes(bytes);

        return new string(bytes.Select(b => chars[b % chars.Length]).ToArray());
    }

    private async Task UpdateSqlServerPasswordAsync(string newPassword)
    {
        var credential = new DefaultAzureCredential();
        var armClient = new ArmClient(credential);

        var sqlServer = armClient.GetSqlServerResource(new ResourceIdentifier(_sqlServerResourceId));

        await sqlServer.UpdateAsync(WaitUntil.Completed, new SqlServerPatch
        {
            AdministratorLoginPassword = newPassword
        });
    }
}
```

## Monitoring Rotation

```kusto
// Track secret rotation events
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.KEYVAULT"
| where OperationName in ("SecretSet", "SecretGet", "SecretNearExpiry")
| project
    TimeGenerated,
    OperationName,
    SecretName = id_s,
    CallerIPAddress,
    ResultType
| order by TimeGenerated desc

// Alert on rotation failures
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.KEYVAULT"
| where OperationName == "SecretSet"
| where ResultType != "Success"
| project
    TimeGenerated,
    SecretName = id_s,
    ResultType,
    ResultDescription
```

## Best Practices

1. **Set appropriate expiry** - 90 days is common
2. **Test rotation thoroughly** - Verify applications handle rotation
3. **Keep previous version** - Allow rollback if needed
4. **Monitor closely** - Alert on rotation failures
5. **Stagger rotations** - Avoid rotating everything at once

Automated secret rotation ensures credentials remain secure while reducing operational burden.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
