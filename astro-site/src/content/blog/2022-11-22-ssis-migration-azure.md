---
title: "SSIS to Azure Migration: Strategies and Tools"
author: Michael John Peña
draft: false
date: 2022-11-22
tags:
  - Azure
  - SSIS
  - Data Factory
  - Migration
  - ETL

---

I wrote "SSIS to Azure Migration: Strategies and Tools" to share practical, production-minded guidance on this topic.

## Migration Options

### Option 1: Azure-SSIS Integration Runtime

Lift and shift existing SSIS packages with minimal changes:

```json
{
  "name": "AzureSsisIR",
  "type": "Managed",
  "typeProperties": {
    "computeProperties": {
      "location": "East US",
      "nodeSize": "Standard_D8_v3",
      "numberOfNodes": 2,
      "maxParallelExecutionsPerNode": 8
    },
    "ssisProperties": {
      "catalogInfo": {
        "catalogServerEndpoint": "your-server.database.windows.net",
        "catalogAdminUserName": "admin",
        "catalogAdminPassword": {
          "type": "SecureString",
          "value": "your-password"
        },
        "catalogPricingTier": "S1"
      },
      "customSetupScriptProperties": {
        "blobContainerUri": "https://storage.blob.core.windows.net/customsetup",
        "sasToken": {
          "type": "SecureString",
          "value": "your-sas-token"
        }
      },
      "edition": "Standard",
      "licenseType": "LicenseIncluded"
    }
  }
}
```

### Deploying to Azure-SSIS IR

```powershell
# Connect to Azure
Connect-AzAccount

# Get Data Factory
$dataFactory = Get-AzDataFactoryV2 -ResourceGroupName "rg-data" -Name "adf-production"

# Get Integration Runtime
$ir = Get-AzDataFactoryV2IntegrationRuntime -ResourceGroupName "rg-data" `
    -DataFactoryName "adf-production" -Name "AzureSsisIR"

# Deploy SSIS project
$projectPath = "C:\SSISProjects\ETL.ispac"

# Using SSMS or PowerShell
$connection = New-Object System.Data.SqlClient.SqlConnection
$connection.ConnectionString = "Server=your-server.database.windows.net;Database=SSISDB;User Id=admin;Password=your-password;"
$connection.Open()

$command = $connection.CreateCommand()
$command.CommandType = [System.Data.CommandType]::StoredProcedure
$command.CommandText = "catalog.deploy_project"
$command.Parameters.Add((New-Object System.Data.SqlClient.SqlParameter("folder_name", "ETL")))
$command.Parameters.Add((New-Object System.Data.SqlClient.SqlParameter("project_name", "ETL")))

$projectStream = [System.IO.File]::ReadAllBytes($projectPath)
$command.Parameters.Add((New-Object System.Data.SqlClient.SqlParameter("project_stream", $projectStream)))

