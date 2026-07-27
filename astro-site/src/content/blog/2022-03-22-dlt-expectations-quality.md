---
title: "Data Quality with Delta Live Tables Expectations"
author: Michael John Peña
draft: false
date: 2022-03-22
tags:
  - Azure
  - Databricks
  - Delta Live Tables
  - Data Quality
  - Data Engineering

---

I wrote "Data Quality with Delta Live Tables Expectations" to share practical, production-minded guidance on this topic.

## Understanding Expectations

Expectations are data quality rules expressed as SQL boolean expressions:

```python
import dlt

# Basic expectation syntax
@dlt.table
@dlt.expect("constraint_name", "sql_boolean_expression")
def my_table():
    return source_data
```

The expression must evaluate to `true` for valid records.

## Types of Expectations

### Expect (Warn)

Log violations but keep all records:

```python
@dlt.table
@dlt.expect("valid_email", "email RLIKE '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'")
@dlt.expect("valid_age", "age BETWEEN 0 AND 150")
def customers_all():
    return dlt.read_stream("raw_customers")

# Use when:
# - You want visibility into data issues
# - Downstream processes can handle invalid data
# - You're in development/discovery phase
```

### Expect or Drop

Remove records that fail validation:

```python
@dlt.table
@dlt.expect_or_drop("positive_amount", "amount > 0")
@dlt.expect_or_drop("valid_date", "order_date IS NOT NULL")
@dlt.expect_or_drop("known_customer", "customer_id IS NOT NULL")
def orders_clean():
    return dlt.read_stream("raw_orders")

# Use when:
# - Invalid records should not propagate
# - You have a quarantine process for dropped records
# - Data quality is critical for downstream analytics
```

### Expect or Fail

Stop the pipeline on any violation:

```python
@dlt.table
@dlt.expect_or_fail("schema_valid", "id IS NOT NULL AND timestamp IS NOT NULL")
@dlt.expect_or_fail("no_duplicates", "row_count = 1")  # With appropriate windowing
def critical_events():
    return dlt.read_stream("raw_events")

# Use when:
# - Data issues require immediate human intervention
# - Regulatory requirements demand data integrity
# - Downstream systems cannot handle any invalid data
```

## Combining Multiple Expectations

```python
# Multiple individual expectations
@dlt.table
@dlt.expect("rule1", "condition1")
@dlt.expect("rule2", "condition2")
@dlt.expect_or_drop("rule3", "condition3")
def combined_rules():
    return source

# Expect all (all rules use same behavior)
@dlt.table
@dlt.expect_all({
    "valid_id": "id IS NOT NULL",
    "valid_amount": "amount > 0",
    "valid_date": "date <= current_date()"
})
def with_expect_all():
    return source

# Expect all or drop
@dlt.table
@dlt.expect_all_or_drop({
    "required_fields": "customer_id IS NOT NULL AND product_id IS NOT NULL",
    "valid_quantity": "quantity > 0 AND quantity < 10000",
    "valid_price": "unit_price > 0"
})
def orders_strict():
    return dlt.read_stream("raw_orders")

# Expect all or fail
@dlt.table
@dlt.expect_all_or_fail({
    "pk_not_null": "id IS NOT NULL",
    "timestamp_valid": "event_time IS NOT NULL"
})
def critical_table():
    return source
```

## Complex Validation Rules

### Referential Integrity

```python
# Create a reference table
@dlt.table
def valid_products():
    return spark.table("production.master.products").select("product_id")

# Validate foreign key
@dlt.table
def orders_with_valid_products():
    products = dlt.read("valid_products")
    orders = dlt.read_stream("raw_orders")

    return (
        orders
        .join(products, "product_id", "left")
        .withColumn("has_valid_product", col("product_id").isNotNull())
    )

@dlt.table
@dlt.expect_or_drop("valid_product_ref", "has_valid_product")
def orders_validated():
    return dlt.read_stream("orders_with_valid_products")
```

### Statistical Validations

```python
@dlt.table
def orders_with_stats():
    orders = dlt.read_stream("raw_orders")

    # Calculate rolling statistics
    stats = (
        orders
        .groupBy("product_id")
        .agg(
            F.avg("amount").alias("avg_amount"),
            F.stddev("amount").alias("stddev_amount")
        )
    )

    return (
        orders
        .join(stats, "product_id")
        .withColumn("z_score",
            (col("amount") - col("avg_amount")) / col("stddev_amount")
        )
    )

@dlt.table
@dlt.expect_or_drop("not_outlier", "abs(z_score) < 3")
def orders_no_outliers():
    return dlt.read_stream("orders_with_stats")
```

### Cross-Field Validations

```python
@dlt.table
@dlt.expect_or_drop("valid_date_range", "end_date >= start_date")
@dlt.expect_or_drop("consistent_totals", "abs(quantity * unit_price - total_amount) < 0.01")
@dlt.expect_or_drop("valid_discount", "discount_percent BETWEEN 0 AND 100")
def invoices_validated():
    return dlt.read_stream("raw_invoices")
```

## Quarantine Pattern

Capture dropped records for analysis:

