---
title: "Data Wrangling in Microsoft Fabric: Practical Techniques"
description: "Data wrangling — getting messy, inconsistent, real-world data into a reliable clean form — is where most data engineering hours actually go. In Fabric…"
author: Michael John Peña
draft: false
date: 2023-07-10
tags:
  - Microsoft Fabric
  - Data Wrangling
  - PySpark
  - Data Engineering
---

Data wrangling — getting messy, inconsistent, real-world data into a reliable clean form — is where most data engineering hours actually go. In Fabric, PySpark inside a notebook is the primary tool for this at scale, and the Delta table's schema enforcement is the mechanism that makes quality gates stick. The patterns I reach for most often: `dropDuplicates()` with a key column list for idempotent deduplication, `fillna()` with different strategies by column type, regex-based column validation with `regexp_extract`, and conditional logic with `when().otherwise()` for classification rules. The `display()` function makes it practical to inspect data at each transformation step without leaving the notebook — sample, check, transform, sample again. I'll walk through a realistic wrangling pipeline today using a messy CSV dataset.

## Setting Up Our Data

```python
# Create sample messy data to work with
from pyspark.sql.types import *
from pyspark.sql.functions import *

# Simulating real-world messy data
messy_data = [
    (1, "  John Smith  ", "john@email.com", "2023-07-01", "100.50", "NY"),
    (2, "Jane DOE", "jane@email", "07/02/2023", "200", "California"),
    (3, "Bob", None, "2023-07-03", "$150.00", "TX"),
    (4, "Alice Johnson", "alice@email.com", "invalid", "abc", "new york"),
    (5, None, "noname@email.com", "2023-07-05", "175.25", "NY"),
    (5, None, "noname@email.com", "2023-07-05", "175.25", "NY"),  # Duplicate
    (6, "Charlie Brown", "charlie@email.com", "2023-07-06", "-50", "FL"),
]

schema = StructType([
    StructField("id", IntegerType()),
    StructField("name", StringType()),
    StructField("email", StringType()),
    StructField("date", StringType()),
    StructField("amount", StringType()),
    StructField("state", StringType()),
])

df = spark.createDataFrame(messy_data, schema)
df.show(truncate=False)
```

## Handling Missing Values

```python
# Check for nulls
print("Null counts by column:")
df.select([count(when(col(c).isNull(), c)).alias(c) for c in df.columns]).show()

# Drop rows with any null
df_no_nulls = df.dropna()

# Drop rows with null in specific columns
df_partial = df.dropna(subset=["name", "email"])

# Fill nulls with default values
df_filled = df.fillna({
    "name": "Unknown",
    "email": "noemail@placeholder.com",
    "amount": "0"
})

# Fill with column statistics
from pyspark.sql.functions import mean

# For numeric columns, fill with mean
# First convert to numeric
df_numeric = df.withColumn("amount_num", regexp_replace(col("amount"), r"[^0-9.-]", "").cast("double"))
avg_amount = df_numeric.select(mean("amount_num")).first()[0]
df_numeric = df_numeric.fillna({"amount_num": avg_amount})
```

## Removing Duplicates

```python
# Remove exact duplicates
df_deduped = df.dropDuplicates()
print(f"Original: {df.count()}, Deduped: {df_deduped.count()}")

# Remove duplicates based on specific columns
df_deduped_key = df.dropDuplicates(["id"])

# Keep first/last occurrence with window function
from pyspark.sql.window import Window

window = Window.partitionBy("id").orderBy(col("date").desc())

df_with_rank = df.withColumn("rank", row_number().over(window))
df_latest = df_with_rank.filter(col("rank") == 1).drop("rank")
```

## String Cleaning

```python
# Trim whitespace
df_trimmed = df.withColumn("name", trim(col("name")))

# Standardize case
df_cased = df.withColumn("name", initcap(col("name"))) \
             .withColumn("state", upper(col("state")))

# Remove special characters
df_cleaned = df.withColumn(
    "amount",
    regexp_replace(col("amount"), r"[^0-9.-]", "")
)

# Extract patterns
df_extracted = df.withColumn(
    "email_domain",
    regexp_extract(col("email"), r"@(.+)", 1)
)

# Replace patterns
state_mapping = {
    "NY": "New York",
    "TX": "Texas",
    "FL": "Florida",
    "new york": "New York",
    "California": "California"
}

# Using when/otherwise for mapping
df_mapped = df.withColumn(
    "state_full",
    when(upper(col("state")) == "NY", "New York")
    .when(upper(col("state")) == "TX", "Texas")
    .when(upper(col("state")) == "FL", "Florida")
    .otherwise(initcap(col("state")))
)
```

## Date Parsing and Standardization

```python
# Handle multiple date formats
from pyspark.sql.functions import to_date, coalesce

df_dates = df.withColumn(
    "parsed_date",
    coalesce(
        to_date(col("date"), "yyyy-MM-dd"),
        to_date(col("date"), "MM/dd/yyyy"),
        to_date(col("date"), "dd-MM-yyyy")
    )
)

# Flag invalid dates
df_dates = df_dates.withColumn(
    "date_valid",
    col("parsed_date").isNotNull()
)

# Extract date components
df_dates = df_dates.withColumn("year", year(col("parsed_date"))) \
                   .withColumn("month", month(col("parsed_date"))) \
                   .withColumn("day", dayofmonth(col("parsed_date"))) \
                   .withColumn("day_of_week", dayofweek(col("parsed_date")))
```

