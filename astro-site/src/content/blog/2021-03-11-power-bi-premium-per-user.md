---
title: Power BI Premium Per User - Enterprise Features for Everyone
description: "Power BI Premium Per User launched as the answer to \"my team needs paginated reports, deployment pipelines, and large dataset support but we don't have a…"
author: Michael John Pena
draft: false
date: 2021-03-11
url: /blog/power-bi-premium-per-user/
tags:
  - Azure
  - Power BI
  - Analytics
  - Business Intelligence
  - Visualization
---

Power BI Premium Per User launched as the answer to "my team needs paginated reports, deployment pipelines, and large dataset support but we don't have a budget for a P1 capacity." PPU is $20 USD per user per month versus the £4,995/month entry for Premium P1. For a team of 20, that's significant. The trade-off is that anyone who needs to view PPU content also needs a PPU licence—unlike capacity-based Premium where viewers can access with a free account. So the business case depends heavily on your viewer-to-creator ratio. Today's post is the feature matrix and the pricing model, laid out plainly.

## What's Included in Premium Per User

PPU includes all Power BI Pro features plus:
- Larger model sizes (up to 100 GB)
- Paginated reports
- Dataflows with computed entities
- AI capabilities (AutoML, Cognitive Services integration)
- XMLA endpoint for read/write
- Deployment pipelines
- Higher refresh rates (up to 48/day)

## Setting Up PPU Workspace

```powershell
# Connect to Power BI Service
Connect-PowerBIServiceAccount

# Create a Premium Per User workspace
$workspace = New-PowerBIWorkspace -Name "Analytics-PPU"

# Configure workspace settings via REST API
$workspaceId = $workspace.Id
$uri = "https://api.powerbi.com/v1.0/myorg/groups/$workspaceId"

$body = @{
    "name" = "Analytics-PPU"
    "capacityId" = "PPU"  # Premium Per User
} | ConvertTo-Json

Invoke-PowerBIRestMethod -Url $uri -Method PATCH -Body $body
```

## Advanced Data Modeling

### Large Dataset Optimization

```dax
// Optimize measures for large datasets
Total Sales =
CALCULATE(
    SUMX(
        SUMMARIZE(
            Sales,
            Sales[ProductKey],
            Sales[DateKey]
        ),
        CALCULATE(SUM(Sales[Amount]))
    ),
    USERELATIONSHIP(Sales[DateKey], 'Date'[DateKey])
)

// Implement aggregations for performance
Aggregated Sales =
VAR GranularityLevel = SELECTEDVALUE('Granularity'[Level], "Day")
RETURN
    SWITCH(
        GranularityLevel,
        "Year", [Total Sales Yearly Agg],
        "Month", [Total Sales Monthly Agg],
        "Day", [Total Sales]
    )
```

### Incremental Refresh Configuration

```m
// Power Query for incremental refresh
let
    Source = Sql.Database("server.database.windows.net", "SalesDB"),

    // RangeStart and RangeEnd are reserved parameters
    FilteredData = Table.SelectRows(
        Source{[Schema="dbo", Item="FactSales"]}[Data],
        each [OrderDate] >= RangeStart and [OrderDate] < RangeEnd
    )
in
    FilteredData
```

Configure incremental refresh policy:
- Store rows in the last: 3 Years
- Refresh rows in the last: 10 Days
- Detect data changes: Enable with LastModifiedDate column

## AI Features in PPU

### AutoML Integration

```m
// Apply AutoML model to data in Power Query
let
    Source = Sql.Database("server", "database"),
    SalesData = Source{[Schema="dbo", Item="CustomerData"]}[Data],

    // Apply ML model for churn prediction
    WithPredictions = Table.AddColumn(
        SalesData,
        "ChurnPrediction",
        each AzureML.InvokeChurnModel([
            RecencyDays = [DaysSinceLastPurchase],
            Frequency = [PurchaseCount],
            Monetary = [TotalSpent],
            Tenure = [CustomerTenureDays]
        ])
    )
in
    WithPredictions
```

### Cognitive Services Integration

```m
// Text Analytics - Sentiment Analysis
let
    Source = SharePoint.Tables("https://company.sharepoint.com/sites/feedback"),
    Feedback = Source{[Title="CustomerFeedback"]}[Content],

    // Add sentiment scores
    WithSentiment = Table.AddColumn(
        Feedback,
        "Sentiment",
        each Text.Sentiment([Comments])
    ),

    // Add key phrases
    WithKeyPhrases = Table.AddColumn(
        WithSentiment,
        "KeyPhrases",
        each Text.KeyPhrases([Comments])
    )
in
    WithKeyPhrases
```

## XMLA Endpoint Usage

Connect external tools via XMLA:

```csharp
// Connect to Power BI using XMLA endpoint
using Microsoft.AnalysisServices.AdomdClient;

var connectionString = @"
    Data Source=powerbi://api.powerbi.com/v1.0/myorg/Analytics-PPU;
    Initial Catalog=SalesDataset;
    User ID=app:<app-id>@<tenant-id>;
    Password=<client-secret>";

using var connection = new AdomdConnection(connectionString);
connection.Open();

// Execute DAX query
var command = connection.CreateCommand();
command.CommandText = @"
    EVALUATE
    SUMMARIZECOLUMNS(
        'Date'[Year],
        'Date'[Month],
        'Product'[Category],
        ""Total Sales"", [Total Sales],
        ""Order Count"", [Order Count]
    )
    ORDER BY 'Date'[Year], 'Date'[Month]";

using var reader = command.ExecuteReader();
while (reader.Read())
{
    Console.WriteLine($"{reader[0]} - {reader[1]}: {reader[3]:C}");
}
```

