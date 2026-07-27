---
title: "Data Governance in Azure Databricks: Policies, Practices, and Implementation"
author: Michael John Peña
draft: false
date: 2022-03-11
tags:
  - Azure
  - Databricks
  - Data Governance
  - Compliance
  - Security

---

I wrote "Data Governance in Azure Databricks: Policies, Practices, and Implementation" to share practical, production-minded guidance on this topic.

## Governance Framework

A complete governance framework addresses:
- **Access Control**: Who can access what data
- **Data Quality**: Ensuring data accuracy and completeness
- **Data Lineage**: Understanding data origins and transformations
- **Compliance**: Meeting regulatory requirements
- **Data Lifecycle**: Managing data from creation to deletion

## Implementing Data Classifications

Create a classification system for your data:

```sql
-- Create a classification metadata schema
CREATE SCHEMA IF NOT EXISTS governance.classifications;

-- Classification lookup table
CREATE TABLE governance.classifications.data_classes (
    class_id STRING,
    class_name STRING,
    description STRING,
    retention_days INT,
    encryption_required BOOLEAN,
    pii_flag BOOLEAN,
    access_level STRING
);

INSERT INTO governance.classifications.data_classes VALUES
('PUBLIC', 'Public', 'Non-sensitive, publicly shareable', 365, FALSE, FALSE, 'open'),
('INTERNAL', 'Internal', 'Internal business data', 1825, FALSE, FALSE, 'authenticated'),
('CONFIDENTIAL', 'Confidential', 'Sensitive business data', 2555, TRUE, FALSE, 'restricted'),
('PII', 'Personal Data', 'Personally identifiable information', 2555, TRUE, TRUE, 'highly_restricted'),
('RESTRICTED', 'Restricted', 'Highly sensitive, regulated data', 3650, TRUE, TRUE, 'need_to_know');

-- Apply classifications via table properties
ALTER TABLE production.sales.customers
SET TBLPROPERTIES (
    'data_classification' = 'PII',
    'data_owner' = 'customer-data-team@company.com',
    'retention_policy' = '7years',
    'gdpr_relevant' = 'true'
);
```

## Data Quality Framework

Implement quality checks with expectations:

```python
from pyspark.sql.functions import col, count, when, isnan, isnull

class DataQualityChecker:
    def __init__(self, spark):
        self.spark = spark
        self.results = []

    def check_nulls(self, df, column, threshold=0.0):
        """Check null percentage against threshold"""
        total = df.count()
        null_count = df.filter(col(column).isNull()).count()
        null_pct = null_count / total if total > 0 else 0

        result = {
            "check": "null_check",
            "column": column,
            "null_count": null_count,
            "null_percentage": null_pct,
            "threshold": threshold,
            "passed": null_pct <= threshold
        }
        self.results.append(result)
        return result["passed"]

    def check_uniqueness(self, df, columns):
        """Check for duplicate values"""
        total = df.count()
        unique = df.select(columns).distinct().count()
        duplicate_count = total - unique

        result = {
            "check": "uniqueness_check",
            "columns": columns,
            "total_rows": total,
            "unique_rows": unique,
            "duplicate_count": duplicate_count,
            "passed": duplicate_count == 0
        }
        self.results.append(result)
        return result["passed"]

    def check_range(self, df, column, min_val=None, max_val=None):
        """Check values are within expected range"""
        out_of_range = 0

        if min_val is not None:
            out_of_range += df.filter(col(column) < min_val).count()
        if max_val is not None:
            out_of_range += df.filter(col(column) > max_val).count()

        result = {
            "check": "range_check",
            "column": column,
            "min": min_val,
            "max": max_val,
            "out_of_range_count": out_of_range,
            "passed": out_of_range == 0
        }
        self.results.append(result)
        return result["passed"]

    def check_referential_integrity(self, df, column, reference_df, reference_column):
        """Check foreign key relationships"""
        reference_values = reference_df.select(reference_column).distinct()
        orphaned = df.join(
            reference_values,
            df[column] == reference_values[reference_column],
            "left_anti"
        ).count()

        result = {
            "check": "referential_integrity",
            "column": column,
            "orphaned_records": orphaned,
            "passed": orphaned == 0
        }
        self.results.append(result)
        return result["passed"]

    def generate_report(self):
        """Generate quality report"""
        passed = sum(1 for r in self.results if r["passed"])
        failed = len(self.results) - passed

        return {
            "total_checks": len(self.results),
            "passed": passed,
            "failed": failed,
            "pass_rate": passed / len(self.results) if self.results else 0,
            "details": self.results
        }

# Usage
checker = DataQualityChecker(spark)
df = spark.table("production.sales.transactions")

checker.check_nulls(df, "customer_id", threshold=0.01)
checker.check_uniqueness(df, ["transaction_id"])
checker.check_range(df, "amount", min_val=0, max_val=1000000)

report = checker.generate_report()
print(f"Quality Score: {report['pass_rate']:.2%}")
```

