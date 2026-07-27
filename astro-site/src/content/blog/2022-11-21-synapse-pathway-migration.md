---
title: "Synapse Pathway: Accelerating Data Warehouse Migration"
author: Michael John Peña
draft: false
date: 2022-11-21
tags:
  - Azure
  - Synapse Analytics
  - Migration
  - Data Warehouse
  - SQL Server

---

I wrote "Synapse Pathway: Accelerating Data Warehouse Migration" to share practical, production-minded guidance on this topic.

## What is Synapse Pathway?

Synapse Pathway translates SQL code from various sources to Azure Synapse Analytics SQL syntax:

- **Teradata** to Synapse
- **Netezza** to Synapse
- **Snowflake** to Synapse
- **Amazon Redshift** to Synapse
- **SQL Server** to Synapse

## Getting Started

### Installation

```powershell
# Download Synapse Pathway
Invoke-WebRequest -Uri "https://aka.ms/synapse-pathway-download" -OutFile "SynapsePathway.msi"

# Install
Start-Process msiexec.exe -ArgumentList '/i SynapsePathway.msi /quiet' -Wait

# Verify installation
& "$env:ProgramFiles\Microsoft\Synapse Pathway\SynapsePathway.exe" --version
```

### Basic Translation

```powershell
# Translate a single file
SynapsePathway.exe `
    --source Teradata `
    --input "C:\Migration\input\script.sql" `
    --output "C:\Migration\output"

# Translate entire directory
SynapsePathway.exe `
    --source Teradata `
    --input "C:\Migration\input" `
    --output "C:\Migration\output" `
    --recursive
```

## Configuration

```json
{
  "translationConfig": {
    "sourceSystem": "Teradata",
    "targetSystem": "SynapseSQL",
    "inputPath": "./input",
    "outputPath": "./output",
    "errorHandling": "ContinueOnError",
    "options": {
      "preserveComments": true,
      "generateLineNumbers": true,
      "inlineConversions": false,
      "schemaMapping": {
        "DBC": "dbo",
        "PROD_DB": "production"
      },
      "dataTypeMapping": {
        "BYTEINT": "TINYINT",
        "NUMBER(38,0)": "BIGINT"
      }
    }
  }
}
```

## Teradata to Synapse Example

### Original Teradata Code

```sql
-- Teradata source
CREATE MULTISET TABLE PROD_DB.CUSTOMER_SALES
    , NO FALLBACK
    , NO BEFORE JOURNAL
    , NO AFTER JOURNAL
    , CHECKSUM = DEFAULT
(
    customer_id     INTEGER NOT NULL,
    customer_name   VARCHAR(100) CHARACTER SET LATIN NOT CASESPECIFIC,
    sale_date       DATE FORMAT 'YYYY-MM-DD',
    sale_amount     DECIMAL(18,2),
    region          VARCHAR(50)
)
PRIMARY INDEX (customer_id)
PARTITION BY RANGE_N(sale_date BETWEEN DATE '2020-01-01' AND DATE '2025-12-31' EACH INTERVAL '1' MONTH);

-- Teradata specific function
SELECT
    customer_id,
    customer_name,
    ZEROIFNULL(sale_amount) as sale_amount,
    QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY sale_date DESC) = 1
FROM PROD_DB.CUSTOMER_SALES
WHERE sale_date BETWEEN ADD_MONTHS(CURRENT_DATE, -12) AND CURRENT_DATE;
```

### Translated Synapse Code

```sql
-- Synapse translated output
CREATE TABLE production.CUSTOMER_SALES
(
    customer_id     INT NOT NULL,
    customer_name   NVARCHAR(100),
    sale_date       DATE,
    sale_amount     DECIMAL(18,2),
    region          NVARCHAR(50)
)
WITH
(
    DISTRIBUTION = HASH(customer_id),
    CLUSTERED COLUMNSTORE INDEX,
    PARTITION (sale_date RANGE RIGHT FOR VALUES
        ('2020-01-01', '2020-02-01', '2020-03-01', /* ... */ '2025-12-01'))
);