$command.ExecuteNonQuery()
$connection.Close()
```

### Option 2: Data Factory Mapping Data Flows

Convert SSIS logic to native Azure Data Factory:

```json
{
  "name": "CustomerETLFlow",
  "properties": {
    "type": "MappingDataFlow",
    "typeProperties": {
      "sources": [
        {
          "dataset": {
            "referenceName": "SourceCustomers",
            "type": "DatasetReference"
          },
          "name": "SourceData"
        }
      ],
      "transformations": [
        {
          "name": "CleanseData",
          "description": "Equivalent to SSIS Data Conversion + Derived Column",
          "dataset": null,
          "linkedService": null,
          "flowlet": null,
          "transformation": "derivedColumn"
        },
        {
          "name": "LookupCountry",
          "description": "Equivalent to SSIS Lookup transform",
          "transformation": "lookup"
        },
        {
          "name": "SplitValidInvalid",
          "description": "Equivalent to SSIS Conditional Split",
          "transformation": "conditionalSplit"
        },
        {
          "name": "AggregateByRegion",
          "description": "Equivalent to SSIS Aggregate transform",
          "transformation": "aggregate"
        }
      ],
      "sinks": [
        {
          "dataset": {
            "referenceName": "DestCustomers",
            "type": "DatasetReference"
          },
          "name": "SinkData"
        },
        {
          "dataset": {
            "referenceName": "ErrorLog",
            "type": "DatasetReference"
          },
          "name": "ErrorSink"
        }
      ],
      "script": "source(output(\n    CustomerId as string,\n    CustomerName as string,\n    Email as string,\n    CountryCode as string,\n    CreatedDate as string\n  ),\n  allowSchemaDrift: true) ~> SourceData\nSourceData derive(\n    CustomerId = toInteger(CustomerId),\n    CustomerName = trim(upper(CustomerName)),\n    Email = lower(trim(Email)),\n    CreatedDate = toDate(CreatedDate, 'yyyy-MM-dd')\n  ) ~> CleanseData\nCleanseData, CountryRef lookup(\n    CountryCode == CountryRef@Code,\n    multiple: false,\n    pickup: 'first',\n    asc(Code, true)\n  ) ~> LookupCountry\nLookupCountry split(\n    isNull(CountryRef@Code),\n    disjoint: false\n  ) ~> SplitValidInvalid@(Invalid, Valid)\nSplitValidInvalid@Valid aggregate(\n    groupBy(Region),\n    CustomerCount = count(),\n    TotalValue = sum(LTV)\n  ) ~> AggregateByRegion\nAggregateByRegion sink(\n    allowSchemaDrift: true,\n    validateSchema: false\n  ) ~> SinkData\nSplitValidInvalid@Invalid sink(\n    allowSchemaDrift: true\n  ) ~> ErrorSink"
    }
  }
}
```

## SSIS to Data Flow Mapping

| SSIS Component | Data Flow Equivalent |
|----------------|---------------------|
| OLE DB Source | Source transformation |
| Flat File Source | Delimited text dataset |
| Derived Column | Derived column transformation |
| Data Conversion | Derived column with cast() |
| Lookup | Lookup transformation |
| Conditional Split | Conditional split transformation |
| Union All | Union transformation |
| Aggregate | Aggregate transformation |
| Sort | Sort transformation |
| Merge Join | Join transformation |
| Multicast | Split (1 to many) |
| Row Count | Aggregate with count() |

## Converting Common Patterns

### SSIS Lookup to Data Flow

```python
# SSIS Lookup equivalent in Data Flow script
source(output(
    OrderId as integer,
    CustomerId as integer,
    OrderAmount as decimal(18,2)
)) ~> Orders

source(output(
    CustomerId as integer,
    CustomerName as string,
    Region as string
)) ~> Customers

Orders, Customers lookup(
    Orders@CustomerId == Customers@CustomerId,
    multiple: false,
    pickup: 'first'
) ~> JoinCustomer
```

### SSIS Script Component to Data Flow

```python
# Complex transformations that were in Script Component
# can use derived columns with expressions

source(...) ~> InputData

