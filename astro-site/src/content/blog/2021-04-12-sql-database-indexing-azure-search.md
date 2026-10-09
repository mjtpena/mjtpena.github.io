---
title: SQL Database Indexing with Azure Cognitive Search
description: "Azure SQL to Cognitive Search is a combination I've set up half a dozen times, and the reason it keeps appearing is that most enterprise organisations…"
author: Michael John Peña
draft: false
date: 2021-04-12
url: /blog/sql-database-indexing-azure-search/
tags:
  - Azure
  - SQL Database
  - Cognitive Search
  - Data Integration
  - Search
---

Azure SQL to Cognitive Search is a combination I've set up half a dozen times, and the reason it keeps appearing is that most enterprise organisations already have their structured data in SQL—products, customers, articles, knowledge base entries—and want proper full-text search without the limitations of SQL Server's full-text index or LIKE operators. The SQL indexer uses a high watermark change detection column (usually a rowversion or LastModified timestamp) to do efficient incremental updates. The field mapping between SQL column names and search field names needs careful planning if you're projecting joins or computed columns. Today's post is the configuration that works in production and the performance pitfalls I've learned to avoid.

## Why Index SQL Data in Cognitive Search?

While SQL databases have built-in search capabilities, Cognitive Search offers:

- **Full-text search** with linguistic analysis
- **Relevance ranking** with customizable scoring
- **Faceted navigation** for filtering
- **Fuzzy matching** and synonyms
- **AI enrichment** capabilities
- **Combined search** across multiple sources

## Setting Up SQL Data Source

### Basic Configuration

```json
{
  "name": "products-sql-datasource",
  "type": "azuresql",
  "credentials": {
    "connectionString": "Server=tcp:myserver.database.windows.net,1433;Database=ProductDB;User ID=searchreader;Password=xxx;Encrypt=true;TrustServerCertificate=false;Connection Timeout=30;"
  },
  "container": {
    "name": "dbo.Products",
    "query": null
  }
}
```

### Using Custom Query

```json
{
  "name": "products-sql-datasource",
  "type": "azuresql",
  "credentials": {
    "connectionString": "connection-string-here"
  },
  "container": {
    "name": "dbo.Products",
    "query": "SELECT p.ProductId, p.Name, p.Description, p.Price, p.ModifiedDate, c.CategoryName, b.BrandName FROM dbo.Products p INNER JOIN dbo.Categories c ON p.CategoryId = c.CategoryId INNER JOIN dbo.Brands b ON p.BrandId = b.BrandId WHERE p.IsActive = 1"
  }
}
```

### Using Managed Identity

```json
{
  "name": "products-sql-datasource",
  "type": "azuresql",
  "credentials": {
    "connectionString": "Server=tcp:myserver.database.windows.net,1433;Database=ProductDB;Authentication=Active Directory Managed Identity;Encrypt=true;"
  },
  "container": {
    "name": "dbo.Products"
  }
}
```

Grant permissions:

```sql
-- In Azure SQL Database
CREATE USER [search-service-name] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [search-service-name];
```

## Change Detection Strategies

### High Water Mark Policy

Best for tables with a timestamp column that updates on changes:

```json
{
  "dataChangeDetectionPolicy": {
    "@odata.type": "#Microsoft.Azure.Search.HighWaterMarkChangeDetectionPolicy",
    "highWaterMarkColumnName": "ModifiedDate"
  }
}
```

Ensure your table has proper triggers:

```sql
-- Create the ModifiedDate column
ALTER TABLE Products ADD ModifiedDate datetime2
    CONSTRAINT DF_Products_ModifiedDate DEFAULT GETUTCDATE();

-- Create index for efficient querying
CREATE INDEX IX_Products_ModifiedDate ON Products(ModifiedDate);

-- Update trigger
CREATE TRIGGER tr_Products_UpdateModifiedDate ON Products
AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE Products
    SET ModifiedDate = GETUTCDATE()
    FROM Products p
    INNER JOIN inserted i ON p.ProductId = i.ProductId;
END
```

### SQL Integrated Change Tracking

More efficient for high-volume changes:

```json
{
  "dataChangeDetectionPolicy": {
    "@odata.type": "#Microsoft.Azure.Search.SqlIntegratedChangeTrackingPolicy"
  }
}
```

Enable change tracking in SQL:

```sql
-- Enable at database level
ALTER DATABASE ProductDB
SET CHANGE_TRACKING = ON
(CHANGE_RETENTION = 7 DAYS, AUTO_CLEANUP = ON);

-- Enable at table level
ALTER TABLE Products
ENABLE CHANGE_TRACKING
WITH (TRACK_COLUMNS_UPDATED = ON);
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

Modify your table:

```sql
ALTER TABLE Products ADD IsDeleted bit
    CONSTRAINT DF_Products_IsDeleted DEFAULT 0;

-- Instead of DELETE, use UPDATE
UPDATE Products SET IsDeleted = 1 WHERE ProductId = @Id;

