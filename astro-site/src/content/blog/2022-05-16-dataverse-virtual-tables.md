---
title: "Dataverse Virtual Tables: Integrating External Data"
author: Michael John Peña
draft: false
date: 2022-05-16
tags:
  - dataverse
  - power-platform
  - Integration
  - Data
---

## Virtual Table Concepts

Virtual tables provide:
- Real-time access to external data
- Native Dataverse experience
- Security role support
- Power Platform integration

## Creating a Custom Virtual Table Provider

Implement a custom data provider:

```csharp
// Plugin/VirtualEntityDataProvider.cs
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Extensions;
using System.Net.Http.Json;

public class ExternalProductDataProvider : IPlugin
{
    public void Execute(IServiceProvider serviceProvider)
    {
        var context = serviceProvider.Get<IPluginExecutionContext>();
        var tracingService = serviceProvider.Get<ITracingService>();

        tracingService.Trace("Virtual Entity Plugin executing...");

        try
        {
            switch (context.MessageName.ToLower())
            {
                case "retrieve":
                    HandleRetrieve(context, tracingService);
                    break;
                case "retrievemultiple":
                    HandleRetrieveMultiple(context, tracingService);
                    break;
            }
        }
        catch (Exception ex)
        {
            tracingService.Trace($"Error: {ex.Message}");
            throw new InvalidPluginExecutionException($"Virtual entity error: {ex.Message}");
        }
    }

    private void HandleRetrieve(IPluginExecutionContext context, ITracingService trace)
    {
        var target = (EntityReference)context.InputParameters["Target"];
        var productId = target.Id.ToString();

        trace.Trace($"Retrieving product: {productId}");

        using var client = new HttpClient();
        var response = client.GetAsync($"https://api.example.com/products/{productId}").Result;

        if (response.IsSuccessStatusCode)
        {
            var product = response.Content.ReadFromJsonAsync<ExternalProduct>().Result;
            var entity = MapToEntity(product, target.LogicalName);
            context.OutputParameters["BusinessEntity"] = entity;
        }
    }

    private void HandleRetrieveMultiple(IPluginExecutionContext context, ITracingService trace)
    {
        var query = (QueryExpression)context.InputParameters["Query"];

        trace.Trace($"Retrieving multiple products");

        // Build API query from QueryExpression
        var apiQuery = BuildApiQuery(query);

        using var client = new HttpClient();
        var response = client.GetAsync($"https://api.example.com/products?{apiQuery}").Result;

        if (response.IsSuccessStatusCode)
        {
            var products = response.Content.ReadFromJsonAsync<List<ExternalProduct>>().Result;
            var entityCollection = new EntityCollection();

            foreach (var product in products)
            {
                entityCollection.Entities.Add(MapToEntity(product, query.EntityName));
            }

            context.OutputParameters["BusinessEntityCollection"] = entityCollection;
        }
    }

    private string BuildApiQuery(QueryExpression query)
    {
        var queryParams = new List<string>();

        // Handle pagination
        if (query.PageInfo != null)
        {
            queryParams.Add($"page={query.PageInfo.PageNumber}");
            queryParams.Add($"pageSize={query.PageInfo.Count}");
        }

        // Handle filters
        foreach (var condition in query.Criteria.Conditions)
        {
            switch (condition.Operator)
            {
                case ConditionOperator.Equal:
                    queryParams.Add($"{condition.AttributeName}={condition.Values[0]}");
                    break;
                case ConditionOperator.Contains:
                    queryParams.Add($"search={condition.Values[0]}");
                    break;
            }
        }

        return string.Join("&", queryParams);
    }

    private Entity MapToEntity(ExternalProduct product, string entityName)
    {
        var entity = new Entity(entityName);
        entity.Id = Guid.Parse(product.Id);
        entity["cr_productid"] = product.Id;
        entity["cr_name"] = product.Name;
        entity["cr_description"] = product.Description;
        entity["cr_price"] = new Money(product.Price);
        entity["cr_category"] = product.Category;
        entity["cr_stocklevel"] = product.StockLevel;
        entity["cr_lastmodified"] = product.LastModified;
        return entity;
    }
}

public class ExternalProduct
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string Description { get; set; }
    public decimal Price { get; set; }
    public string Category { get; set; }
    public int StockLevel { get; set; }
    public DateTime LastModified { get; set; }
}
```

