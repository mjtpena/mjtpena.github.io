---
title: "Getting Started with Microsoft Fabric: A Practical Guide"
description: "I've been onboarding several clients onto Fabric over the past few weeks and the first hour is always the same: getting oriented to an interface that's…"
author: Michael John Peña
draft: false
date: 2023-07-02
tags:
  - Microsoft Fabric
  - Azure
  - Data Engineering
  - Tutorial
---

I've been onboarding several clients onto Fabric over the past few weeks and the first hour is always the same: getting oriented to an interface that's genuinely new. Fabric isn't Azure — it doesn't live in the Azure portal. It's at app.fabric.microsoft.com, and if you're used to Synapse Analytics or the classic Power BI Service, the mental model shift takes a session or two. The starting point is almost always the trial: navigate to app.fabric.microsoft.com, your admin enables Fabric in the Microsoft 365 admin centre, and you activate the 60-day trial capacity from within the Fabric UI. From there, the first item to create is a workspace bound to that trial capacity. Everything else — Lakehouses, Notebooks, Warehouses, Pipelines — lives inside workspaces, and getting that structure right on day one saves reorganisation later.

## Prerequisites

Before starting, you'll need:
- A Microsoft Entra ID (Azure AD) account
- Either:
  - A Power BI Premium capacity (P1 or higher)
  - A Fabric capacity (F2 or higher)
  - Or a Fabric trial

## Step 1: Enable Fabric for Your Tenant

If you're a tenant admin:

```
1. Go to app.powerbi.com
2. Settings (gear icon) > Admin portal
3. Tenant settings > Microsoft Fabric
4. Enable "Users can create Fabric items"
5. Save changes
```

For non-admins, you can request a trial:

```
1. Go to app.fabric.microsoft.com
2. Click your profile icon
3. Select "Start trial"
4. Accept the terms
```

The trial provides 64 capacity units for 60 days - enough for serious evaluation.

## Step 2: Create a Fabric-Enabled Workspace

```python
# Workspace creation steps:
# 1. Click "Workspaces" in the left nav
# 2. Click "New workspace"
# 3. Configure:

workspace_config = {
    "name": "data-engineering-sandbox",
    "description": "Sandbox for Fabric exploration",
    "license_mode": "Trial",  # or "Premium capacity" if available
    "contact_list": ["your-email@company.com"],
    "onelake_files_default": True  # Enable OneLake files
}

# 4. Click "Apply"
```

Important: Make sure you select a Fabric-enabled capacity. Without it, you won't see Fabric items.

## Step 3: Create Your First Lakehouse

The Lakehouse is the foundation of most Fabric data architectures:

```python
# In your workspace:
# 1. Click "+ New" > "Lakehouse"
# 2. Name it (e.g., "sales_lakehouse")
# 3. Click "Create"

# You now have:
# - A Delta Lake storage location
# - An automatic SQL endpoint
# - OneLake integration
```

## Step 4: Upload Some Data

Let's get some data into your Lakehouse:

```python
# Option 1: Direct file upload (for small files)
# In Lakehouse view:
# - Click "Get data" > "Upload files"
# - Select a CSV or Parquet file

# Option 2: Using a notebook (preferred for real work)
# Create a new notebook and run:

# Create sample data
data = [
    (1, "Product A", 100.00, "2023-07-01"),
    (2, "Product B", 150.00, "2023-07-01"),
    (3, "Product C", 200.00, "2023-07-01"),
]

columns = ["product_id", "product_name", "price", "date"]

# Create DataFrame
df = spark.createDataFrame(data, columns)

# Write to Lakehouse Tables folder
df.write.format("delta").mode("overwrite").saveAsTable("products")
```

## Step 5: Query with SQL

Once data is in a table, you can query it via the SQL endpoint:

```sql
-- Switch to SQL endpoint view in your Lakehouse
-- Or go to the warehouse item

SELECT
    product_name,
    price,
    date
FROM products
WHERE price > 100
ORDER BY price DESC;
```

## Step 6: Create a Notebook for Data Engineering

Notebooks are where you'll do most data engineering work:

```python
# Create a new notebook
# Attach it to your Lakehouse

# Read from the Files section
raw_df = spark.read.format("csv") \
    .option("header", "true") \
    .option("inferSchema", "true") \
    .load("Files/raw/sales.csv")

# Transform
from pyspark.sql.functions import col, upper, current_timestamp

transformed_df = raw_df \
    .withColumn("product_name", upper(col("product_name"))) \
    .withColumn("processed_at", current_timestamp())

# Write to Tables (managed Delta table)
transformed_df.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("sales_processed")

print("Data processed successfully!")
```

## Step 7: Schedule Your Notebook

To run notebooks on a schedule:

```python
# 1. In the notebook, click "Schedule" in the toolbar
# 2. Configure:
schedule_config = {
    "enabled": True,
    "frequency": "Daily",
    "time": "06:00 UTC",
    "retry_policy": {
        "count": 2,
        "interval_seconds": 60
    }
}
# 3. Save the schedule
```

## Verification Checklist

Confirm your setup is working:

```python
# Run this in a notebook to verify your environment

def verify_fabric_setup():
    checks = []

    # Check 1: Spark is running
    try:
        spark.version
        checks.append(("Spark runtime", "OK"))
    except:
        checks.append(("Spark runtime", "FAILED"))

    # Check 2: Can access OneLake
    try:
        dbutils.fs.ls("Files/")
        checks.append(("OneLake Files access", "OK"))
    except:
        checks.append(("OneLake Files access", "FAILED"))

    # Check 3: Can create Delta tables
    try:
        spark.sql("CREATE TABLE IF NOT EXISTS test_table (id INT)")
        spark.sql("DROP TABLE test_table")
        checks.append(("Delta table creation", "OK"))
    except:
        checks.append(("Delta table creation", "FAILED"))

    # Print results
    print("Fabric Setup Verification")
    print("=" * 40)
    for check, status in checks:
        emoji = "+" if status == "OK" else "-"
        print(f"[{emoji}] {check}: {status}")

    return all(status == "OK" for _, status in checks)

verify_fabric_setup()
```

## Common Issues and Solutions

**Issue: "Fabric items not showing"**
- Solution: Ensure workspace is on Fabric/Premium capacity

**Issue: "Notebook won't start"**
- Solution: Check capacity is not paused; starter pools take 30-60 seconds

**Issue: "Can't see Tables in SQL endpoint"**
- Solution: Tables must be in the `Tables` folder, not `Files`

## Next Steps

Now that you have Fabric set up:
1. Explore the different item types
2. Try loading real data
3. Build a simple pipeline
4. Connect Power BI

Tomorrow we'll look at the Fabric trial experience in detail - what you get and how to make the most of it.

## Resources

- [Fabric Getting Started Guide](https://learn.microsoft.com/en-us/fabric/get-started/fabric-home)
- [Create a Workspace](https://learn.microsoft.com/en-us/fabric/get-started/create-workspaces)
- [Lakehouse Tutorial](https://learn.microsoft.com/en-us/fabric/data-engineering/tutorial-lakehouse-get-started)