-- Update your query to exclude soft-deleted records
-- Or let the indexer handle it
```

## Complete Indexer Configuration

```json
{
  "name": "products-sql-indexer",
  "dataSourceName": "products-sql-datasource",
  "targetIndexName": "products-index",
  "schedule": {
    "interval": "PT5M",
    "startTime": "2021-04-12T00:00:00Z"
  },
  "parameters": {
    "batchSize": 1000,
    "maxFailedItems": 10,
    "maxFailedItemsPerBatch": 5,
    "configuration": {
      "queryTimeout": "00:10:00"
    }
  },
  "fieldMappings": [
    {
      "sourceFieldName": "ProductId",
      "targetFieldName": "id"
    },
    {
      "sourceFieldName": "Name",
      "targetFieldName": "productName"
    },
    {
      "sourceFieldName": "Description",
      "targetFieldName": "description"
    },
    {
      "sourceFieldName": "CategoryName",
      "targetFieldName": "category"
    },
    {
      "sourceFieldName": "BrandName",
      "targetFieldName": "brand"
    },
    {
      "sourceFieldName": "Price",
      "targetFieldName": "price"
    }
  ]
}
```

## Index Schema Design

```json
{
  "name": "products-index",
  "fields": [
    {
      "name": "id",
      "type": "Edm.String",
      "key": true,
      "searchable": false
    },
    {
      "name": "productName",
      "type": "Edm.String",
      "searchable": true,
      "filterable": false,
      "sortable": true,
      "analyzer": "en.microsoft"
    },
    {
      "name": "description",
      "type": "Edm.String",
      "searchable": true,
      "filterable": false,
      "sortable": false,
      "analyzer": "en.microsoft"
    },
    {
      "name": "category",
      "type": "Edm.String",
      "searchable": true,
      "filterable": true,
      "facetable": true,
      "sortable": true
    },
    {
      "name": "brand",
      "type": "Edm.String",
      "searchable": true,
      "filterable": true,
      "facetable": true,
      "sortable": true
    },
    {
      "name": "price",
      "type": "Edm.Double",
      "searchable": false,
      "filterable": true,
      "sortable": true,
      "facetable": true
    },
    {
      "name": "tags",
      "type": "Collection(Edm.String)",
      "searchable": true,
      "filterable": true,
      "facetable": true
    }
  ],
  "suggesters": [
    {
      "name": "product-suggester",
      "searchMode": "analyzingInfixMatching",
      "sourceFields": ["productName", "category", "brand"]
    }
  ],
  "scoringProfiles": [
    {
      "name": "boost-by-freshness",
      "functions": [
        {
          "type": "freshness",
          "fieldName": "modifiedDate",
          "boost": 2,
          "parameters": {
            "boostingDuration": "P30D"
          }
        }
      ]
    }
  ]
}
```

## Handling Complex Data Types

### JSON Columns

```sql
-- SQL table with JSON
CREATE TABLE Products (
    ProductId int PRIMARY KEY,
    Name nvarchar(200),
    Attributes nvarchar(max) -- JSON
);

INSERT INTO Products VALUES (
    1,
    'Laptop',
    '{"color": "silver", "weight": 2.5, "features": ["SSD", "16GB RAM"]}'
);
```

Map JSON fields:

```json
{
  "container": {
    "query": "SELECT ProductId, Name, JSON_VALUE(Attributes, '$.color') as Color, JSON_VALUE(Attributes, '$.weight') as Weight, JSON_QUERY(Attributes, '$.features') as Features FROM Products"
  },
  "fieldMappings": [
    {
      "sourceFieldName": "Features",
      "targetFieldName": "features",
      "mappingFunction": {
        "name": "jsonArrayToStringCollection"
      }
    }
  ]
}
```

### Hierarchical Data

```sql
-- Category hierarchy
SELECT
    p.ProductId,
    p.Name,
    CONCAT(c3.Name, ' > ', c2.Name, ' > ', c1.Name) as CategoryPath,
    c1.Name as Category,
    c2.Name as SubCategory
FROM Products p
JOIN Categories c1 ON p.CategoryId = c1.CategoryId
LEFT JOIN Categories c2 ON c1.ParentCategoryId = c2.CategoryId
LEFT JOIN Categories c3 ON c2.ParentCategoryId = c3.CategoryId
```

## Performance Optimization

### SQL Side Optimization

```sql
-- Create appropriate indexes
CREATE INDEX IX_Products_ModifiedDate ON Products(ModifiedDate)
INCLUDE (ProductId, Name, Description, CategoryId, Price);

-- Use indexed views for complex joins
CREATE VIEW vw_ProductSearch WITH SCHEMABINDING AS
SELECT
    p.ProductId,
    p.Name,
    p.Description,
    p.Price,
    p.ModifiedDate,
    c.CategoryName,
    b.BrandName
