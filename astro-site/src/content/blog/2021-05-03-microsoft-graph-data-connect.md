---
title: "Microsoft Graph Data Connect: Bulk Access to Microsoft 365 Data"
author: Michael John Peña
draft: false
date: 2021-05-03
tags:
  - Azure
  - Microsoft Graph
  - Data
  - Microsoft 365
  - Data Engineering

---

I wrote "Microsoft Graph Data Connect: Bulk Access to Microsoft 365 Data" to share practical, production-minded guidance on this topic.

## The Challenge with Graph API at Scale

Using the standard Graph API for analytics has limitations:
- Rate limiting kicks in quickly
- Pagination through millions of records is slow
- Token management at scale is complex
- Near-real-time patterns don't fit batch analytics

Graph Data Connect solves this by delivering bulk extracts of Microsoft 365 data directly to Azure Data Factory.

## How It Works

1. Configure a data pipeline in Azure Data Factory
2. Request specific datasets (emails, calendar, files metadata)
3. A Microsoft 365 admin approves the request
4. Data is delivered to your Azure storage

The data lands in Azure Storage as JSON files, ready for processing with Synapse, Databricks, or any data platform.

## Setting Up a Pipeline

First, register an app in Azure AD with the Graph Data Connect permissions:

```json
{
  "name": "graph-data-connect-app",
  "requiredResourceAccess": [
    {
      "resourceAppId": "00000003-0000-0000-c000-000000000000",
      "resourceAccess": [
        {
          "id": "810c84a8-4a9e-49e6-bf7d-12d183f40d01",
          "type": "Role"
        }
      ]
    }
  ]
}
```

Then create the Azure Data Factory pipeline:

```json
{
  "name": "CopyEmailMetadata",
  "properties": {
    "activities": [
      {
        "name": "CopyFromOffice365",
        "type": "Copy",
        "inputs": [
          {
            "referenceName": "Office365EmailDataset",
            "type": "DatasetReference"
          }
        ],
        "outputs": [
          {
            "referenceName": "AzureBlobOutput",
            "type": "DatasetReference"
          }
        ],
        "typeProperties": {
          "source": {
            "type": "Office365Source",
            "dateFilterColumn": "receivedDateTime",
            "startTime": "2021-04-01T00:00:00Z",
            "endTime": "2021-05-01T00:00:00Z",
            "userScopeFilterUri": "https://graph.microsoft.com/v1.0/groups/{group-id}/members"
          },
          "sink": {
            "type": "BlobSink"
          }
        }
      }
    ]
  }
}
```

## Available Datasets

Graph Data Connect provides access to:

**Email**
- Message headers and bodies
- Sent and received metadata
- Attachment information (not content)

**Calendar**
- Meeting metadata
- Attendee information
- Recurring event patterns

**People**
- Organization hierarchy
- Contact relationships
- Collaboration patterns

**Files** (OneDrive/SharePoint)
- File metadata
- Sharing information
- Activity signals

## Data Processing with Synapse

Once data lands in storage, process it with Synapse:

```python
# Synapse Spark notebook
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, explode, to_date

# Read email metadata from blob storage
emails_df = spark.read.json("abfss://m365data@yourstorage.dfs.core.windows.net/emails/")

# Parse the nested JSON structure
parsed_df = emails_df.select(
    col("id"),
    col("subject"),
    col("receivedDateTime"),
    col("sender.emailAddress.address").alias("senderEmail"),
    col("toRecipients").alias("recipients"),
    col("importance")
)

# Calculate email volume by sender
email_volume = parsed_df.groupBy("senderEmail") \
    .count() \
    .orderBy(col("count").desc())

# Analyze patterns by time
daily_volume = parsed_df \
    .withColumn("date", to_date("receivedDateTime")) \
    .groupBy("date") \
    .count() \
    .orderBy("date")

# Save to Synapse SQL pool for BI
email_volume.write \
    .format("com.databricks.spark.sqldw") \
    .option("url", "jdbc:sqlserver://synapse.sql.azuresynapse.net:1433") \
    .option("dbtable", "analytics.email_volume") \
    .option("tempDir", "abfss://temp@storage.dfs.core.windows.net/tempdata") \
    .mode("overwrite") \
    .save()
```

## Privacy and Compliance

Graph Data Connect includes privacy controls:

**Admin Consent**
Every pipeline requires approval from a Microsoft 365 admin. They see exactly what data is being requested and can approve or deny.

**User Scoping**
You can limit data extraction to specific groups:

```json
{
  "userScopeFilterUri": "https://graph.microsoft.com/v1.0/groups/{group-id}/members"
}
```

**Data Columns**
You can select only the columns you need, minimizing data exposure:

```json
{
  "outputColumns": [
    {"name": "id"},
    {"name": "subject"},
    {"name": "receivedDateTime"},
    {"name": "importance"}
  ]
}
```

**Pseudonymization**
Optionally hash user identifiers:

```json
{
  "allowedGroups": ["analytics-team-group-id"],
  "userEmailObfuscation": "hashUserEmail"
}
```

## Use Cases

**Workplace Analytics Alternative**
Build custom analytics dashboards showing collaboration patterns:
- Meeting time per team
- Email volume trends
- Cross-team collaboration

**Compliance Monitoring**
Extract communication metadata for compliance reviews:
- External communication patterns
- Sensitive content flags
- Policy violation detection

**Migration Planning**
Understand usage patterns before migrations:
- Active vs inactive mailboxes
- Storage consumption
- User activity patterns

## Cost Considerations

Graph Data Connect charges per record extracted:
- Messages: $0.000025 per message
- Calendar events: $0.000025 per event
- Files: $0.00001 per file

For a 10,000 user organization with 1M messages per month, expect around $25/month for message extraction alone.

Add Azure Data Factory and storage costs on top.

## Approval Workflow

The admin approval flow is critical:

1. Pipeline triggers
2. Request appears in Microsoft 365 admin center
3. Admin reviews requested data scope
4. Admin approves or denies
5. If approved, data extraction begins

```powershell
# Check pending requests via PowerShell
Connect-ExchangeOnline
Get-DataPolicyOperationAuditInfo -OperationType ApproveRequest
```

## Incremental Extraction

For ongoing analytics, implement incremental loads:

```json
{
  "typeProperties": {
    "source": {
      "type": "Office365Source",
      "dateFilterColumn": "receivedDateTime",
      "startTime": {
        "value": "@pipeline().parameters.lastRunTime",
        "type": "Expression"
      },
      "endTime": {
        "value": "@utcnow()",
        "type": "Expression"
      }
    }
  }
}
```

Track the last successful run time and use it for the next extraction.

## Getting Started

1. Request the Graph Data Connect preview access
2. Create an Azure AD app with appropriate permissions
3. Set up Azure Data Factory and storage
4. Work with your Microsoft 365 admin on approval workflows
5. Start with a small pilot group before scaling

Graph Data Connect bridges the gap between Microsoft 365's rich data and enterprise analytics platforms. It's a powerful tool when you need insights across your organization.

## Resources

- [Graph Data Connect Documentation](https://docs.microsoft.com/en-us/graph/data-connect-concept-overview)
- [Azure Data Factory Office 365 Connector](https://docs.microsoft.com/en-us/azure/data-factory/connector-office-365)
- [Data Privacy and Compliance](https://docs.microsoft.com/en-us/graph/data-connect-policies)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
