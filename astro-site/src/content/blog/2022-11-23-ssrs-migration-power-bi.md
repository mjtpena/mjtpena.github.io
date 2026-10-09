---
title: "SSRS to Power BI Migration: A Practical Guide"
author: Michael John Peña
draft: false
date: 2022-11-23
tags:
  - Power BI
  - SSRS
  - Reporting
  - Migration
  - Azure
---

## Why Migrate to Power BI?

- **Self-service analytics**: Users can create their own reports
- **Modern visualizations**: Interactive, mobile-friendly reports
- **Cloud-first**: Scales without infrastructure management
- **AI capabilities**: Natural language Q&A, smart narratives
- **Ecosystem integration**: Teams, SharePoint, Excel

## Migration Options

### Option 1: Power BI Report Server

On-premises Power BI with SSRS-like deployment:

```powershell
# Install Power BI Report Server
$installerPath = "PowerBIReportServer.exe"
Start-Process -FilePath $installerPath -ArgumentList '/quiet /IAcceptLicenseTerms' -Wait

# Configure
$config = @{
    DatabaseServer = "sql-server"
    DatabaseName = "ReportServer"
    VirtualDirectory = "Reports"
    ReportServerUrl = "https://reports.contoso.com"
}

Set-PbiReportServerConfiguration @config
```

### Option 2: Power BI Service (Cloud)

Full cloud migration:

```powershell
# Connect to Power BI Service
Connect-PowerBIServiceAccount

# Create workspace
$workspace = New-PowerBIWorkspace -Name "Migrated Reports"

# Publish report
Publish-PowerBIReport -Path ".\ConvertedReport.pbix" -Workspace $workspace

# Configure data refresh
$report = Get-PowerBIReport -WorkspaceId $workspace.Id -Name "ConvertedReport"
$dataset = Get-PowerBIDataset -WorkspaceId $workspace.Id -Id $report.DatasetId

# Set up gateway for on-premises data
$gateway = Get-DataGatewayCluster | Where-Object { $_.Name -eq "On-Premises Gateway" }
Set-PowerBIDatasetDatasource -DatasetId $dataset.Id -GatewayId $gateway.Id
```

## Conversion Approaches

### Using RDL Migration Tool

Microsoft provides a tool for basic conversions:

```powershell
# Install RDL Migration Tool
Install-Module -Name RdlMigration -Force

# Analyze report complexity
$analysis = Test-RdlMigration -Path ".\Report.rdl"
$analysis | Format-List

# Convert report
Convert-RdlToTbix -Path ".\Report.rdl" -OutputPath ".\ConvertedReport.pbix"
```

### Manual Conversion Steps

For complex reports, manual conversion is often required:

```python
# Script to analyze SSRS reports and generate conversion checklist
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import List

@dataclass
class ReportElement:
    element_type: str
    name: str
    complexity: str
    pbi_equivalent: str
    notes: str

def analyze_rdl(rdl_path: str) -> List[ReportElement]:
    """Analyze RDL file and generate conversion checklist."""

    tree = ET.parse(rdl_path)
    root = tree.getroot()
    ns = {'rd': 'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition'}

    elements = []

    # Analyze data sources
    for ds in root.findall('.//rd:DataSource', ns):
        elements.append(ReportElement(
            element_type='DataSource',
            name=ds.get('Name'),
            complexity='Low',
            pbi_equivalent='Data Source in Power Query',
            notes='Recreate connection in Power BI'
        ))

    # Analyze datasets
    for dataset in root.findall('.//rd:DataSet', ns):
        query = dataset.find('.//rd:CommandText', ns)
        complexity = 'High' if query and len(query.text) > 500 else 'Low'
        elements.append(ReportElement(
            element_type='DataSet',
            name=dataset.get('Name'),
            complexity=complexity,
            pbi_equivalent='Power Query or DirectQuery',
            notes='Convert to M or DAX'
        ))

    # Analyze visualizations
    viz_mapping = {
        'Tablix': ('Table/Matrix', 'Low'),
        'Chart': ('Power BI Chart', 'Medium'),
        'Gauge': ('KPI/Gauge Visual', 'Low'),
        'Map': ('Map Visual', 'High'),
        'Image': ('Image', 'Low'),
        'Subreport': ('Drillthrough/Bookmark', 'High')
    }

    for viz_type, (pbi_eq, complexity) in viz_mapping.items():
        for viz in root.findall(f'.//rd:{viz_type}', ns):
            elements.append(ReportElement(
                element_type=viz_type,
                name=viz.get('Name'),
                complexity=complexity,
                pbi_equivalent=pbi_eq,
                notes=''
            ))

    # Check for expressions
    for expr in root.findall('.//*[rd:Value]', ns):
        value = expr.find('rd:Value', ns)
        if value is not None and value.text and value.text.startswith('='):
            elements.append(ReportElement(
                element_type='Expression',
                name=expr.get('Name', 'Unknown'),
                complexity='Medium',
                pbi_equivalent='DAX Measure',
                notes=f'Convert: {value.text[:50]}...'
            ))

    return elements

# Generate report
elements = analyze_rdl('SalesReport.rdl')
for elem in elements:
    print(f"{elem.element_type}: {elem.name} ({elem.complexity})")
```