FROM dbo.Products p
INNER JOIN dbo.Categories c ON p.CategoryId = c.CategoryId
INNER JOIN dbo.Brands b ON p.BrandId = b.BrandId
WHERE p.IsActive = 1;

CREATE UNIQUE CLUSTERED INDEX IX_vw_ProductSearch
ON vw_ProductSearch(ProductId);
```

### Batch Size Tuning

```python
import time
from azure.search.documents.indexes import SearchIndexerClient

def test_batch_sizes(indexer_name, batch_sizes):
    results = []

    for batch_size in batch_sizes:
        # Update indexer batch size
        indexer = client.get_indexer(indexer_name)
        indexer.parameters.batch_size = batch_size
        client.create_or_update_indexer(indexer)

        # Reset and run
        client.reset_indexer(indexer_name)
        start_time = time.time()
        client.run_indexer(indexer_name)

        # Wait for completion
        while True:
            status = client.get_indexer_status(indexer_name)
            if status.last_result and status.last_result.status in ['success', 'transientFailure']:
                break
            time.sleep(10)

        duration = time.time() - start_time
        results.append({
            'batch_size': batch_size,
            'duration': duration,
            'items_processed': status.last_result.items_processed
        })

    return results

# Test with different batch sizes
results = test_batch_sizes('products-indexer', [100, 500, 1000, 2000])
for r in results:
    print(f"Batch {r['batch_size']}: {r['duration']:.1f}s for {r['items_processed']} items")
```

## Incremental Updates Pattern

### Using Stored Procedures

```sql
CREATE PROCEDURE sp_GetProductChanges
    @LastRunTime datetime2
AS
BEGIN
    SELECT
        ProductId,
        Name,
        Description,
        Price,
        CategoryId,
        ModifiedDate
    FROM Products
    WHERE ModifiedDate > @LastRunTime
    ORDER BY ModifiedDate;
END
```

### Push Model Alternative

For real-time updates, consider pushing changes directly:

```csharp
public class ProductChangeHandler
{
    private readonly SearchClient _searchClient;

    public async Task HandleProductChange(Product product, ChangeType changeType)
    {
        switch (changeType)
        {
            case ChangeType.Created:
            case ChangeType.Updated:
                var document = new SearchDocument
                {
                    ["id"] = product.ProductId.ToString(),
                    ["productName"] = product.Name,
                    ["description"] = product.Description,
                    ["category"] = product.Category.Name,
                    ["price"] = product.Price
                };
                await _searchClient.MergeOrUploadDocumentsAsync(new[] { document });
                break;

            case ChangeType.Deleted:
                await _searchClient.DeleteDocumentsAsync("id",
                    new[] { product.ProductId.ToString() });
                break;
        }
    }
}
```

## Monitoring and Troubleshooting

### Check Indexer Status

```python
from azure.search.documents.indexes import SearchIndexerClient

def monitor_sql_indexer(indexer_name):
    status = client.get_indexer_status(indexer_name)

    print(f"Indexer: {indexer_name}")
    print(f"Status: {status.status}")

    if status.last_result:
        result = status.last_result
        print(f"Last Run: {result.start_time}")
        print(f"Status: {result.status}")
        print(f"Items Processed: {result.items_processed}")
        print(f"Items Failed: {result.items_failed}")

        if result.errors:
            print("Errors:")
            for error in result.errors:
                print(f"  - Key: {error.key}, Message: {error.error_message}")

        if result.warnings:
            print("Warnings:")
            for warning in result.warnings:
                print(f"  - Key: {warning.key}, Message: {warning.message}")

    # Check execution history
    print("\nRecent Executions:")
    for execution in status.execution_history[:5]:
        print(f"  {execution.start_time}: {execution.status} "
              f"({execution.items_processed} processed, {execution.items_failed} failed)")
```

### Common Issues

```sql
-- Issue: Timeout on large tables
-- Solution: Add appropriate indexes and use incremental updates

-- Issue: Permission denied
-- Solution: Grant necessary permissions
GRANT SELECT ON dbo.Products TO [search-reader];
GRANT VIEW CHANGE TRACKING ON dbo.Products TO [search-reader];

-- Issue: Column not found
-- Solution: Verify column names in query
SELECT COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Products';
```

## Best Practices

1. **Use change tracking** - More efficient than high water mark for frequent changes
2. **Index only searchable columns** - Don't include large binary columns
3. **Create SQL indexes** - Support the indexer query patterns
4. **Use managed identity** - More secure than connection strings
5. **Monitor indexer health** - Set up alerts for failures
6. **Test batch sizes** - Find optimal size for your data
7. **Implement soft delete** - Handle deletions properly

## Conclusion

SQL database indexing with Azure Cognitive Search bridges the gap between relational data storage and modern search experiences. By implementing proper change detection, optimizing queries, and following best practices, you can keep your search index synchronized with your database while maintaining excellent performance. The combination provides the best of both worlds: transactional consistency from SQL and rich search capabilities from Cognitive Search.
