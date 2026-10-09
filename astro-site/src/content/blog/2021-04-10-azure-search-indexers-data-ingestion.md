---
title: Azure Search Indexers - Automated Data Ingestion Strategies
author: Michael John Peña
draft: false
date: 2021-04-10
url: /blog/azure-search-indexers-data-ingestion/
tags:
  - Azure
  - Cognitive Search
  - Indexers
  - Data Ingestion
  - ETL
---

## Understanding Indexers

Indexers handle the ETL process for search:

```
Data Source → Indexer → Skillset (optional) → Index
                ↓
           Field Mappings
           Output Field Mappings
           Change Detection
           Deletion Detection
```

## Supported Data Sources

### Azure Blob Storage

```json
{
  "name": "blob-datasource",
  "type": "azureblob",
  "credentials": {
    "connectionString": "DefaultEndpointsProtocol=https;AccountName=mystorageaccount;AccountKey=xxx"
  },
  "container": {
    "name": "documents",
    "query": "folder1/"
  }
}
```

### Azure SQL Database

```json
{
  "name": "sql-datasource",
  "type": "azuresql",
  "credentials": {
    "connectionString": "Server=tcp:myserver.database.windows.net,1433;Database=mydb;User ID=reader;Password=xxx;Encrypt=true"
  },
  "container": {
    "name": "dbo.Products",
    "query": "SELECT Id, Name, Description, Category, Price, ModifiedDate FROM Products WHERE IsActive = 1"
  }
}
```

### Azure Cosmos DB

```json
{
  "name": "cosmos-datasource",
  "type": "cosmosdb",
  "credentials": {
    "connectionString": "AccountEndpoint=https://myaccount.documents.azure.com;AccountKey=xxx;Database=mydb"
  },
  "container": {
    "name": "products",
    "query": "SELECT c.id, c.name, c.description, c.category, c._ts FROM c WHERE c.isIndexed = true"
  },
  "dataChangeDetectionPolicy": {
    "@odata.type": "#Microsoft.Azure.Search.HighWaterMarkChangeDetectionPolicy",
    "highWaterMarkColumnName": "_ts"
  }
}
```

### Azure Table Storage

```json
{
  "name": "table-datasource",
  "type": "azuretable",
  "credentials": {
    "connectionString": "DefaultEndpointsProtocol=https;AccountName=mystorageaccount;AccountKey=xxx"
  },
  "container": {
    "name": "customers",
    "query": "PartitionKey eq 'active'"
  }
}
```

## Configuring Indexers

### Basic Indexer Configuration

```json
{
  "name": "products-indexer",
  "dataSourceName": "sql-datasource",
  "targetIndexName": "products-index",
  "schedule": {
    "interval": "PT1H",
    "startTime": "2021-04-10T00:00:00Z"
  },
  "parameters": {
    "batchSize": 1000,
    "maxFailedItems": 10,
    "maxFailedItemsPerBatch": 5
  },
  "fieldMappings": [
    {
      "sourceFieldName": "Id",
      "targetFieldName": "productId"
    },
    {
      "sourceFieldName": "Name",
      "targetFieldName": "title"
    },
    {
      "sourceFieldName": "Description",
      "targetFieldName": "content"
    }
  ]
}
```

### Field Mapping Functions

```json
{
  "fieldMappings": [
    {
      "sourceFieldName": "metadata_storage_path",
      "targetFieldName": "id",
      "mappingFunction": {
        "name": "base64Encode",
        "parameters": {
          "useHttpServerUtilityUrlTokenEncode": false
        }
      }
    },
    {
      "sourceFieldName": "url",
      "targetFieldName": "decodedUrl",
      "mappingFunction": {
        "name": "urlDecode"
      }
    },
    {
      "sourceFieldName": "data",
      "targetFieldName": "decodedData",
      "mappingFunction": {
        "name": "base64Decode"
      }
    },
    {
      "sourceFieldName": "jsonField",
      "targetFieldName": "extractedValue",
      "mappingFunction": {
        "name": "jsonArrayToStringCollection"
      }
    }
  ]
}
```

## Change Detection Policies

### High Water Mark (SQL, Cosmos DB)

