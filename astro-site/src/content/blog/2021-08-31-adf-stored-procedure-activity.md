---
title: "Azure Data Factory Stored Procedure Activity: Database Logic in Pipelines"
author: "Michael John Peña"
draft: false
date: 2021-08-31
tags: ["Azure", "Data Factory", "Stored Procedure", "SQL", "ETL"]

---

I wrote "Azure Data Factory Stored Procedure Activity: Database Logic in Pipelines" to share practical, production-minded guidance on this topic.

## Basic Stored Procedure Activity

```json
{
    "name": "ExecuteStoredProcedure",
    "type": "SqlServerStoredProcedure",
    "linkedServiceName": {
        "referenceName": "AzureSqlDatabase",
        "type": "LinkedServiceReference"
    },
    "typeProperties": {
        "storedProcedureName": "[dbo].[sp_ProcessData]"
    }
}
```

## Stored Procedure with Parameters

```json
{
    "name": "ExecuteWithParameters",
    "type": "SqlServerStoredProcedure",
    "linkedServiceName": {
        "referenceName": "AzureSqlDatabase",
        "type": "LinkedServiceReference"
    },
    "typeProperties": {
        "storedProcedureName": "[ETL].[sp_LoadTable]",
        "storedProcedureParameters": {
            "TableName": {
                "value": {
                    "value": "@pipeline().parameters.tableName",
                    "type": "Expression"
                },
                "type": "String"
            },
            "LoadDate": {
                "value": {
                    "value": "@utcnow()",
                    "type": "Expression"
                },
                "type": "DateTime"
            },
            "BatchSize": {
                "value": 10000,
                "type": "Int32"
            },
            "IsFullLoad": {
                "value": {
                    "value": "@pipeline().parameters.isFullLoad",
                    "type": "Expression"
                },
                "type": "Boolean"
            }
        }
    }
}
```

## Creating the Stored Procedures

```sql
-- Logging stored procedure
CREATE PROCEDURE [ETL].[sp_LogPipelineRun]
    @PipelineName NVARCHAR(100),
    @RunId NVARCHAR(50),
    @Status NVARCHAR(20),
    @StartTime DATETIME,
    @EndTime DATETIME = NULL,
    @RowsProcessed INT = 0,
    @ErrorMessage NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO ETL.PipelineLog (
        PipelineName,
        RunId,
        Status,
        StartTime,
        EndTime,
        RowsProcessed,
        ErrorMessage,
        CreatedDate
    )
    VALUES (
        @PipelineName,
        @RunId,
        @Status,
        @StartTime,
        @EndTime,
        @RowsProcessed,
        @ErrorMessage,
        GETUTCDATE()
    );
END;
GO

-- Watermark update stored procedure
CREATE PROCEDURE [ETL].[sp_UpdateWatermark]
    @TableName NVARCHAR(100),
    @WatermarkValue DATETIME
AS
BEGIN
    SET NOCOUNT ON;

    MERGE ETL.Watermarks AS target
    USING (SELECT @TableName AS TableName, @WatermarkValue AS WatermarkValue) AS source
    ON target.TableName = source.TableName
    WHEN MATCHED THEN
        UPDATE SET
            WatermarkValue = source.WatermarkValue,
            LastUpdated = GETUTCDATE()
    WHEN NOT MATCHED THEN
        INSERT (TableName, WatermarkValue, LastUpdated)
        VALUES (source.TableName, source.WatermarkValue, GETUTCDATE());
END;
GO

-- Data transformation stored procedure
CREATE PROCEDURE [ETL].[sp_TransformSalesData]
    @SourceSchema NVARCHAR(50),
    @SourceTable NVARCHAR(100),
    @TargetSchema NVARCHAR(50),
    @TargetTable NVARCHAR(100),
    @LoadDate DATE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @SQL NVARCHAR(MAX);
    DECLARE @RowCount INT;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Delete existing data for the load date
        SET @SQL = N'DELETE FROM ' + QUOTENAME(@TargetSchema) + '.' + QUOTENAME(@TargetTable) +
                   N' WHERE LoadDate = @LoadDate';
        EXEC sp_executesql @SQL, N'@LoadDate DATE', @LoadDate;

        -- Insert transformed data
        SET @SQL = N'
        INSERT INTO ' + QUOTENAME(@TargetSchema) + '.' + QUOTENAME(@TargetTable) + '
        (
            ProductId,
            ProductName,
            Category,
            TotalQuantity,
            TotalRevenue,
            AvgUnitPrice,
            LoadDate
        )
        SELECT
            p.ProductId,
            p.ProductName,
            c.CategoryName,
            SUM(s.Quantity) AS TotalQuantity,
            SUM(s.Quantity * s.UnitPrice) AS TotalRevenue,
            AVG(s.UnitPrice) AS AvgUnitPrice,
            @LoadDate AS LoadDate
        FROM ' + QUOTENAME(@SourceSchema) + '.' + QUOTENAME(@SourceTable) + ' s
        INNER JOIN Products p ON s.ProductId = p.ProductId
        INNER JOIN Categories c ON p.CategoryId = c.CategoryId
        WHERE CAST(s.OrderDate AS DATE) = @LoadDate
        GROUP BY p.ProductId, p.ProductName, c.CategoryName';

        EXEC sp_executesql @SQL, N'@LoadDate DATE', @LoadDate;

        SET @RowCount = @@ROWCOUNT;

        COMMIT TRANSACTION;

        -- Return result
        SELECT @RowCount AS RowsProcessed, 'Success' AS Status;

    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

        SELECT
            0 AS RowsProcessed,
            'Failed' AS Status,
            ERROR_MESSAGE() AS ErrorMessage,
            ERROR_NUMBER() AS ErrorNumber;

        THROW;
    END CATCH
END;
GO
```