## Type Conversion and Validation

```python
# Safe type conversion
df_typed = df.withColumn(
    "amount_numeric",
    regexp_replace(col("amount"), r"[^0-9.-]", "").cast("double")
)

# Validate numeric ranges
df_validated = df_typed.withColumn(
    "amount_valid",
    (col("amount_numeric").isNotNull()) &
    (col("amount_numeric") >= 0) &
    (col("amount_numeric") <= 10000)
)

# Custom validation with UDF
from pyspark.sql.functions import udf
from pyspark.sql.types import BooleanType
import re

@udf(returnType=BooleanType())
def validate_email(email):
    if email is None:
        return False
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))

df_validated = df.withColumn("email_valid", validate_email(col("email")))
```

## Complete Data Wrangling Pipeline

```python
def wrangle_customer_data(df):
    """
    Complete data wrangling pipeline for customer data.
    """
    from pyspark.sql.functions import *

    # Step 1: Remove duplicates
    df = df.dropDuplicates(["id"])

    # Step 2: Clean strings
    df = df.withColumn("name", trim(initcap(col("name")))) \
           .withColumn("email", lower(trim(col("email")))) \
           .withColumn("state", upper(trim(col("state"))))

    # Step 3: Handle missing values
    df = df.withColumn(
        "name",
        when(col("name").isNull() | (col("name") == ""), "Unknown")
        .otherwise(col("name"))
    )

    # Step 4: Parse dates
    df = df.withColumn(
        "date_parsed",
        coalesce(
            to_date(col("date"), "yyyy-MM-dd"),
            to_date(col("date"), "MM/dd/yyyy")
        )
    )

    # Step 5: Clean and convert amounts
    df = df.withColumn(
        "amount_clean",
        regexp_replace(col("amount"), r"[^0-9.-]", "").cast("double")
    ).withColumn(
        "amount_clean",
        when(col("amount_clean") < 0, 0).otherwise(col("amount_clean"))
    )

    # Step 6: Standardize state codes
    state_mapping = create_map([
        lit("NY"), lit("New York"),
        lit("TX"), lit("Texas"),
        lit("FL"), lit("Florida"),
        lit("CA"), lit("California"),
        lit("CALIFORNIA"), lit("California"),
        lit("NEW YORK"), lit("New York")
    ])

    df = df.withColumn(
        "state_standardized",
        coalesce(state_mapping[upper(col("state"))], initcap(col("state")))
    )

    # Step 7: Add data quality flags
    df = df.withColumn(
        "is_valid",
        (col("name") != "Unknown") &
        col("date_parsed").isNotNull() &
        col("amount_clean").isNotNull() &
        (col("amount_clean") > 0)
    )

    # Step 8: Select final columns
    return df.select(
        "id",
        "name",
        "email",
        col("date_parsed").alias("date"),
        col("amount_clean").alias("amount"),
        col("state_standardized").alias("state"),
        "is_valid"
    )

# Apply the pipeline
clean_df = wrangle_customer_data(df)
clean_df.show(truncate=False)
```

## Data Quality Report

```python
def generate_quality_report(df, name="Dataset"):
    """Generate a data quality report."""
    print(f"\n{'='*50}")
    print(f"Data Quality Report: {name}")
    print(f"{'='*50}")

    # Basic stats
    print(f"\nTotal rows: {df.count()}")
    print(f"Total columns: {len(df.columns)}")

    # Null analysis
    print("\nNull counts:")
    null_counts = df.select([
        count(when(col(c).isNull(), c)).alias(c)
        for c in df.columns
    ]).collect()[0]

    for c in df.columns:
        null_count = null_counts[c]
        null_pct = (null_count / df.count()) * 100
        print(f"  {c}: {null_count} ({null_pct:.1f}%)")

    # Duplicate analysis
    dup_count = df.count() - df.dropDuplicates().count()
    print(f"\nDuplicate rows: {dup_count}")

    # Numeric column stats
    numeric_cols = [f.name for f in df.schema.fields
                    if isinstance(f.dataType, (IntegerType, DoubleType, LongType))]
    if numeric_cols:
        print("\nNumeric column statistics:")
        df.select(numeric_cols).describe().show()

    return df

# Generate report
generate_quality_report(df, "Customer Data")
```

## Saving Wrangled Data

```python
# Save clean data to Delta table
clean_df.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("customers_clean")

# Save rejected/invalid records for review
invalid_df = clean_df.filter(~col("is_valid"))
invalid_df.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("customers_rejected")

print(f"Valid records: {clean_df.filter(col('is_valid')).count()}")
print(f"Invalid records: {invalid_df.count()}")
```

Tomorrow we'll explore Fabric Data Factory and its data integration capabilities.

## Resources

- [PySpark Functions](https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/functions.html)
- [Data Wrangling Best Practices](https://learn.microsoft.com/en-us/fabric/data-engineering/data-transformation)
- [Spark SQL Guide](https://spark.apache.org/docs/latest/sql-programming-guide.html)