```python
# Source data
@dlt.view
def raw_orders_view():
    return spark.readStream.table("bronze.raw_orders")

# Add validation flags
@dlt.view
def orders_with_validation():
    return (
        dlt.read_stream("raw_orders_view")
        .withColumn("is_valid_amount", col("amount") > 0)
        .withColumn("is_valid_customer", col("customer_id").isNotNull())
        .withColumn("is_valid_date", col("order_date").isNotNull())
        .withColumn("is_valid",
            col("is_valid_amount") &
            col("is_valid_customer") &
            col("is_valid_date")
        )
    )

# Valid records
@dlt.table(
    comment="Valid orders that passed all quality checks"
)
@dlt.expect_or_drop("all_valid", "is_valid")
def silver_orders():
    return (
        dlt.read_stream("orders_with_validation")
        .drop("is_valid_amount", "is_valid_customer", "is_valid_date", "is_valid")
    )

# Quarantine invalid records
@dlt.table(
    comment="Orders that failed quality checks - for investigation"
)
def quarantine_orders():
    return (
        dlt.read_stream("orders_with_validation")
        .filter("NOT is_valid")
        .withColumn("quarantine_reason",
            F.concat_ws(", ",
                F.when(~col("is_valid_amount"), F.lit("invalid_amount")),
                F.when(~col("is_valid_customer"), F.lit("missing_customer")),
                F.when(~col("is_valid_date"), F.lit("missing_date"))
            )
        )
        .withColumn("quarantine_timestamp", F.current_timestamp())
    )
```

## Monitoring Data Quality

### Query Quality Metrics

```python
# DLT automatically logs quality metrics to system tables
quality_metrics = spark.sql("""
    SELECT
        date(timestamp) as date,
        flow_name,
        expectation_name,
        passed_records,
        failed_records,
        failed_records / (passed_records + failed_records) as failure_rate
    FROM system.live_tables.data_quality_log
    WHERE pipeline_id = 'your-pipeline-id'
    ORDER BY timestamp DESC
""")

display(quality_metrics)
```

### Quality Dashboard

```python
# Create quality summary view
@dlt.table
def data_quality_summary():
    return spark.sql("""
        SELECT
            flow_name as table_name,
            expectation_name as quality_rule,
            SUM(passed_records) as total_passed,
            SUM(failed_records) as total_failed,
            SUM(failed_records) / SUM(passed_records + failed_records) as overall_failure_rate,
            MAX(timestamp) as last_updated
        FROM system.live_tables.data_quality_log
        WHERE pipeline_id = 'your-pipeline-id'
        GROUP BY flow_name, expectation_name
    """)
```

### Alerting on Quality Issues

```python
def check_quality_thresholds():
    """Alert when quality drops below threshold"""

    thresholds = {
        "silver_orders": 0.01,  # Max 1% failure rate
        "silver_customers": 0.005  # Max 0.5% failure rate
    }

    alerts = []

    for table, threshold in thresholds.items():
        failure_rate = spark.sql(f"""
            SELECT
                failed_records / (passed_records + failed_records) as rate
            FROM system.live_tables.data_quality_log
            WHERE flow_name = '{table}'
            AND timestamp > current_timestamp() - INTERVAL 1 HOUR
            ORDER BY timestamp DESC
            LIMIT 1
        """).first()["rate"]

        if failure_rate > threshold:
            alerts.append({
                "table": table,
                "failure_rate": failure_rate,
                "threshold": threshold
            })

    if alerts:
        send_alert(alerts)

    return alerts
```

## Advanced Patterns

### Dynamic Expectations

```python
# Load rules from configuration
def get_quality_rules(table_name):
    return spark.table("config.quality_rules").filter(
        f"table_name = '{table_name}'"
    ).collect()

# Apply rules dynamically (in notebook parameters)
# Note: DLT decorators require static definitions,
# so dynamic rules are applied within the function
@dlt.table
def dynamically_validated():
    df = dlt.read_stream("source")

    rules = get_quality_rules("orders")
    for rule in rules:
        df = df.withColumn(
            f"valid_{rule['rule_name']}",
            F.expr(rule['condition'])
        )

    # Filter based on validation columns
    validation_cols = [c for c in df.columns if c.startswith("valid_")]
    df = df.withColumn("all_valid", F.reduce(validation_cols, F.lit(True), lambda a, b: a & b))

    return df.filter("all_valid")
```

### Versioned Quality Rules

```python
# Track rule changes over time
@dlt.table
def quality_rule_history():
    return spark.sql("""
        SELECT
            rule_id,
            rule_name,
            condition,
            effective_from,
            effective_to,
            version
        FROM config.quality_rules_history
        WHERE current_date() BETWEEN effective_from AND COALESCE(effective_to, '9999-12-31')
    """)
```

## Best Practices

1. **Start with warnings**: Use `@dlt.expect` during development to understand data quality issues
2. **Graduate to drops**: Move to `@dlt.expect_or_drop` once rules are validated
3. **Fail selectively**: Use `@dlt.expect_or_fail` only for critical business rules
4. **Always quarantine**: Capture dropped records for root cause analysis
5. **Monitor continuously**: Set up alerts for quality degradation
6. **Document rules**: Use descriptive constraint names that explain the business logic

## Conclusion

DLT expectations transform data quality from an afterthought to a first-class concern:
- Declarative syntax makes rules easy to understand
- Automatic enforcement prevents bad data propagation
- Built-in metrics enable quality monitoring
- Multiple enforcement levels provide flexibility

By embedding quality rules directly in your pipeline definitions, you ensure data quality is maintained consistently across all processing runs.

## Resources

- [DLT Expectations Documentation](https://docs.databricks.com/delta-live-tables/expectations.html)
- [Data Quality Best Practices](https://docs.databricks.com/delta-live-tables/data-quality.html)
- [System Tables for Monitoring](https://docs.databricks.com/delta-live-tables/system-tables.html)