## Using Output from Stored Procedure

```json
{
    "name": "ExecuteAndUseOutput",
    "properties": {
        "activities": [
            {
                "name": "RunTransformation",
                "type": "SqlServerStoredProcedure",
                "linkedServiceName": {
                    "referenceName": "AzureSqlDatabase",
                    "type": "LinkedServiceReference"
                },
                "typeProperties": {
                    "storedProcedureName": "[ETL].[sp_TransformSalesData]",
                    "storedProcedureParameters": {
                        "SourceSchema": { "value": "staging", "type": "String" },
                        "SourceTable": { "value": "RawSales", "type": "String" },
                        "TargetSchema": { "value": "dw", "type": "String" },
                        "TargetTable": { "value": "FactSales", "type": "String" },
                        "LoadDate": {
                            "value": { "value": "@pipeline().parameters.loadDate", "type": "Expression" },
                            "type": "DateTime"
                        }
                    }
                }
            },
            {
                "name": "LogResult",
                "type": "SqlServerStoredProcedure",
                "dependsOn": [
                    {
                        "activity": "RunTransformation",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "storedProcedureName": "[ETL].[sp_LogPipelineRun]",
                    "storedProcedureParameters": {
                        "PipelineName": {
                            "value": { "value": "@pipeline().Pipeline", "type": "Expression" },
                            "type": "String"
                        },
                        "RunId": {
                            "value": { "value": "@pipeline().RunId", "type": "Expression" },
                            "type": "String"
                        },
                        "Status": { "value": "Success", "type": "String" },
                        "StartTime": {
                            "value": { "value": "@pipeline().TriggerTime", "type": "Expression" },
                            "type": "DateTime"
                        },
                        "EndTime": {
                            "value": { "value": "@utcnow()", "type": "Expression" },
                            "type": "DateTime"
                        },
                        "RowsProcessed": {
                            "value": { "value": "@activity('RunTransformation').output.firstRow.RowsProcessed", "type": "Expression" },
                            "type": "Int32"
                        }
                    }
                }
            }
        ]
    }
}
```

## Bulk Operations with Table-Valued Parameters

```sql
-- Create table type
CREATE TYPE [ETL].[OrderIdTableType] AS TABLE
(
    OrderId INT NOT NULL
);
GO

-- Stored procedure with TVP
CREATE PROCEDURE [ETL].[sp_ProcessOrderBatch]
    @OrderIds ETL.OrderIdTableType READONLY,
    @ProcessingDate DATETIME
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE o
    SET
        ProcessedDate = @ProcessingDate,
        Status = 'Processed'
    FROM Orders o
    INNER JOIN @OrderIds ids ON o.OrderId = ids.OrderId
    WHERE o.Status = 'Pending';

    SELECT @@ROWCOUNT AS ProcessedCount;
END;
GO
```

