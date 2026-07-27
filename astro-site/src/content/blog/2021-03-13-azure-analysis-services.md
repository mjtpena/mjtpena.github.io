---
title: Azure Analysis Services for Enterprise Semantic Models
author: Michael John Pena
draft: false
date: 2021-03-13
url: /blog/azure-analysis-services/
tags:
  - Azure
  - Analysis Services
  - Tabular
  - Data Modeling
  - Business Intelligence

---

I wrote "2021-03-13-azure-analysis-services" to share practical, production-minded guidance on this topic.

## Understanding Semantic Models

A semantic model sits between raw data and end-user tools, providing:
- Business-friendly names and descriptions
- Calculated measures and KPIs
- Row-level security
- Hierarchies and relationships
- Optimized query performance

## Creating an Analysis Services Instance

```bash
# Create Analysis Services server
az analysisservices server create \
    --name myanalysisserver \
    --resource-group myResourceGroup \
    --location eastus \
    --sku S1 \
    --admin-users admin@company.com \
    --backup-blob-container-uri "https://storage.blob.core.windows.net/backups?sv=..."
```

## Building a Tabular Model

### Model Definition (TMSL)

```json
{
  "create": {
    "database": {
      "name": "SalesModel",
      "compatibilityLevel": 1500,
      "model": {
        "name": "Sales",
        "culture": "en-US",
        "tables": [
          {
            "name": "Sales",
            "columns": [
              {
                "name": "SalesKey",
                "dataType": "int64",
                "isHidden": true
              },
              {
                "name": "OrderDate",
                "dataType": "dateTime",
                "formatString": "Short Date"
              },
              {
                "name": "CustomerKey",
                "dataType": "int64",
                "isHidden": true
              },
              {
                "name": "ProductKey",
                "dataType": "int64",
                "isHidden": true
              },
              {
                "name": "Quantity",
                "dataType": "int64",
                "formatString": "#,##0"
              },
              {
                "name": "UnitPrice",
                "dataType": "decimal",
                "formatString": "\\$#,0.00;(\\$#,0.00)"
              },
              {
                "name": "SalesAmount",
                "dataType": "decimal",
                "formatString": "\\$#,0.00;(\\$#,0.00)"
              }
            ],
            "partitions": [
              {
                "name": "Sales",
                "source": {
                  "type": "m",
                  "expression": [
                    "let",
                    "    Source = Sql.Database(\"server.database.windows.net\", \"SalesDB\"),",
                    "    dbo_FactSales = Source{[Schema=\"dbo\",Item=\"FactSales\"]}[Data]",
                    "in",
                    "    dbo_FactSales"
                  ]
                }
              }
            ],
            "measures": [
              {
                "name": "Total Sales",
                "expression": "SUM(Sales[SalesAmount])",
                "formatString": "\\$#,0.00;(\\$#,0.00)"
              },
              {
                "name": "Order Count",
                "expression": "DISTINCTCOUNT(Sales[SalesKey])",
                "formatString": "#,##0"
              }
            ]
          }
        ]
      }
    }
  }
}
```

### DAX Measures

```dax
// Time Intelligence Measures
Total Sales = SUM(Sales[SalesAmount])

YTD Sales =
TOTALYTD([Total Sales], 'Date'[Date])

Previous Year Sales =
CALCULATE(
    [Total Sales],
    SAMEPERIODLASTYEAR('Date'[Date])
)

YoY Growth =
VAR CurrentYear = [Total Sales]
VAR PreviousYear = [Previous Year Sales]
RETURN
    DIVIDE(CurrentYear - PreviousYear, PreviousYear, BLANK())

YoY Growth % = FORMAT([YoY Growth], "0.00%")

// Moving Average
Sales 3M Moving Avg =
AVERAGEX(
    DATESINPERIOD('Date'[Date], LASTDATE('Date'[Date]), -3, MONTH),
    [Total Sales]
)

// Cumulative Total
Cumulative Sales =
CALCULATE(
    [Total Sales],
    FILTER(
        ALL('Date'),
        'Date'[Date] <= MAX('Date'[Date])
    )
)

// Rank
Customer Rank =
RANKX(
    ALL(Customer[CustomerName]),
    [Total Sales],
    ,
    DESC,
    DENSE
)

// Pareto Analysis
Cumulative % of Total =
VAR TotalAllCustomers =
    CALCULATE([Total Sales], ALL(Customer))
VAR CumulativeSales =
    CALCULATE(
        [Total Sales],
        FILTER(
            ALL(Customer),
            [Customer Rank] <= MAX([Customer Rank])
        )
    )
RETURN
    DIVIDE(CumulativeSales, TotalAllCustomers)

// Complex KPI
Gross Profit Margin =
VAR Revenue = [Total Sales]
VAR Cost = SUM(Sales[Cost])
RETURN
    DIVIDE(Revenue - Cost, Revenue, BLANK())

Gross Profit Margin Status =
SWITCH(
    TRUE(),
    [Gross Profit Margin] >= 0.4, "Good",
    [Gross Profit Margin] >= 0.25, "Average",
    "Below Target"
)
```

## Row-Level Security

```dax
// Define security roles in the model
// Role: RegionalSalesManagers
// Table filter expression on Sales table:
[Region] = USERNAME() || USERPRINCIPALNAME() = "admin@company.com"

// Dynamic security with lookup table
// Role: DynamicSecurity
// Table filter expression:
VAR UserEmail = USERPRINCIPALNAME()
VAR AllowedRegions =
    CALCULATETABLE(
        VALUES(UserSecurity[Region]),
        UserSecurity[UserEmail] = UserEmail
    )
RETURN
    [Region] IN AllowedRegions
```