## Converting Common SSRS Features

### Expressions to DAX

```
// SSRS Expression
=Sum(Fields!Sales.Value)

// Power BI DAX
Total Sales = SUM('Sales'[Sales])
```

```
// SSRS Conditional formatting
=IIF(Fields!Sales.Value > 10000, "Green", "Red")

// Power BI - Create measure + conditional formatting rule
Sales Status =
IF(SUM('Sales'[Sales]) > 10000, "High", "Low")
```

### Parameters to Slicers

SSRS parameters become Power BI slicers or filters:

```json
{
  "visualType": "slicer",
  "dataRoles": {
    "Values": {
      "items": [
        { "queryRef": "Sales.Region" }
      ]
    }
  },
  "objects": {
    "selection": {
      "singleSelect": false,
      "selectAll": true
    },
    "header": {
      "show": true,
      "fontColor": "#000000"
    }
  }
}
```

### Subreports to Drillthrough

```dax
// Main report measure with drillthrough
Sales Amount =
VAR CurrentSales = SUM('Sales'[Amount])
RETURN CurrentSales

// Drillthrough page shows detail
// Configure in Power BI Desktop:
// 1. Create detail page
// 2. Add drillthrough filter
// 3. Add back button
```

## Handling Paginated Reports

For pixel-perfect, printable reports, use Power BI Paginated Reports:

```xml
<!-- RDL format supported in Power BI Premium -->
<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition">
  <DataSources>
    <DataSource Name="AdventureWorks">
      <ConnectionProperties>
        <DataProvider>SQL</DataProvider>
        <ConnectString>Data Source=server;Initial Catalog=AdventureWorks</ConnectString>
      </ConnectionProperties>
    </DataSource>
  </DataSources>
  <DataSets>
    <DataSet Name="SalesData">
      <Query>
        <DataSourceName>AdventureWorks</DataSourceName>
        <CommandText>
          SELECT * FROM Sales.vSalesOrders
          WHERE OrderDate BETWEEN @StartDate AND @EndDate
        </CommandText>
      </Query>
    </DataSet>
  </DataSets>
  <!-- Rest of report definition -->
</Report>
```

Upload to Power BI Service:

```powershell
# Upload paginated report to Power BI Premium workspace
$workspace = Get-PowerBIWorkspace -Name "Finance Reports"

# Requires Premium capacity
$report = New-PowerBIReport `
    -Path ".\InvoiceReport.rdl" `
    -Name "Invoice Report" `
    -WorkspaceId $workspace.Id `
    -ConflictAction CreateOrOverwrite
```

## Data Gateway Configuration

For reports accessing on-premises data:

```powershell
# Install gateway
$gatewayInstaller = "GatewayInstall.exe"
Start-Process -FilePath $gatewayInstaller -ArgumentList '/quiet' -Wait

# Configure gateway
$gateway = Get-DataGatewayCluster

# Add data source
Add-DataGatewayClusterDatasource `
    -GatewayClusterId $gateway.Id `
    -DatasourceType "SQL" `
    -ConnectionDetails @{
        server = "sql-server.contoso.com"
        database = "AdventureWorks"
    } `
    -CredentialType "Windows" `
    -Credential (Get-Credential)

# Map to datasets
$datasets = Get-PowerBIDataset -WorkspaceId $workspace.Id
foreach ($dataset in $datasets) {
    Set-PowerBIDatasetDatasource `
        -DatasetId $dataset.Id `
        -GatewayId $gateway.Id `
        -DatasourceId $datasource.Id
}
```

## Migration Checklist

```yaml
pre_migration:
  - Inventory all SSRS reports
  - Document data sources and schedules
  - Identify report consumers
  - Assess licensing requirements (Premium for paginated)
  - Plan gateway infrastructure

conversion:
  - Prioritize by business value
  - Start with simple reports
  - Test with sample data
  - Validate calculations
  - Review with users

deployment:
  - Set up workspaces
  - Configure security (row-level security)
  - Establish refresh schedules
  - Create deployment pipeline (Dev/Test/Prod)
  - Document new report locations

post_migration:
  - Train users
  - Monitor usage
  - Decommission old SSRS reports
  - Optimize performance
  - Gather feedback
```

## Conclusion

SSRS to Power BI migration requires careful planning but offers significant benefits. Use Power BI Report Server for a gradual transition, or go fully cloud with Power BI Service. For complex paginated reports, Power BI Premium's paginated report capability provides a compatible path. Start with high-value, simple reports and build expertise before tackling complex migrations.

## Resources

- [RDL Migration Tool](https://docs.microsoft.com/en-us/power-bi/guidance/migrate-ssrs-reports-to-power-bi)
- [Power BI Paginated Reports](https://docs.microsoft.com/en-us/power-bi/paginated-reports/paginated-reports-report-builder-power-bi)
- [On-premises Gateway](https://docs.microsoft.com/en-us/power-bi/connect-data/service-gateway-onprem)
- [Power BI Report Server](https://docs.microsoft.com/en-us/power-bi/report-server/get-started)