```json
{
  "dataChangeDetectionPolicy": {
    "@odata.type": "#Microsoft.Azure.Search.HighWaterMarkChangeDetectionPolicy",
    "highWaterMarkColumnName": "ModifiedDate"
  }
}
```

Requires a column that increases monotonically:

```sql
-- Ensure your table has a suitable column
ALTER TABLE Products ADD ModifiedDate datetime2 DEFAULT GETUTCDATE();

CREATE TRIGGER tr_Products_Update ON Products
AFTER UPDATE AS
BEGIN
    UPDATE Products
    SET ModifiedDate = GETUTCDATE()
    WHERE Id IN (SELECT Id FROM inserted);
END
```

### SQL Integrated Change Tracking

```json
{
  "dataChangeDetectionPolicy": {
    "@odata.type": "#Microsoft.Azure.Search.SqlIntegratedChangeTrackingPolicy"
  }
}
```

Enable change tracking on your database:

```sql
-- Enable at database level
ALTER DATABASE MyDatabase SET CHANGE_TRACKING = ON
(CHANGE_RETENTION = 7 DAYS, AUTO_CLEANUP = ON);

-- Enable at table level
ALTER TABLE Products ENABLE CHANGE_TRACKING;
```

## Deletion Detection

### Soft Delete Column

```json
{
  "dataDeletionDetectionPolicy": {
    "@odata.type": "#Microsoft.Azure.Search.SoftDeleteColumnDeletionDetectionPolicy",
    "softDeleteColumnName": "IsDeleted",
    "softDeleteMarkerValue": "true"
  }
}
```

### Native Blob Soft Delete

```json
{
  "dataDeletionDetectionPolicy": {
    "@odata.type": "#Microsoft.Azure.Search.NativeBlobSoftDeleteDeletionDetectionPolicy"
  }
}
```

## Blob Indexer Configuration

### Document Cracking Settings

```json
{
  "name": "blob-indexer",
  "dataSourceName": "blob-datasource",
  "targetIndexName": "documents-index",
  "parameters": {
    "configuration": {
      "dataToExtract": "contentAndMetadata",
      "parsingMode": "default",
      "imageAction": "generateNormalizedImages",
      "normalizedImageMaxWidth": 2000,
      "normalizedImageMaxHeight": 2000,
      "indexStorageMetadataOnlyForOversizedDocuments": true,
      "failOnUnsupportedContentType": false,
      "indexedFileNameExtensions": ".pdf,.docx,.doc,.pptx,.xlsx,.txt,.html",
      "excludedFileNameExtensions": ".zip,.exe"
    }
  }
}
```

### JSON Parsing Modes

#### JSON Arrays

```json
{
  "parameters": {
    "configuration": {
      "parsingMode": "jsonArray",
      "documentRoot": "/records"
    }
  }
}
```

Source JSON:
```json
{
  "records": [
    { "id": "1", "name": "Product A" },
    { "id": "2", "name": "Product B" }
  ]
}
```

#### JSON Lines

```json
{
  "parameters": {
    "configuration": {
      "parsingMode": "jsonLines"
    }
  }
}
```

Source file:
```
{"id": "1", "name": "Product A"}
{"id": "2", "name": "Product B"}
```

### CSV Parsing

```json
{
  "parameters": {
    "configuration": {
      "parsingMode": "delimitedText",
      "firstLineContainsHeaders": true,
      "delimitedTextDelimiter": ","
    }
  },
  "fieldMappings": [
    { "sourceFieldName": "Column1", "targetFieldName": "id" },
    { "sourceFieldName": "Column2", "targetFieldName": "title" }
  ]
}
```

## Performance Optimization

### Parallel Indexing

```json
{
  "parameters": {
    "maxFailedItems": -1,
    "maxFailedItemsPerBatch": -1,
    "configuration": {
      "executionEnvironment": "standard"
    }
  }
}
```

### Batch Size Tuning

```python
# Test different batch sizes
import time
from azure.search.documents.indexes import SearchIndexerClient

indexer_client = SearchIndexerClient(endpoint, credential)

batch_sizes = [100, 500, 1000, 2000]

for batch_size in batch_sizes:
    # Update indexer
    indexer = indexer_client.get_indexer("test-indexer")
    indexer.parameters.batch_size = batch_size
    indexer_client.create_or_update_indexer(indexer)

    # Reset and run
    indexer_client.reset_indexer("test-indexer")

    start = time.time()
    indexer_client.run_indexer("test-indexer")

    # Wait for completion
    while True:
        status = indexer_client.get_indexer_status("test-indexer")
        if status.last_result.status in ["success", "transientFailure"]:
            break
        time.sleep(5)

    duration = time.time() - start
    print(f"Batch size {batch_size}: {duration:.2f}s")
```