## Pre and Post Copy Stored Procedures

```json
{
    "name": "CopyWithStoredProcedures",
    "type": "Copy",
    "typeProperties": {
        "source": {
            "type": "AzureSqlSource"
        },
        "sink": {
            "type": "AzureSqlSink",
            "preCopyScript": "EXEC [ETL].[sp_PreCopyCleanup] @TableName = 'TargetTable'",
            "sqlWriterStoredProcedureName": "[ETL].[sp_UpsertData]",
            "sqlWriterTableType": "ETL.DataTableType",
            "sqlWriterUseTableLock": true,
            "storedProcedureTableTypeParameterName": "DataTable"
        }
    }
}
```

```sql
-- Pre-copy cleanup procedure
CREATE PROCEDURE [ETL].[sp_PreCopyCleanup]
    @TableName NVARCHAR(100)
AS
BEGIN
    DECLARE @SQL NVARCHAR(MAX);

    -- Archive existing data
    SET @SQL = N'
    INSERT INTO Archive.' + QUOTENAME(@TableName) + '
    SELECT *, GETUTCDATE() AS ArchivedDate
    FROM staging.' + QUOTENAME(@TableName);

    EXEC sp_executesql @SQL;

    -- Truncate staging table
    SET @SQL = N'TRUNCATE TABLE staging.' + QUOTENAME(@TableName);
    EXEC sp_executesql @SQL;
END;
GO

-- Upsert stored procedure
CREATE PROCEDURE [ETL].[sp_UpsertData]
    @DataTable ETL.DataTableType READONLY
AS
BEGIN
    MERGE dbo.TargetTable AS target
    USING @DataTable AS source
    ON target.Id = source.Id
    WHEN MATCHED THEN
        UPDATE SET
            target.Column1 = source.Column1,
            target.Column2 = source.Column2,
            target.ModifiedDate = GETUTCDATE()
    WHEN NOT MATCHED THEN
        INSERT (Id, Column1, Column2, CreatedDate)
        VALUES (source.Id, source.Column1, source.Column2, GETUTCDATE());
END;
GO
```

## Error Handling Pipeline

```json
{
    "name": "StoredProcWithErrorHandling",
    "properties": {
        "activities": [
            {
                "name": "ExecuteProc",
                "type": "SqlServerStoredProcedure",
                "typeProperties": {
                    "storedProcedureName": "[ETL].[sp_ProcessData]"
                }
            },
            {
                "name": "LogSuccess",
                "type": "SqlServerStoredProcedure",
                "dependsOn": [
                    {
                        "activity": "ExecuteProc",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "storedProcedureName": "[ETL].[sp_LogPipelineRun]",
                    "storedProcedureParameters": {
                        "Status": { "value": "Success", "type": "String" }
                    }
                }
            },
            {
                "name": "LogFailure",
                "type": "SqlServerStoredProcedure",
                "dependsOn": [
                    {
                        "activity": "ExecuteProc",
                        "dependencyConditions": ["Failed"]
                    }
                ],
                "typeProperties": {
                    "storedProcedureName": "[ETL].[sp_LogPipelineRun]",
                    "storedProcedureParameters": {
                        "Status": { "value": "Failed", "type": "String" },
                        "ErrorMessage": {
                            "value": { "value": "@activity('ExecuteProc').error.message", "type": "Expression" },
                            "type": "String"
                        }
                    }
                }
            }
        ]
    }
}
```

## Best Practices

1. **Use proper error handling**: Wrap in TRY/CATCH blocks
2. **Return meaningful output**: Help pipeline make decisions
3. **Use transactions wisely**: Ensure data consistency
4. **Parameterize everything**: Make procedures reusable
5. **Log execution details**: Aid in troubleshooting

The Stored Procedure Activity bridges the gap between data movement and data transformation, enabling complex database logic to be orchestrated as part of your Azure Data Factory pipelines.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