## Automation with AMO/TOM

```csharp
// C# code for model management using TOM
using Microsoft.AnalysisServices.Tabular;

public class AnalysisServicesManager
{
    private readonly string _connectionString;

    public AnalysisServicesManager(string connectionString)
    {
        _connectionString = connectionString;
    }

    public void ProcessDatabase(string databaseName)
    {
        using var server = new Server();
        server.Connect(_connectionString);

        var database = server.Databases.FindByName(databaseName);
        if (database == null)
        {
            throw new Exception($"Database '{databaseName}' not found");
        }

        // Process all tables
        database.Model.RequestRefresh(RefreshType.Full);
        database.Model.SaveChanges();
    }

    public void ProcessTable(string databaseName, string tableName)
    {
        using var server = new Server();
        server.Connect(_connectionString);

        var database = server.Databases.FindByName(databaseName);
        var table = database.Model.Tables.Find(tableName);

        table.RequestRefresh(RefreshType.Full);
        database.Model.SaveChanges();
    }

    public void AddMeasure(string databaseName, string tableName,
        string measureName, string expression, string formatString)
    {
        using var server = new Server();
        server.Connect(_connectionString);

        var database = server.Databases.FindByName(databaseName);
        var table = database.Model.Tables.Find(tableName);

        var measure = new Measure
        {
            Name = measureName,
            Expression = expression,
            FormatString = formatString
        };

        table.Measures.Add(measure);
        database.Model.SaveChanges();
    }

    public void CreatePartition(string databaseName, string tableName,
        string partitionName, string query)
    {
        using var server = new Server();
        server.Connect(_connectionString);

        var database = server.Databases.FindByName(databaseName);
        var table = database.Model.Tables.Find(tableName);

        var partition = new Partition
        {
            Name = partitionName,
            Source = new MPartitionSource
            {
                Expression = query
            }
        };

        table.Partitions.Add(partition);
        database.Model.SaveChanges();
    }

    public void ScaleUp(string resourceGroupName, string serverName, string newSku)
    {
        // Use Azure Management SDK to scale
        // Requires Microsoft.Azure.Management.Analysis
    }
}
```

## Querying with DAX

```csharp
// Query Analysis Services using ADOMD.NET
using Microsoft.AnalysisServices.AdomdClient;

public class DaxQueryService
{
    private readonly string _connectionString;

    public DaxQueryService(string connectionString)
    {
        _connectionString = connectionString;
    }

    public DataTable ExecuteQuery(string daxQuery)
    {
        using var connection = new AdomdConnection(_connectionString);
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText = daxQuery;

        using var adapter = new AdomdDataAdapter(command);
        var dataTable = new DataTable();
        adapter.Fill(dataTable);

        return dataTable;
    }

    public List<SalesSummary> GetSalesByRegion(int year)
    {
        var query = $@"
            EVALUATE
            SUMMARIZECOLUMNS(
                'Geography'[Region],
                'Date'[Year],
                FILTER('Date', 'Date'[Year] = {year}),
                ""Total Sales"", [Total Sales],
                ""Order Count"", [Order Count],
                ""Avg Order Value"", DIVIDE([Total Sales], [Order Count])
            )
            ORDER BY [Total Sales] DESC";

        var dataTable = ExecuteQuery(query);

        return dataTable.AsEnumerable()
            .Select(row => new SalesSummary
            {
                Region = row.Field<string>("Geography[Region]"),
                Year = row.Field<int>("Date[Year]"),
                TotalSales = row.Field<decimal>("Total Sales"),
                OrderCount = row.Field<long>("Order Count"),
                AvgOrderValue = row.Field<decimal>("Avg Order Value")
            })
            .ToList();
    }
}

public class SalesSummary
{
    public string Region { get; set; }
    public int Year { get; set; }
    public decimal TotalSales { get; set; }
    public long OrderCount { get; set; }
    public decimal AvgOrderValue { get; set; }
}
```

## Integration with Power BI

```dax
// Power BI Live Connection
// Connect Power BI to Analysis Services as a live connection
// All DAX queries are executed on Analysis Services

// DirectQuery composite model (Power BI Premium)
// Combine live connection with local import tables
// For adding local calculations without modifying the model
```

## Best Practices

1. **Model Design**
   - Star schema with clear fact/dimension separation
   - Avoid bidirectional relationships when possible
   - Use calculated columns sparingly (prefer measures)

2. **Performance**
   - Implement incremental processing
   - Use partitions for large tables
   - Monitor with DMVs

3. **Security**
   - Use Azure AD authentication
   - Implement row-level security
   - Separate development and production environments

```sql
-- Monitor with DMVs
SELECT * FROM $SYSTEM.DISCOVER_SESSIONS
SELECT * FROM $SYSTEM.DISCOVER_CONNECTIONS
SELECT * FROM $SYSTEM.DISCOVER_COMMANDS
SELECT * FROM $SYSTEM.DISCOVER_OBJECT_MEMORY_USAGE
```

## Conclusion

Azure Analysis Services provides enterprise-grade semantic modeling for organizations. Key benefits:

- Centralized business logic and metrics
- Robust security with row-level access control
- High performance with in-memory caching
- Seamless integration with Power BI and Excel
- Familiar tooling for SQL Server Analysis Services users

For new projects, also consider Power BI Premium datasets which offer similar capabilities with tighter Power BI integration.

