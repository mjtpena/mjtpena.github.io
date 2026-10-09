---
title: "Dynamic Content in Azure Data Factory: Expressions and Functions"
description: "Dynamic content in ADF is the expression system that makes pipelines adaptive rather than static—generating file paths from date parameters, constructing…"
author: "Michael John Peña"
draft: false
date: 2021-08-26
tags: ["Azure", "Data Factory", "Expressions", "Dynamic Content", "ETL"]
---

Dynamic content in ADF is the expression system that makes pipelines adaptive rather than static—generating file paths from date parameters, constructing SQL queries from watermark values, selecting configurations based on runtime conditions. The expression language uses `@{...}` syntax with functions for string manipulation, date arithmetic, JSON parsing, and conditional logic. The patterns I use most: `@formatDateTime(pipeline().TriggerTime, 'yyyy/MM/dd')` for date-partitioned blob paths, `@activity('Lookup').output.firstRow.WatermarkValue` for watermark-based incremental loads, and `@if(equals(pipeline().parameters.mode, 'full'), 'TRUNCATE TABLE Target; ', '')` for conditional pre-copy steps. Dynamic content is what separates a parameterised pipeline that handles one scenario with parameters from a genuinely flexible pipeline that adapts its behaviour based on runtime conditions.

## Expression Syntax Basics

```json
// Basic expression format
{
    "value": "@pipeline().parameters.myParameter",
    "type": "Expression"
}

// Using functions
{
    "value": "@concat('prefix_', pipeline().parameters.tableName, '_suffix')",
    "type": "Expression"
}

// Conditional expression
{
    "value": "@if(equals(pipeline().parameters.environment, 'prod'), 'production-server', 'dev-server')",
    "type": "Expression"
}
```

## String Functions

```json
{
    "activities": [
        {
            "name": "DynamicStringExamples",
            "type": "SetVariable",
            "typeProperties": {
                "variableName": "result",
                "value": {
                    "value": "@concat(
                        'Processing file: ',
                        toUpper(pipeline().parameters.fileName),
                        ' at ',
                        formatDateTime(utcnow(), 'yyyy-MM-dd HH:mm:ss')
                    )",
                    "type": "Expression"
                }
            }
        }
    ]
}
```

Common string functions:
- `concat()` - Concatenate strings
- `substring()` - Extract substring
- `replace()` - Replace text
- `split()` - Split into array
- `trim()`, `toLower()`, `toUpper()` - String manipulation
- `contains()`, `startsWith()`, `endsWith()` - String testing

## Date and Time Functions

```json
{
    "name": "DateTimeExamples",
    "properties": {
        "activities": [
            {
                "name": "SetDateVariables",
                "type": "SetVariable",
                "typeProperties": {
                    "variableName": "datePath",
                    "value": {
                        "value": "@concat(
                            'data/',
                            formatDateTime(utcnow(), 'yyyy'),
                            '/',
                            formatDateTime(utcnow(), 'MM'),
                            '/',
                            formatDateTime(utcnow(), 'dd')
                        )",
                        "type": "Expression"
                    }
                }
            },
            {
                "name": "CalculateDateRange",
                "type": "SetVariable",
                "dependsOn": [
                    {
                        "activity": "SetDateVariables",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "variableName": "dateRange",
                    "value": {
                        "value": "@json(concat('{\"startDate\": \"', formatDateTime(adddays(utcnow(), -7), 'yyyy-MM-dd'), '\", \"endDate\": \"', formatDateTime(utcnow(), 'yyyy-MM-dd'), '\"}'))",
                        "type": "Expression"
                    }
                }
            }
        ]
    }
}
```

## Collection Functions

```json
{
    "name": "CollectionExamples",
    "type": "ForEach",
    "typeProperties": {
        "items": {
            "value": "@split(pipeline().parameters.tableList, ',')",
            "type": "Expression"
        },
        "activities": [
            {
                "name": "ProcessTable",
                "type": "Copy",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": {
                            "value": "@concat('SELECT * FROM ', item())",
                            "type": "Expression"
                        }
                    }
                }
            }
        ]
    }
}
```

```json
// Array manipulation examples
{
    "firstItem": "@first(activity('Lookup').output.value)",
    "lastItem": "@last(activity('Lookup').output.value)",
    "itemCount": "@length(activity('Lookup').output.value)",
    "filteredItems": "@filter(activity('Lookup').output.value, item => item.isActive == true)",
    "containsValue": "@contains(activity('Lookup').output.value, 'searchString')"
}
```

## Conditional Logic

```json
{
    "name": "ConditionalCopy",
    "type": "Copy",
    "typeProperties": {
        "source": {
            "type": "AzureSqlSource",
            "sqlReaderQuery": {
                "value": "@if(
                    equals(pipeline().parameters.loadType, 'Full'),
                    concat('SELECT * FROM ', pipeline().parameters.tableName),
                    concat(
                        'SELECT * FROM ',
                        pipeline().parameters.tableName,
                        ' WHERE ModifiedDate > ''',
                        pipeline().parameters.lastLoadDate,
                        ''''
                    )
                )",
                "type": "Expression"
            }
        },
        "sink": {
            "type": "AzureSqlSink",
            "preCopyScript": {
                "value": "@if(
                    equals(pipeline().parameters.loadType, 'Full'),
                    concat('TRUNCATE TABLE staging.', pipeline().parameters.tableName),
                    ''
                )",
                "type": "Expression"
            }
        }
    }
}
```

