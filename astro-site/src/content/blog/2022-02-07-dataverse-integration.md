---
title: "Dataverse Integration: Connecting Power Platform to Azure"
author: Michael John Peña
draft: false
date: 2022-02-07
url: /blog/dataverse-integration/
tags:
  - dataverse
  - power-platform
  - azure
  - integration

---

I wrote "Dataverse Integration: Connecting Power Platform to Azure" to share practical, production-minded guidance on this topic.

## Understanding Dataverse

Dataverse provides:
- Relational data storage with rich metadata
- Business logic and security
- API access (OData, REST)
- Integration with Power Apps, Power Automate, and Dynamics 365

## Connecting to Dataverse from Azure

### Azure Data Factory Connection

```json
{
  "name": "DataverseLinkedService",
  "type": "Microsoft.DataFactory/factories/linkedservices",
  "properties": {
    "type": "CommonDataServiceForApps",
    "typeProperties": {
      "deploymentType": "Online",
      "organizationUrl": "https://yourorg.crm.dynamics.com",
      "authenticationType": "AADServicePrincipal",
      "servicePrincipalId": "<client-id>",
      "servicePrincipalCredentialType": "ServicePrincipalKey",
      "servicePrincipalCredential": {
        "type": "SecureString",
        "value": "<client-secret>"
      }
    }
  }
}
```

### Copy Data to Data Lake

```json
{
  "name": "CopyDataverseToLake",
  "type": "Copy",
  "inputs": [
    {
      "referenceName": "DataverseAccount",
      "type": "DatasetReference"
    }
  ],
  "outputs": [
    {
      "referenceName": "DataLakeParquet",
      "type": "DatasetReference"
    }
  ],
  "typeProperties": {
    "source": {
      "type": "CommonDataServiceForAppsSource",
      "query": "<fetch><entity name='account'><attribute name='accountid'/><attribute name='name'/><attribute name='revenue'/><filter><condition attribute='modifiedon' operator='ge' value='@{pipeline().parameters.LastModified}'/></filter></entity></fetch>"
    },
    "sink": {
      "type": "ParquetSink",
      "storeSettings": {
        "type": "AzureBlobFSWriteSettings"
      }
    }
  }
}
```

## Synapse Link for Dataverse

Enable continuous data sync to Azure:

```python
# After Synapse Link is configured, query Dataverse data in Synapse
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

# Read from Synapse Link exported data
accounts_df = spark.read \
    .format("delta") \
    .load("abfss://dataverse-org@storage.dfs.core.windows.net/account/")

# Perform analytics
accounts_df.filter("revenue > 1000000") \
    .groupBy("industrycode") \
    .agg({"revenue": "sum", "accountid": "count"}) \
    .show()
```

```sql
-- Query via Serverless SQL
SELECT
    name,
    revenue,
    industrycode_display as Industry
FROM OPENROWSET(
    BULK 'https://storage.dfs.core.windows.net/dataverse-org/account/',
    FORMAT = 'DELTA'
) AS accounts
WHERE revenue > 1000000
ORDER BY revenue DESC;
```

## Power Automate Integration

### Trigger on Dataverse Changes

```json
{
  "definition": {
    "triggers": {
      "When_a_row_is_created_modified_or_deleted": {
        "type": "OpenApiConnectionWebhook",
        "inputs": {
          "host": {
            "connectionName": "shared_commondataserviceforapps",
            "operationId": "SubscribeWebhookTrigger"
          },
          "parameters": {
            "subscriptionRequest/message": 3,
            "subscriptionRequest/entityname": "account",
            "subscriptionRequest/scope": 4,
            "subscriptionRequest/filteringattributes": "name,revenue"
          }
        }
      }
    },
    "actions": {
      "Send_to_Event_Hub": {
        "type": "ApiConnection",
        "inputs": {
          "host": {
            "connection": {
              "name": "@parameters('$connections')['eventhubs']['connectionId']"
            }
          },
          "method": "post",
          "body": {
            "ContentData": "@{base64(triggerBody())}"
          },
          "path": "/entities/dataverse-changes/messages"
        }
      }
    }
  }
}
```

## Azure Functions Dataverse Plugin

```csharp
using Microsoft.Azure.WebJobs;
using Microsoft.Extensions.Logging;
using Microsoft.PowerPlatform.Dataverse.Client;
using Microsoft.Xrm.Sdk;

public class DataverseFunction
{
    private readonly ServiceClient _serviceClient;

    public DataverseFunction(ServiceClient serviceClient)
    {
        _serviceClient = serviceClient;
    }

    [FunctionName("ProcessAccountUpdate")]
    public async Task Run(
        [ServiceBusTrigger("dataverse-account-updates")] string message,
        ILogger log)
    {
        var accountData = JsonConvert.DeserializeObject<AccountUpdate>(message);

        // Update related records in Dataverse
        var entity = new Entity("contact")
        {
            Id = accountData.PrimaryContactId
        };
        entity["description"] = $"Account revenue updated to {accountData.Revenue}";

        await _serviceClient.UpdateAsync(entity);

        log.LogInformation($"Updated contact for account {accountData.AccountId}");
    }
}

// Startup configuration
public class Startup : FunctionsStartup
{
    public override void Configure(IFunctionsHostBuilder builder)
    {
        var connectionString = Environment.GetEnvironmentVariable("DataverseConnection");
        builder.Services.AddSingleton(new ServiceClient(connectionString));
    }
}
```

## Virtual Tables

Connect external data as virtual tables in Dataverse:

```xml
<!-- Virtual Entity Provider Plugin -->
<plugin>
  <name>Azure SQL Virtual Provider</name>
  <configuration>
    <datasource type="azuresql">
      <connectionstring>
        Server=sql.database.windows.net;Database=ExternalDB;
      </connectionstring>
    </datasource>
    <entitymapping>
      <source>dbo.ExternalProducts</source>
      <target>new_virtualproduct</target>
      <columns>
        <column source="ProductID" target="new_productid" />
        <column source="ProductName" target="new_name" />
        <column source="Price" target="new_price" />
      </columns>
    </entitymapping>
  </configuration>
</plugin>
```

## Security and Access Control

```csharp
// Query with impersonation
var client = new ServiceClient(connectionString);

// Impersonate another user
client.CallerId = targetUserId;

// Query respects the impersonated user's security
var query = new QueryExpression("account")
{
    ColumnSet = new ColumnSet("name", "revenue"),
    Criteria = new FilterExpression
    {
        Conditions =
        {
            new ConditionExpression("statecode", ConditionOperator.Equal, 0)
        }
    }
};

var results = await client.RetrieveMultipleAsync(query);
```

Dataverse integration enables a seamless data platform spanning Power Platform and Azure services.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