## SQL Server Virtual Table

Connect to external SQL Server:

```xml
<!-- Virtual Table Definition -->
<entity Name="cr_externalorder">
  <DisplayName>External Order</DisplayName>
  <DisplayCollectionName>External Orders</DisplayCollectionName>
  <OwnershipType>None</OwnershipType>
  <IsVirtual>true</IsVirtual>
  <DataProvider>Microsoft.Dynamics.CRM.SqlDataProvider</DataProvider>
  <DataSourceId>datasource_externaldb</DataSourceId>

  <attributes>
    <attribute Name="cr_orderid" Type="Guid" IsPrimaryKey="true">
      <DisplayName>Order ID</DisplayName>
      <ExternalName>OrderId</ExternalName>
    </attribute>
    <attribute Name="cr_customername" Type="String" MaxLength="200">
      <DisplayName>Customer Name</DisplayName>
      <ExternalName>CustomerName</ExternalName>
    </attribute>
    <attribute Name="cr_orderdate" Type="DateTime">
      <DisplayName>Order Date</DisplayName>
      <ExternalName>OrderDate</ExternalName>
    </attribute>
    <attribute Name="cr_totalamount" Type="Money">
      <DisplayName>Total Amount</DisplayName>
      <ExternalName>TotalAmount</ExternalName>
    </attribute>
    <attribute Name="cr_status" Type="Picklist">
      <DisplayName>Status</DisplayName>
      <ExternalName>Status</ExternalName>
    </attribute>
  </attributes>
</entity>
```

## SharePoint Virtual Table

Create virtual table for SharePoint documents:

```csharp
public class SharePointDocumentProvider : IPlugin
{
    private readonly string _siteUrl;
    private readonly string _libraryName;

    public void Execute(IServiceProvider serviceProvider)
    {
        var context = serviceProvider.Get<IPluginExecutionContext>();

        if (context.MessageName == "RetrieveMultiple")
        {
            var query = (QueryExpression)context.InputParameters["Query"];
            var documents = GetSharePointDocuments(query);

            var collection = new EntityCollection();
            foreach (var doc in documents)
            {
                var entity = new Entity("cr_spdocument");
                entity.Id = Guid.Parse(doc.UniqueId);
                entity["cr_name"] = doc.Name;
                entity["cr_fileurl"] = doc.ServerRelativeUrl;
                entity["cr_filesize"] = doc.Length;
                entity["cr_created"] = doc.TimeCreated;
                entity["cr_modified"] = doc.TimeLastModified;
                entity["cr_author"] = doc.Author;
                collection.Entities.Add(entity);
            }

            context.OutputParameters["BusinessEntityCollection"] = collection;
        }
    }

    private List<SharePointDocument> GetSharePointDocuments(QueryExpression query)
    {
        // Use Microsoft Graph or SharePoint REST API
        using var client = GetAuthenticatedClient();

        var graphQuery = $"https://graph.microsoft.com/v1.0/sites/{_siteUrl}/lists/{_libraryName}/items?$expand=fields";

        var response = client.GetAsync(graphQuery).Result;
        var result = response.Content.ReadFromJsonAsync<GraphListResponse>().Result;

        return result.Value.Select(item => new SharePointDocument
        {
            UniqueId = item.Id,
            Name = item.Fields.Name,
            ServerRelativeUrl = item.WebUrl,
            Length = item.Fields.Size,
            TimeCreated = item.CreatedDateTime,
            TimeLastModified = item.LastModifiedDateTime,
            Author = item.CreatedBy?.User?.DisplayName
        }).ToList();
    }

    private HttpClient GetAuthenticatedClient()
    {
        // Implement authentication
        var client = new HttpClient();
        // Add bearer token
        return client;
    }
}
```