## Data Lineage Tracking

Capture lineage for all transformations:

```python
import json
from datetime import datetime

class LineageTracker:
    def __init__(self, spark):
        self.spark = spark
        self.lineage_table = "governance.lineage.data_lineage"

    def track_transformation(self, source_tables, target_table, transformation_type, notebook_path=None):
        """Record a data transformation"""
        lineage_record = {
            "lineage_id": str(uuid.uuid4()),
            "source_tables": source_tables,
            "target_table": target_table,
            "transformation_type": transformation_type,
            "notebook_path": notebook_path or dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get(),
            "executed_by": spark.sql("SELECT current_user()").collect()[0][0],
            "execution_time": datetime.utcnow().isoformat(),
            "cluster_id": spark.conf.get("spark.databricks.clusterUsageTags.clusterId", "unknown")
        }

        # Store lineage
        df = self.spark.createDataFrame([lineage_record])
        df.write.mode("append").saveAsTable(self.lineage_table)

        return lineage_record

    def get_upstream_lineage(self, table_name, depth=5):
        """Get all upstream dependencies"""
        query = f"""
        WITH RECURSIVE lineage AS (
            SELECT source_tables, target_table, 1 as depth
            FROM {self.lineage_table}
            WHERE target_table = '{table_name}'

            UNION ALL

            SELECT l2.source_tables, l2.target_table, l.depth + 1
            FROM {self.lineage_table} l2
            INNER JOIN lineage l ON ARRAY_CONTAINS(l.source_tables, l2.target_table)
            WHERE l.depth < {depth}
        )
        SELECT DISTINCT * FROM lineage
        """
        return self.spark.sql(query)

# Usage with automatic tracking
tracker = LineageTracker(spark)

# Before transformation
source_tables = ["production.sales.orders", "production.sales.customers"]
target_table = "production.analytics.customer_orders"

# Perform transformation
df = spark.sql("""
    SELECT o.*, c.customer_name, c.segment
    FROM production.sales.orders o
    JOIN production.sales.customers c ON o.customer_id = c.customer_id
""")
df.write.mode("overwrite").saveAsTable(target_table)

# Track lineage
tracker.track_transformation(source_tables, target_table, "join")
```

## Access Control Policies

Implement role-based access control:

```sql
-- Create roles (groups in Azure AD)
-- These are managed in Azure AD, referenced here for documentation

-- Data Steward role: Full governance access
GRANT ALL PRIVILEGES ON CATALOG governance TO `data-stewards@company.com`;

-- Data Engineer role: Create and modify tables in production
GRANT USAGE ON CATALOG production TO `data-engineers@company.com`;
GRANT CREATE TABLE, MODIFY ON SCHEMA production.sales TO `data-engineers@company.com`;

-- Data Analyst role: Read-only on curated data
GRANT USAGE ON CATALOG production TO `data-analysts@company.com`;
GRANT SELECT ON SCHEMA production.analytics TO `data-analysts@company.com`;

-- Data Scientist role: Full access to sandbox, read access to production
GRANT ALL PRIVILEGES ON CATALOG sandbox TO `data-scientists@company.com`;
GRANT SELECT ON CATALOG production TO `data-scientists@company.com`;
```

## Sensitive Data Handling

Implement data masking and encryption:

```python
from pyspark.sql.functions import sha2, concat, lit, when, regexp_replace

class DataMasker:
    @staticmethod
    def hash_column(df, column, salt=""):
        """One-way hash for pseudonymization"""
        return df.withColumn(
            column,
            sha2(concat(col(column), lit(salt)), 256)
        )

    @staticmethod
    def mask_email(df, column):
        """Partially mask email addresses"""
        return df.withColumn(
            column,
            regexp_replace(col(column), r"(?<=.{2}).(?=.*@)", "*")
        )

    @staticmethod
    def mask_phone(df, column):
        """Mask phone numbers showing last 4 digits"""
        return df.withColumn(
            column,
            regexp_replace(col(column), r"\d(?=\d{4})", "*")
        )

    @staticmethod
    def mask_credit_card(df, column):
        """Mask credit card showing last 4 digits"""
        return df.withColumn(
            column,
            regexp_replace(col(column), r"\d(?=\d{4})", "X")
        )

    @staticmethod
    def generalize_age(df, column):
        """Generalize age into buckets"""
        return df.withColumn(
            column,
            when(col(column) < 18, "Under 18")
            .when(col(column) < 25, "18-24")
            .when(col(column) < 35, "25-34")
            .when(col(column) < 45, "35-44")
            .when(col(column) < 55, "45-54")
            .when(col(column) < 65, "55-64")
            .otherwise("65+")
        )

# Create masked views for analysts
spark.sql("""
CREATE OR REPLACE VIEW production.analytics.customers_masked AS
SELECT
    customer_id,
    sha2(concat(email, 'salt'), 256) as email_hash,
    regexp_replace(phone, '\\d(?=\\d{4})', '*') as phone_masked,
    CASE
        WHEN age < 25 THEN '18-24'
        WHEN age < 35 THEN '25-34'
        WHEN age < 45 THEN '35-44'
        WHEN age < 55 THEN '45-54'
        ELSE '55+'
    END as age_group,
    city,
    state,
    country
FROM production.sales.customers
""")
```