InputData derive(
    # Email validation (was in Script Component)
    IsValidEmail = regexMatch(Email, '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'),

    # Phone formatting (was in Script Component)
    FormattedPhone = concat(
        '(',
        substring(replace(Phone, '-', ''), 1, 3),
        ') ',
        substring(replace(Phone, '-', ''), 4, 3),
        '-',
        substring(replace(Phone, '-', ''), 7, 4)
    ),

    # Complex date logic (was in Script Component)
    FiscalYear = case(
        month(TransactionDate) >= 7, year(TransactionDate) + 1,
        year(TransactionDate)
    )
) ~> TransformedData
```

### SSIS For Each Loop to Data Factory

```json
{
  "name": "ProcessMultipleFiles",
  "properties": {
    "activities": [
      {
        "name": "GetFileList",
        "type": "GetMetadata",
        "typeProperties": {
          "dataset": {
            "referenceName": "SourceFolder",
            "type": "DatasetReference"
          },
          "fieldList": ["childItems"]
        }
      },
      {
        "name": "ForEachFile",
        "type": "ForEach",
        "dependsOn": [
          {
            "activity": "GetFileList",
            "dependencyConditions": ["Succeeded"]
          }
        ],
        "typeProperties": {
          "items": {
            "value": "@activity('GetFileList').output.childItems",
            "type": "Expression"
          },
          "isSequential": false,
          "batchCount": 20,
          "activities": [
            {
              "name": "ProcessFile",
              "type": "ExecuteDataFlow",
              "typeProperties": {
                "dataFlow": {
                  "referenceName": "FileProcessingFlow",
                  "type": "DataFlowReference"
                },
                "compute": {
                  "coreCount": 8,
                  "computeType": "General"
                },
                "traceLevel": "Fine"
              }
            }
          ]
        }
      }
    ]
  }
}
```

## Hybrid Approach

Sometimes the best approach is hybrid - some packages on Azure-SSIS IR, others converted to Data Flows:

```json
{
  "name": "HybridETLPipeline",
  "properties": {
    "activities": [
      {
        "name": "RunLegacySSIS",
        "type": "ExecuteSSISPackage",
        "typeProperties": {
          "packageLocation": {
            "type": "SSISDB",
            "packagePath": "ETL/LegacyPackage/Package.dtsx"
          },
          "connectVia": {
            "referenceName": "AzureSsisIR",
            "type": "IntegrationRuntimeReference"
          }
        }
      },
      {
        "name": "RunModernDataFlow",
        "type": "ExecuteDataFlow",
        "dependsOn": [
          {
            "activity": "RunLegacySSIS",
            "dependencyConditions": ["Succeeded"]
          }
        ],
        "typeProperties": {
          "dataFlow": {
            "referenceName": "ModernTransformations",
            "type": "DataFlowReference"
          }
        }
      }
    ]
  }
}
```

## Migration Assessment

```powershell
# Script to assess SSIS packages for migration
function Assess-SSISPackage {
    param (
        [string]$PackagePath
    )

    $xml = [xml](Get-Content $PackagePath)
    $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace("DTS", "www.microsoft.com/SqlServer/Dts")

    $assessment = @{
        PackageName = $xml.SelectSingleNode("//DTS:Property[@DTS:Name='PackageName']", $ns).InnerText
        Components = @()
        Complexity = "Low"
        MigrationPath = "Data Flow"
    }

    # Check for complex components
    $scriptTasks = $xml.SelectNodes("//DTS:Executable[@DTS:ExecutableType='Microsoft.SqlServer.Dts.Tasks.ScriptTask.ScriptTask']", $ns)
    if ($scriptTasks.Count -gt 3) {
        $assessment.Complexity = "High"
        $assessment.MigrationPath = "Azure-SSIS IR"
    }

    # Check for custom components
    $customComponents = $xml.SelectNodes("//component[@componentClassID!='']", $ns)
    foreach ($comp in $customComponents) {
        if ($comp.componentClassID -notlike "Microsoft*") {
            $assessment.Components += "Custom: $($comp.componentClassID)"
            $assessment.Complexity = "High"
            $assessment.MigrationPath = "Azure-SSIS IR with custom setup"
        }
    }

    return $assessment
}

# Assess all packages
$packages = Get-ChildItem -Path "C:\SSISProjects" -Filter "*.dtsx" -Recurse
$assessments = $packages | ForEach-Object { Assess-SSISPackage -PackagePath $_.FullName }

$assessments | Export-Csv -Path "migration-assessment.csv" -NoTypeInformation
```

## Conclusion

SSIS migration to Azure offers flexibility. Azure-SSIS IR provides the fastest path for lift-and-shift, while Data Factory Data Flows offer a modern, serverless alternative. Most organizations benefit from a phased approach - running critical packages on Azure-SSIS IR while gradually converting simpler packages to native Data Flows.

## Resources

- [Azure-SSIS Integration Runtime](https://docs.microsoft.com/en-us/azure/data-factory/create-azure-ssis-integration-runtime)
- [Mapping Data Flows](https://docs.microsoft.com/en-us/azure/data-factory/concepts-data-flow-overview)
- [SSIS Migration Guide](https://docs.microsoft.com/en-us/azure/data-factory/how-to-migrate-ssis-job-ssms)