## Using Virtual Tables in Power Apps

Access virtual tables like native tables:

```javascript
// Power Apps formula for virtual table

// Load external products
ClearCollect(
    colProducts,
    Filter(
        'External Products',
        cr_category = ddCategory.Selected.Value
    )
);

// Search with delegation
Search(
    'External Products',
    txtSearch.Text,
    "cr_name",
    "cr_description"
);

// Display in gallery with sorting
SortByColumns(
    'External Products',
    "cr_price",
    If(SortAscending, SortOrder.Ascending, SortOrder.Descending)
);

// Navigate to detail view
Navigate(
    ProductDetail,
    ScreenTransition.Fade,
    {SelectedProduct: Gallery1.Selected}
);
```

## Power Automate with Virtual Tables

Use virtual tables in flows:

```json
{
  "triggers": {
    "manual": {
      "type": "Request",
      "kind": "Button"
    }
  },
  "actions": {
    "List_External_Products": {
      "type": "ApiConnection",
      "inputs": {
        "host": {
          "connection": {
            "name": "@parameters('$connections')['commondataservice']['connectionId']"
          }
        },
        "method": "get",
        "path": "/v2/datasets/@{encodeURIComponent(variables('environmentUrl'))}/tables/@{encodeURIComponent('cr_externalproducts')}/items",
        "queries": {
          "$filter": "cr_stocklevel lt 10"
        }
      }
    },
    "For_Each_Low_Stock_Product": {
      "type": "Foreach",
      "foreach": "@body('List_External_Products')?['value']",
      "actions": {
        "Send_Alert_Email": {
          "type": "ApiConnection",
          "inputs": {
            "method": "post",
            "path": "/v2/Mail",
            "body": {
              "To": "inventory@company.com",
              "Subject": "Low Stock Alert: @{items('For_Each_Low_Stock_Product')?['cr_name']}",
              "Body": "Product @{items('For_Each_Low_Stock_Product')?['cr_name']} has only @{items('For_Each_Low_Stock_Product')?['cr_stocklevel']} items in stock."
            }
          }
        }
      }
    }
  }
}
```

## Performance Considerations

Optimize virtual table performance:

```csharp
public class OptimizedVirtualProvider : IPlugin
{
    private static readonly MemoryCache _cache = new MemoryCache(new MemoryCacheOptions
    {
        SizeLimit = 1000
    });

    public void Execute(IServiceProvider serviceProvider)
    {
        var context = serviceProvider.Get<IPluginExecutionContext>();

        if (context.MessageName == "RetrieveMultiple")
        {
            var query = (QueryExpression)context.InputParameters["Query"];
            var cacheKey = GenerateCacheKey(query);

            // Try cache first
            if (_cache.TryGetValue(cacheKey, out EntityCollection cached))
            {
                context.OutputParameters["BusinessEntityCollection"] = cached;
                return;
            }

            // Fetch from external source
            var results = FetchFromExternalSource(query);

            // Cache for 5 minutes
            var cacheOptions = new MemoryCacheEntryOptions()
                .SetSize(1)
                .SetSlidingExpiration(TimeSpan.FromMinutes(5));

            _cache.Set(cacheKey, results, cacheOptions);

            context.OutputParameters["BusinessEntityCollection"] = results;
        }
    }

    private string GenerateCacheKey(QueryExpression query)
    {
        // Generate unique key based on query parameters
        var builder = new StringBuilder(query.EntityName);

        foreach (var condition in query.Criteria.Conditions)
        {
            builder.Append($"|{condition.AttributeName}:{condition.Operator}:{string.Join(",", condition.Values)}");
        }

        return builder.ToString();
    }

    private EntityCollection FetchFromExternalSource(QueryExpression query)
    {
        // Implementation
        return new EntityCollection();
    }
}
```

## Summary

Dataverse virtual tables enable:

- Real-time external data access
- No data duplication
- Native Dataverse security
- Power Platform integration
- Custom provider development

Extend Dataverse reach without moving data.
