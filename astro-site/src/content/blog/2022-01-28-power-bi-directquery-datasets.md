---
title: "DirectQuery for Power BI Datasets: Chaining Analytics"
author: Michael John Peña
draft: false
date: 2022-01-28
url: /blog/power-bi-directquery-datasets/
tags:
  - power-bi
  - directquery
  - analytics
  - enterprise

---

I wrote "DirectQuery for Power BI Datasets: Chaining Analytics" to share practical, production-minded guidance on this topic.

## The Dataset Chaining Architecture

Instead of every report connecting to the same data sources, you can:
1. Create certified core datasets
2. Connect to those datasets via DirectQuery
3. Extend with additional data or calculations

```
Data Sources -> Core Dataset (Certified) -> Department Datasets -> Reports
```

## Connecting to a Power BI Dataset

```powerquery-m
// Connect to published dataset
let
    Source = PowerBI.Datasets(null),
    CoreAnalytics = Source{[Name="Enterprise Core Analytics"]}[Data],
    SalesTable = CoreAnalytics{[Name="Sales"]}[Data]
in
    SalesTable
```

## Building a Department-Specific Model

```powerquery-m
// Marketing team extending core dataset
let
    // Connect to core dataset
    CoreData = PowerBI.Datasets(null),
    SalesDataset = CoreData{[Name="Enterprise Sales"]}[Data],

    // Get tables from core dataset
    Sales = SalesDataset{[Name="Sales"]}[Data],
    Products = SalesDataset{[Name="Products"]}[Data],

    // Add local data
    MarketingCampaigns = Excel.Workbook(File.Contents("Campaigns.xlsx")),
    CampaignsTable = MarketingCampaigns{[Name="Campaigns"]}[Data]
in
    CampaignsTable
```

## Model Configuration

```json
{
  "model": {
    "name": "Marketing Analytics",
    "description": "Extends Enterprise Sales with marketing data",
    "remoteDatasets": [
      {
        "name": "Enterprise Sales",
        "workspaceId": "core-workspace-guid",
        "datasetId": "sales-dataset-guid"
      }
    ],
    "tables": [
      {
        "name": "Sales",
        "type": "remote",
        "remoteDataset": "Enterprise Sales",
        "mode": "directQuery"
      },
      {
        "name": "Products",
        "type": "remote",
        "remoteDataset": "Enterprise Sales",
        "mode": "directQuery"
      },
      {
        "name": "MarketingCampaigns",
        "type": "local",
        "mode": "import",
        "source": "Excel"
      }
    ],
    "relationships": [
      {
        "from": "Sales[CampaignID]",
        "to": "MarketingCampaigns[CampaignID]",
        "crossFilterDirection": "Both"
      }
    ]
  }
}
```

## Adding Local Measures

Extend the core dataset with custom calculations:

```dax
// Local measure extending core dataset
Campaign ROI =
VAR CampaignCost = SUM(MarketingCampaigns[Cost])
VAR CampaignRevenue = CALCULATE(
    SUM(Sales[Revenue]),
    USERELATIONSHIP(Sales[CampaignID], MarketingCampaigns[CampaignID])
)
RETURN
DIVIDE(CampaignRevenue - CampaignCost, CampaignCost, 0)

// Reference existing measures from core dataset
Sales Growth YoY =
VAR CurrentYearSales = [Total Sales]  // From core dataset
VAR PreviousYearSales = CALCULATE(
    [Total Sales],
    SAMEPERIODLASTYEAR(Dates[Date])
)
RETURN
DIVIDE(CurrentYearSales - PreviousYearSales, PreviousYearSales)
```

## Row-Level Security Inheritance

Security from the core dataset is automatically enforced:

```dax
// Core dataset RLS (automatically applies to connected models)
[Region] = USERPRINCIPALNAME()

// Additional RLS in downstream model
[Department] = "Marketing"
```

## Managing Dataset Lineage

Track dependencies with the REST API:

```python
import requests

class DatasetLineageManager:
    def __init__(self, access_token: str):
        self.base_url = "https://api.powerbi.com/v1.0/myorg"
        self.headers = {"Authorization": f"Bearer {access_token}"}

    def get_dataset_dependencies(self, workspace_id: str, dataset_id: str):
        """Get datasets that depend on this dataset."""
        url = f"{self.base_url}/groups/{workspace_id}/datasets/{dataset_id}/upstreamDatasets"
        response = requests.get(url, headers=self.headers)
        return response.json()

    def get_upstream_datasets(self, workspace_id: str, dataset_id: str):
        """Get datasets this dataset depends on."""
        url = f"{self.base_url}/groups/{workspace_id}/datasets/{dataset_id}/datasources"
        response = requests.get(url, headers=self.headers)

        datasources = response.json().get("value", [])
        pbi_datasets = [
            ds for ds in datasources
            if ds.get("datasourceType") == "AnalysisServices"
        ]
        return pbi_datasets

    def build_lineage_graph(self, workspace_id: str):
        """Build complete lineage graph for workspace."""
        datasets_url = f"{self.base_url}/groups/{workspace_id}/datasets"
        datasets = requests.get(datasets_url, headers=self.headers).json()["value"]

        lineage = {}
        for dataset in datasets:
            upstream = self.get_upstream_datasets(workspace_id, dataset["id"])
            lineage[dataset["name"]] = {
                "id": dataset["id"],
                "upstreamDatasets": [ds.get("datasourceId") for ds in upstream]
            }

        return lineage

# Usage
manager = DatasetLineageManager(token)
lineage = manager.build_lineage_graph("workspace-guid")
```

## Performance Considerations

```kusto
// Monitor DirectQuery performance in Log Analytics
PowerBIDatasetQuery
| where DatasetId == "dataset-guid"
| where OperationName == "QueryEnd"
| summarize
    AvgDuration = avg(DurationMs),
    MaxDuration = max(DurationMs),
    QueryCount = count()
    by bin(TimeGenerated, 1h)
| order by TimeGenerated desc
```

## Best Practices

1. **Certify core datasets** - Ensure quality at the source
2. **Limit chaining depth** - Avoid too many levels
3. **Document relationships** - Maintain clear lineage
4. **Monitor performance** - Track query times across chain
5. **Version carefully** - Changes propagate downstream
6. **Test thoroughly** - Validate calculations work correctly

DirectQuery for datasets enables a governed, scalable approach to enterprise analytics where teams can self-serve while building on trusted, certified data.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
