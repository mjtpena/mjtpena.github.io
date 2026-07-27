---
title: "Power BI XMLA Endpoints: Enterprise Dataset Management"
author: Michael John Peña
draft: false
date: 2022-04-27
tags:
  - Power BI
  - XMLA
  - Dataset Management
  - Enterprise
  - Administration

---

I wrote "Power BI XMLA Endpoints: Enterprise Dataset Management" to share practical, production-minded guidance on this topic.

## XMLA Capabilities

```yaml
read_operations:
  - Query datasets with DAX/MDX
  - Connect with tools like Excel, SSMS
  - Analyze dataset metadata

write_operations:
  - Deploy datasets from Visual Studio
  - Refresh partitions programmatically
  - Execute TMSL scripts
  - Modify dataset schemas
```

## Enabling XMLA

```yaml
requirements:
  - Power BI Premium or Premium Per User
  - Workspace in Premium capacity
  - Dataset setting: XMLA Endpoint = On or Read Write
```

## Connecting to XMLA

```csharp
// Connection string format
var connectionString = "Data Source=powerbi://api.powerbi.com/v1.0/myorg/WorkspaceName;" +
                       "Initial Catalog=DatasetName;" +
                       "User ID=user@domain.com;" +
                       "Password=***;";

// Using ADOMD.NET
using Microsoft.AnalysisServices.AdomdClient;

using var connection = new AdomdConnection(connectionString);
connection.Open();

var command = new AdomdCommand("EVALUATE Sales", connection);
using var reader = command.ExecuteReader();

while (reader.Read())
{
    Console.WriteLine(reader[0]);
}
```

## TMSL Operations

```csharp
using Microsoft.AnalysisServices.Tabular;

// Connect to dataset
var server = new Server();
server.Connect(connectionString);
var database = server.Databases["DatasetName"];

// Refresh specific partition
var table = database.Model.Tables["Sales"];
var partition = table.Partitions["Sales-2022"];
partition.RequestRefresh(RefreshType.Full);
database.Model.SaveChanges();

// Process table
table.RequestRefresh(RefreshType.DataOnly);
database.Model.SaveChanges();
```

## Incremental Refresh via XMLA

```csharp
public async Task ProcessIncrementalPartition(string partitionName)
{
    using var server = new Server();
    server.Connect(_connectionString);

    var database = server.Databases[_datasetName];
    var table = database.Model.Tables["FactSales"];

    // Find or create partition
    var partition = table.Partitions.Find(partitionName);

    if (partition == null)
    {
        // Create new partition
        partition = new Partition
        {
            Name = partitionName,
            Source = new MPartitionSource
            {
                Expression = $"SELECT * FROM Sales WHERE Year = {year}"
            }
        };
        table.Partitions.Add(partition);
    }

    // Refresh only this partition
    partition.RequestRefresh(RefreshType.Full);
    database.Model.SaveChanges();
}
```

## Third-Party Tool Integration

### Tabular Editor

```csharp
// Deploy model from Tabular Editor
// File > Deploy > Power BI XMLA Endpoint

// Or via command line
TabularEditor.exe model.bim -D "powerbi://api.powerbi.com/v1.0/myorg/Workspace" DatasetName
```

### DAX Studio

```
// Connect and query
EVALUATE
SUMMARIZECOLUMNS(
    'Date'[Year],
    'Product'[Category],
    "Total Sales", [Total Sales]
)
```

## Best Practices

```yaml
security:
  - Use service principals for automation
  - Implement least privilege access
  - Audit XMLA connections

performance:
  - Use partition refresh for large tables
  - Schedule during off-peak hours
  - Monitor long-running operations

governance:
  - Track schema changes
  - Version control TMSL scripts
  - Document deployment procedures
```

## Conclusion

XMLA endpoints unlock enterprise capabilities:
- Programmatic dataset management
- Integration with existing BI tools
- Advanced refresh strategies
- Automated deployment

## Resources

- [XMLA Endpoint Documentation](https://docs.microsoft.com/en-us/power-bi/enterprise/service-premium-connect-tools)
- [Tabular Editor](https://tabulareditor.com/)
- [DAX Studio](https://daxstudio.org/)