-- Translated query
SELECT
    customer_id,
    customer_name,
    ISNULL(sale_amount, 0) as sale_amount
FROM (
    SELECT
        customer_id,
        customer_name,
        sale_amount,
        ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY sale_date DESC) as rn
    FROM production.CUSTOMER_SALES
    WHERE sale_date BETWEEN DATEADD(month, -12, CURRENT_TIMESTAMP) AND CURRENT_TIMESTAMP
) t
WHERE rn = 1;
```

## Netezza to Synapse

### Original Netezza

```sql
-- Netezza source
CREATE TABLE SALES_FACT (
    sale_id         BIGINT NOT NULL,
    product_id      INTEGER,
    customer_id     INTEGER,
    sale_date       DATE,
    quantity        INTEGER,
    unit_price      NUMERIC(10,2),
    total_amount    NUMERIC(18,2)
)
DISTRIBUTE ON (sale_id);

-- Netezza specific syntax
SELECT
    DECODE(status, 1, 'Active', 2, 'Inactive', 'Unknown') as status_desc,
    NVL(discount, 0) as discount,
    EXTRACT(MONTH FROM sale_date) as sale_month,
    DATE_TRUNC('MONTH', sale_date) as month_start
FROM SALES_FACT
WHERE sale_date > CURRENT_DATE - 365;
```

### Translated to Synapse

```sql
-- Synapse translated output
CREATE TABLE dbo.SALES_FACT (
    sale_id         BIGINT NOT NULL,
    product_id      INT,
    customer_id     INT,
    sale_date       DATE,
    quantity        INT,
    unit_price      DECIMAL(10,2),
    total_amount    DECIMAL(18,2)
)
WITH (
    DISTRIBUTION = HASH(sale_id),
    CLUSTERED COLUMNSTORE INDEX
);

-- Translated query
SELECT
    CASE status WHEN 1 THEN 'Active' WHEN 2 THEN 'Inactive' ELSE 'Unknown' END as status_desc,
    ISNULL(discount, 0) as discount,
    MONTH(sale_date) as sale_month,
    DATEADD(month, DATEDIFF(month, 0, sale_date), 0) as month_start
FROM dbo.SALES_FACT
WHERE sale_date > DATEADD(day, -365, GETDATE());
```

## Handling Complex Transformations

### Stored Procedures

```sql
-- Original Teradata procedure
REPLACE PROCEDURE PROD_DB.usp_UpdateSales(
    IN p_start_date DATE,
    IN p_end_date DATE
)
BEGIN
    DECLARE v_count INTEGER;

    DELETE FROM SALES_STAGING;

    INSERT INTO SALES_STAGING
    SELECT * FROM SALES_FACT
    WHERE sale_date BETWEEN p_start_date AND p_end_date;

    SELECT COUNT(*) INTO v_count FROM SALES_STAGING;

    IF v_count > 0 THEN
        MERGE INTO SALES_TARGET t
        USING SALES_STAGING s
        ON t.sale_id = s.sale_id
        WHEN MATCHED THEN UPDATE SET
            t.quantity = s.quantity,
            t.total_amount = s.total_amount
        WHEN NOT MATCHED THEN INSERT VALUES
            (s.sale_id, s.product_id, s.customer_id, s.sale_date, s.quantity, s.unit_price, s.total_amount);
    END IF;