### Incremental Indexing Schedule

```json
{
  "schedule": {
    "interval": "PT5M",
    "startTime": "2021-04-10T00:00:00Z"
  }
}
```

Schedule intervals:
- `PT5M` - Every 5 minutes
- `PT1H` - Every hour
- `P1D` - Once per day

## Monitoring and Troubleshooting

### Check Indexer Status

```python
from azure.search.documents.indexes import SearchIndexerClient
from azure.core.credentials import AzureKeyCredential

endpoint = "https://your-search-service.search.windows.net"
credential = AzureKeyCredential("your-admin-key")

indexer_client = SearchIndexerClient(endpoint, credential)

# Get status
status = indexer_client.get_indexer_status("my-indexer")

print(f"Status: {status.status}")
print(f"Last Result: {status.last_result.status}")
print(f"Items Processed: {status.last_result.items_processed}")
print(f"Items Failed: {status.last_result.items_failed}")

# Check errors
if status.last_result.errors:
    for error in status.last_result.errors:
        print(f"Error: {error.key} - {error.error_message}")

# Check warnings
if status.last_result.warnings:
    for warning in status.last_result.warnings:
        print(f"Warning: {warning.key} - {warning.message}")
```

### Diagnostic Logging

```json
{
  "name": "my-indexer",
  "parameters": {
    "configuration": {
      "failOnUnsupportedContentType": false,
      "failOnUnprocessableDocument": false,
      "indexStorageMetadataOnlyForOversizedDocuments": true
    }
  }
}
```

## Common Patterns

### Multi-Source Index

```python
# Create indexers for different sources, same target index
indexers = [
    {
        "name": "sql-products-indexer",
        "dataSourceName": "sql-products",
        "targetIndexName": "unified-catalog",
        "fieldMappings": [
            {"sourceFieldName": "ProductId", "targetFieldName": "id"},
            {"sourceFieldName": "Name", "targetFieldName": "title"},
            {"sourceFieldName": "source", "targetFieldName": "sourceSystem", "mappingFunction": {"name": "constant", "parameters": {"value": "SQL"}}}
        ]
    },
    {
        "name": "cosmos-products-indexer",
        "dataSourceName": "cosmos-products",
        "targetIndexName": "unified-catalog",
        "fieldMappings": [
            {"sourceFieldName": "id", "targetFieldName": "id"},
            {"sourceFieldName": "name", "targetFieldName": "title"},
            {"sourceFieldName": "source", "targetFieldName": "sourceSystem", "mappingFunction": {"name": "constant", "parameters": {"value": "Cosmos"}}}
        ]
    }
]

for indexer_config in indexers:
    indexer_client.create_or_update_indexer(indexer_config)
```

### Scheduled Full Reindex

```python
import schedule
import time

def full_reindex():
    # Reset indexer to reprocess all documents
    indexer_client.reset_indexer("my-indexer")
    indexer_client.run_indexer("my-indexer")
    print(f"Full reindex started at {time.strftime('%Y-%m-%d %H:%M:%S')}")

# Schedule weekly full reindex
schedule.every().sunday.at("02:00").do(full_reindex)

while True:
    schedule.run_pending()
    time.sleep(60)
```

## Best Practices

1. **Use change detection** - Avoid full reindex when possible
2. **Configure appropriate schedules** - Balance freshness vs. cost
3. **Monitor failures** - Set up alerts for indexer errors
4. **Optimize batch sizes** - Test for your specific workload
5. **Use field mappings** - Transform data during indexing
6. **Handle oversized documents** - Configure graceful fallbacks
7. **Version your configuration** - Track indexer changes in source control

## Conclusion

Azure Cognitive Search indexers provide powerful, automated data ingestion from multiple sources. By understanding change detection, field mappings, and optimization strategies, you can build efficient search solutions that stay synchronized with your source data. The key is choosing the right configuration for your data characteristics and freshness requirements.