## System Variables

```json
{
    "name": "UseSystemVariables",
    "properties": {
        "activities": [
            {
                "name": "LogPipelineInfo",
                "type": "SqlServerStoredProcedure",
                "typeProperties": {
                    "storedProcedureName": "sp_LogPipelineRun",
                    "storedProcedureParameters": {
                        "PipelineName": {
                            "value": "@pipeline().Pipeline",
                            "type": "String"
                        },
                        "RunId": {
                            "value": "@pipeline().RunId",
                            "type": "String"
                        },
                        "TriggerName": {
                            "value": "@pipeline().TriggerName",
                            "type": "String"
                        },
                        "TriggerTime": {
                            "value": "@pipeline().TriggerTime",
                            "type": "DateTime"
                        },
                        "FactoryName": {
                            "value": "@pipeline().DataFactory",
                            "type": "String"
                        },
                        "GroupId": {
                            "value": "@pipeline().GroupId",
                            "type": "String"
                        }
                    }
                }
            }
        ]
    }
}
```

## Building Dynamic Queries

```json
{
    "name": "DynamicQueryBuilder",
    "properties": {
        "parameters": {
            "columns": { "type": "Array" },
            "tableName": { "type": "String" },
            "filterColumn": { "type": "String" },
            "filterValue": { "type": "String" },
            "orderByColumn": { "type": "String" }
        },
        "activities": [
            {
                "name": "BuildAndExecuteQuery",
                "type": "Lookup",
                "typeProperties": {
                    "source": {
                        "type": "AzureSqlSource",
                        "sqlReaderQuery": {
                            "value": "@concat(
                                'SELECT ',
                                if(
                                    empty(pipeline().parameters.columns),
                                    '*',
                                    join(pipeline().parameters.columns, ', ')
                                ),
                                ' FROM ',
                                pipeline().parameters.tableName,
                                if(
                                    empty(pipeline().parameters.filterValue),
                                    '',
                                    concat(
                                        ' WHERE ',
                                        pipeline().parameters.filterColumn,
                                        ' = ''',
                                        pipeline().parameters.filterValue,
                                        ''''
                                    )
                                ),
                                if(
                                    empty(pipeline().parameters.orderByColumn),
                                    '',
                                    concat(' ORDER BY ', pipeline().parameters.orderByColumn)
                                )
                            )",
                            "type": "Expression"
                        }
                    },
                    "dataset": {
                        "referenceName": "GenericSqlDataset",
                        "type": "DatasetReference"
                    }
                }
            }
        ]
    }
}
```

## JSON Manipulation

```json
{
    "name": "JsonManipulation",
    "properties": {
        "activities": [
            {
                "name": "ParseJsonConfig",
                "type": "SetVariable",
                "typeProperties": {
                    "variableName": "config",
                    "value": {
                        "value": "@json(pipeline().parameters.configJson)",
                        "type": "Expression"
                    }
                }
            },
            {
                "name": "ExtractValue",
                "type": "SetVariable",
                "dependsOn": [
                    {
                        "activity": "ParseJsonConfig",
                        "dependencyConditions": ["Succeeded"]
                    }
                ],
                "typeProperties": {
                    "variableName": "extractedValue",
                    "value": {
                        "value": "@variables('config').settings.targetTable",
                        "type": "Expression"
                    }
                }
            },
            {
                "name": "BuildJsonOutput",
                "type": "SetVariable",
                "typeProperties": {
                    "variableName": "outputJson",
                    "value": {
                        "value": "@string(json(concat(
                            '{',
                            '\"status\": \"success\",',
                            '\"processedAt\": \"', utcnow(), '\",',
                            '\"recordCount\": ', activity('CopyData').output.rowsCopied,
                            '}'
                        )))",
                        "type": "Expression"
                    }
                }
            }
        ]
    }
}
```

## Common Expression Patterns

```python
# Python helper to generate ADF expressions
class ADFExpressionBuilder:
    @staticmethod
    def date_partition_path(base_path, date_param='utcnow()'):
        """Generate date-partitioned path expression"""
        return f"@concat('{base_path}/', formatDateTime({date_param}, 'yyyy/MM/dd'))"

    @staticmethod
    def incremental_query(table_name, watermark_column, last_watermark_param):
        """Generate incremental load query"""
        return f"""@concat(
            'SELECT * FROM {table_name} WHERE {watermark_column} > ''',
            {last_watermark_param},
            ''''
        )"""

    @staticmethod
    def safe_table_name(schema_param, table_param):
        """Generate safe table reference"""
        return f"@concat('[', {schema_param}, '].[', {table_param}, ']')"

    @staticmethod
    def error_handling_message(activity_name):
        """Generate error message expression"""
        return f"""@concat(
            'Activity {activity_name} failed. ',
            'Error: ', activity('{activity_name}').error.message,
            ' | Code: ', activity('{activity_name}').error.errorCode
        )"""
```

## Best Practices

1. **Use variables for complex expressions**: Break down into readable parts
2. **Validate inputs**: Check for null/empty before using
3. **Handle edge cases**: Use coalesce() and if() for defaults
4. **Test expressions**: Use the expression builder in ADF UI
5. **Document complex logic**: Add comments in pipeline descriptions

Dynamic content transforms Azure Data Factory from a simple copy tool into a powerful, flexible data integration platform capable of handling complex, data-driven workflows.