### Tabular Editor Integration

```csharp
// Using Tabular Editor for model management
using TabularEditor.TOMWrapper;

var server = new Server();
server.Connect(connectionString);

var database = server.Databases["SalesDataset"];
var model = database.Model;

// Add a new measure
var table = model.Tables["Sales"];
var measure = table.AddMeasure(
    "YoY Growth %",
    @"
    VAR CurrentYear = [Total Sales]
    VAR PreviousYear = CALCULATE([Total Sales], SAMEPERIODLASTYEAR('Date'[Date]))
    RETURN
        DIVIDE(CurrentYear - PreviousYear, PreviousYear, 0)
    "
);
measure.FormatString = "0.00%";

// Save changes
model.SaveChanges();
```

## Deployment Pipelines

Automate deployment across environments:

```powershell
# PowerShell for deployment pipeline automation
$developmentWorkspaceId = "dev-workspace-id"
$testWorkspaceId = "test-workspace-id"
$productionWorkspaceId = "prod-workspace-id"
$pipelineId = "pipeline-id"

# Deploy from Development to Test
$deployRequest = @{
    sourceStageOrder = 0
    targetStageOrder = 1
    datasets = @(
        @{
            sourceId = "dataset-id"
        }
    )
    reports = @(
        @{
            sourceId = "report-id"
        }
    )
    options = @{
        allowCreateArtifact = $true
        allowOverwriteArtifact = $true
    }
} | ConvertTo-Json -Depth 10

$uri = "https://api.powerbi.com/v1.0/myorg/pipelines/$pipelineId/deploy"
Invoke-PowerBIRestMethod -Url $uri -Method POST -Body $deployRequest

# Update data source credentials after deployment
$datasourceUri = "https://api.powerbi.com/v1.0/myorg/groups/$testWorkspaceId/datasets/$datasetId/datasources"
$datasources = Invoke-PowerBIRestMethod -Url $datasourceUri -Method GET

foreach ($ds in $datasources.value) {
    $updateUri = "https://api.powerbi.com/v1.0/myorg/groups/$testWorkspaceId/datasets/$datasetId/datasources/$($ds.datasourceId)"
    $credentials = @{
        credentialType = "Basic"
        basicCredentials = @{
            username = $env:TEST_DB_USER
            password = $env:TEST_DB_PASSWORD
        }
    } | ConvertTo-Json

    Invoke-PowerBIRestMethod -Url $updateUri -Method PATCH -Body $credentials
}
```

## Dataflows with Computed Entities

```m
// Base entity - loaded from source
let
    Source = Sql.Database("server", "database"),
    Sales = Source{[Schema="dbo", Item="Sales"]}[Data],

    // Transform
    Transformed = Table.TransformColumnTypes(
        Sales,
        {{"OrderDate", type date}, {"Amount", type number}}
    )
in
    Transformed

// Computed entity - references base entity (PPU feature)
let
    Sales = PowerPlatform.Dataflow(null){[workspaceId=workspaceId]}[Data]{[dataflowId=dataflowId]}[Data]{[entity="Sales"]}[Data],

    // Aggregate by month
    Grouped = Table.Group(
        Sales,
        {"CustomerID", "Year", "Month"},
        {
            {"MonthlySales", each List.Sum([Amount]), type number},
            {"OrderCount", each Table.RowCount(_), Int64.Type}
        }
    ),

    // Add running total
    WithRunningTotal = Table.AddColumn(
        Grouped,
        "RunningTotal",
        each List.Sum(
            Table.SelectRows(
                Grouped,
                (row) => row[CustomerID] = [CustomerID]
                    and (row[Year] < [Year]
                        or (row[Year] = [Year] and row[Month] <= [Month]))
            )[MonthlySales]
        )
    )
in
    WithRunningTotal
```

## Best Practices

1. **Workspace Organization**: Create separate workspaces for development, test, and production
2. **Model Optimization**: Use aggregations and incremental refresh for large datasets
3. **Security**: Implement row-level security with DAX
4. **Monitoring**: Use Premium Capacity Metrics app to monitor usage

```dax
// Row-level security implementation
[Sales Region Security] =
VAR UserRegion = LOOKUPVALUE(
    UserRegions[Region],
    UserRegions[UserEmail],
    USERPRINCIPALNAME()
)
RETURN
    [Region] = UserRegion || UserRegion = "All"
```

## Conclusion

Power BI Premium Per User brings enterprise analytics capabilities to individual users and small teams. Key benefits include:

- Advanced AI and ML integration
- XMLA endpoint for professional tools
- Deployment pipelines for ALM
- Paginated reports for operational reporting
- Larger dataset support

At the per-user pricing model, PPU makes these features accessible without committing to capacity-based pricing.