END;
```

```sql
-- Synapse translated procedure
CREATE PROCEDURE production.usp_UpdateSales
    @p_start_date DATE,
    @p_end_date DATE
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @v_count INT;

    TRUNCATE TABLE dbo.SALES_STAGING;

    INSERT INTO dbo.SALES_STAGING
    SELECT * FROM dbo.SALES_FACT
    WHERE sale_date BETWEEN @p_start_date AND @p_end_date;

    SELECT @v_count = COUNT(*) FROM dbo.SALES_STAGING;

    IF @v_count > 0
    BEGIN
        -- Synapse doesn't support MERGE, use UPDATE + INSERT
        UPDATE t
        SET
            t.quantity = s.quantity,
            t.total_amount = s.total_amount
        FROM dbo.SALES_TARGET t
        INNER JOIN dbo.SALES_STAGING s ON t.sale_id = s.sale_id;

        INSERT INTO dbo.SALES_TARGET
        SELECT s.*
        FROM dbo.SALES_STAGING s
        LEFT JOIN dbo.SALES_TARGET t ON s.sale_id = t.sale_id
        WHERE t.sale_id IS NULL;
    END
END;
```

## Assessment Report

Synapse Pathway generates detailed assessment reports:

```json
{
  "assessmentSummary": {
    "totalObjects": 1250,
    "translatedSuccessfully": 1180,
    "partiallyTranslated": 45,
    "requiresManualReview": 25,
    "translationRate": "94.4%"
  },
  "objectBreakdown": {
    "tables": {
      "total": 500,
      "translated": 498,
      "partial": 2
    },
    "views": {
      "total": 300,
      "translated": 285,
      "partial": 15
    },
    "procedures": {
      "total": 200,
      "translated": 175,
      "partial": 18,
      "manual": 7
    },
    "functions": {
      "total": 150,
      "translated": 135,
      "partial": 10,
      "manual": 5
    },
    "scripts": {
      "total": 100,
      "translated": 87,
      "manual": 13
    }
  },
  "issueCategories": [
    {
      "category": "Unsupported Function",
      "count": 15,
      "examples": ["HASHROW()", "STRTOK()"]
    },
    {
      "category": "Different Behavior",
      "count": 8,
      "examples": ["NULL handling in aggregates"]
    }
  ]
}
```

## Migration Workflow

```yaml
# migration-pipeline.yaml
stages:
  - stage: Assessment
    jobs:
      - job: GenerateReport
        steps:
          - script: |
              SynapsePathway.exe --assess \
                --source Teradata \
                --input $(inputPath) \
                --report $(reportPath)

  - stage: Translation
    dependsOn: Assessment
    condition: succeeded()
    jobs:
      - job: TranslateCode
        steps:
          - script: |
              SynapsePathway.exe \
                --source Teradata \
                --input $(inputPath) \
                --output $(outputPath) \
                --config $(configPath)

  - stage: Validation
    dependsOn: Translation
    jobs:
      - job: SyntaxCheck
        steps:
          - script: |
              foreach ($file in Get-ChildItem $(outputPath) -Filter *.sql) {
                sqlcmd -S $(synapseEndpoint) -d $(database) -i $file.FullName -b
              }

  - stage: Deployment
    dependsOn: Validation
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - job: DeployToSynapse
        steps:
          - task: SqlAzureDacpacDeployment@1
            inputs:
              azureSubscription: $(subscription)
              serverName: $(synapseEndpoint)
              databaseName: $(database)
              sqlFile: $(outputPath)/**/*.sql
```

## Best Practices

1. **Start with assessment**: Run assessment first to understand scope
2. **Handle exceptions**: Plan for manual translation of complex objects
3. **Test thoroughly**: Validate query results match source system
4. **Iterate**: Run translation multiple times as you refine configurations
5. **Version control**: Track both original and translated code

## Conclusion

Synapse Pathway significantly reduces the effort required for data warehouse migrations. While it handles the bulk of translation automatically, plan for some manual work on complex transformations. The assessment reports help you understand the migration scope and plan resources accordingly.

## Resources

- [Synapse Pathway Documentation](https://docs.microsoft.com/en-us/sql/tools/synapse-pathway/overview-synapse-pathway)
- [Download Synapse Pathway](https://aka.ms/synapse-pathway-download)
- [Migration Best Practices](https://docs.microsoft.com/en-us/azure/synapse-analytics/migration-guides/)