## Compliance Monitoring

Track compliance requirements:

```python
class ComplianceMonitor:
    def __init__(self, spark):
        self.spark = spark

    def check_gdpr_compliance(self, table_name):
        """Check table for GDPR compliance"""
        issues = []

        # Get table properties
        props = spark.sql(f"DESCRIBE EXTENDED {table_name}").collect()
        props_dict = {row['col_name']: row['data_type'] for row in props}

        # Check for data classification
        if 'data_classification' not in str(props):
            issues.append("Missing data classification")

        # Check for data owner
        if 'data_owner' not in str(props):
            issues.append("Missing data owner")

        # Check for retention policy
        if 'retention_policy' not in str(props):
            issues.append("Missing retention policy")

        # Check for PII columns
        pii_columns = self.detect_pii_columns(table_name)
        if pii_columns:
            issues.append(f"Potential PII columns detected: {pii_columns}")

        return {
            "table": table_name,
            "compliant": len(issues) == 0,
            "issues": issues
        }

    def detect_pii_columns(self, table_name):
        """Detect potential PII columns by name patterns"""
        pii_patterns = [
            'email', 'phone', 'ssn', 'social_security', 'passport',
            'credit_card', 'address', 'birth', 'salary', 'password',
            'first_name', 'last_name', 'full_name', 'ip_address'
        ]

        columns = spark.table(table_name).columns
        return [c for c in columns if any(p in c.lower() for p in pii_patterns)]

    def generate_compliance_report(self, catalog):
        """Generate compliance report for all tables in a catalog"""
        tables = spark.sql(f"SHOW TABLES IN {catalog}").collect()
        report = []

        for table in tables:
            full_name = f"{catalog}.{table['database']}.{table['tableName']}"
            compliance = self.check_gdpr_compliance(full_name)
            report.append(compliance)

        return {
            "catalog": catalog,
            "total_tables": len(report),
            "compliant_tables": sum(1 for r in report if r['compliant']),
            "details": report
        }

# Generate weekly compliance report
monitor = ComplianceMonitor(spark)
report = monitor.generate_compliance_report("production")
```

## Data Retention

Implement automated retention policies:

```python
from delta.tables import DeltaTable
from datetime import datetime, timedelta

def apply_retention_policy(table_name, retention_days, date_column="created_at"):
    """Delete data older than retention period"""

    cutoff_date = datetime.now() - timedelta(days=retention_days)

    # For Delta tables, use DELETE
    spark.sql(f"""
        DELETE FROM {table_name}
        WHERE {date_column} < '{cutoff_date.strftime('%Y-%m-%d')}'
    """)

    # Run VACUUM to physically remove deleted files
    spark.sql(f"VACUUM {table_name} RETAIN 168 HOURS")

    # Log the retention operation
    log_retention_operation(table_name, retention_days, cutoff_date)

def automated_retention_job():
    """Run retention across all tables with policies"""

    # Get tables with retention policies
    tables_with_retention = spark.sql("""
        SELECT
            table_catalog || '.' || table_schema || '.' || table_name as full_name,
            CAST(retention_days as INT) as retention_days
        FROM system.information_schema.table_properties
        WHERE property_name = 'retention_days'
    """).collect()

    for row in tables_with_retention:
        try:
            apply_retention_policy(row['full_name'], row['retention_days'])
            print(f"Retention applied: {row['full_name']}")
        except Exception as e:
            print(f"Error applying retention to {row['full_name']}: {e}")
```

## Conclusion

Data governance in Azure Databricks is not a one-time setup but an ongoing practice. By implementing these technical controls and processes, you can:

- Ensure data is properly classified and protected
- Maintain data quality across your lakehouse
- Track data lineage for compliance and debugging
- Meet regulatory requirements like GDPR and CCPA
- Enable self-service analytics with appropriate guardrails

The key is to automate as much as possible while maintaining human oversight for critical decisions.

## Resources

- [Databricks Data Governance](https://docs.databricks.com/data-governance/index.html)
- [Unity Catalog Documentation](https://docs.databricks.com/data-governance/unity-catalog/index.html)
- [GDPR Compliance Guide](https://docs.databricks.com/security/privacy/gdpr-delta.html)

