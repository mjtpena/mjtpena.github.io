---
title: "File Compaction Strategies in Delta Lake"
author: Michael John Peña
draft: false
date: 2024-08-16
tags:
  - Delta Lake
  - Microsoft Fabric
  - File Compaction
  - Performance
  - Data Engineering
---

## The Small File Problem

```
Before Compaction:
┌──────────────────────────────────────────────────────────────┐
│                    Delta Table                                │
│  ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐     │
│  │1MB ││2MB ││500K││1MB ││3MB ││800K││1MB ││2MB ││500K│...  │
│  └────┘└────┘└────┘└────┘└────┘└────┘└────┘└────┘└────┘     │
│                     1000+ small files                        │
│                     Query: Read 1000 files                   │
│                     Time: Very slow                          │
└──────────────────────────────────────────────────────────────┘

After Compaction:
┌──────────────────────────────────────────────────────────────┐
│                    Delta Table                                │
│  ┌──────────────┐┌──────────────┐┌──────────────┐            │
│  │    128MB     ││    128MB     ││     95MB     │            │
│  └──────────────┘└──────────────┘└──────────────┘            │
│                     3 optimized files                        │
│                     Query: Read 3 files                      │
│                     Time: Fast                               │
└──────────────────────────────────────────────────────────────┘
```

## Basic Compaction with OPTIMIZE

### Simple Compaction

```python
from delta.tables import DeltaTable

# Basic compaction
delta_table = DeltaTable.forPath(spark, "Tables/sales")
delta_table.optimize().executeCompaction()

# Or via SQL
spark.sql("OPTIMIZE sales")

# Check results
detail = spark.sql("DESCRIBE DETAIL sales").first()
print(f"Files after compaction: {detail.numFiles}")
```

### Compaction with Z-Order

```python
# Compact and Z-Order for better data skipping
delta_table.optimize().executeZOrderBy("order_date", "region")

# SQL equivalent
spark.sql("""
    OPTIMIZE sales
    ZORDER BY (order_date, region)
""")
```

## Compaction Strategies

### Strategy 1: Scheduled Compaction

```python
from datetime import datetime, timedelta

class ScheduledCompactor:
    """Schedule compaction based on data patterns."""

    def __init__(self, spark):
        self.spark = spark
        self.compaction_log = []

    def needs_compaction(self, table_path: str, threshold_files: int = 100) -> bool:
        """Check if table needs compaction."""

        detail = self.spark.sql(f"DESCRIBE DETAIL delta.`{table_path}`").first()
        return detail.numFiles > threshold_files

    def get_file_stats(self, table_path: str) -> dict:
        """Get file statistics for compaction decision."""

        detail = self.spark.sql(f"DESCRIBE DETAIL delta.`{table_path}`").first()

        # Estimate average file size
        avg_file_size = detail.sizeInBytes / detail.numFiles if detail.numFiles > 0 else 0

        return {
            "num_files": detail.numFiles,
            "total_size_bytes": detail.sizeInBytes,
            "avg_file_size_mb": avg_file_size / (1024 * 1024),
            "needs_compaction": avg_file_size < 64 * 1024 * 1024  # < 64MB
        }

    def compact_if_needed(
        self,
        table_path: str,
        min_files: int = 50,
        zorder_columns: list[str] = None
    ):
        """Conditionally compact based on file count."""

        stats = self.get_file_stats(table_path)

        if stats["num_files"] >= min_files or stats["needs_compaction"]:
            delta_table = DeltaTable.forPath(self.spark, table_path)

            if zorder_columns:
                delta_table.optimize().executeZOrderBy(*zorder_columns)
            else:
                delta_table.optimize().executeCompaction()

            self.compaction_log.append({
                "table": table_path,
                "timestamp": datetime.utcnow().isoformat(),
                "files_before": stats["num_files"],
                "action": "compacted"
            })

            return True

        return False

    def compact_all_tables(self, tables_config: list[dict]):
        """Compact multiple tables based on configuration."""

        for config in tables_config:
            compacted = self.compact_if_needed(
                table_path=config["path"],
                min_files=config.get("min_files", 50),
                zorder_columns=config.get("zorder_columns")
            )

            status = "compacted" if compacted else "skipped"
            print(f"{config['path']}: {status}")

# Usage
compactor = ScheduledCompactor(spark)

# Define tables to manage
tables = [
    {
        "path": "Tables/sales",
        "min_files": 100,
        "zorder_columns": ["order_date", "region"]
    },
    {
        "path": "Tables/customers",
        "min_files": 50,
        "zorder_columns": ["customer_id"]
    },
    {
        "path": "Tables/events",
        "min_files": 200  # High-volume table
    }
]

# Run compaction
compactor.compact_all_tables(tables)
```

### Strategy 2: Partition-Aware Compaction

```python
class PartitionCompactor:
    """Compact specific partitions instead of entire table."""

    def __init__(self, spark):
        self.spark = spark

    def get_partition_stats(self, table_path: str, partition_column: str) -> list:
        """Get file stats per partition."""

        # Read partition information
        partitions = self.spark.sql(f"""
            SELECT
                {partition_column},
                COUNT(*) as file_count,
                SUM(size) as total_size
            FROM (
                SELECT
                    input_file_name() as file_path,
                    {partition_column},
                    1 as size
                FROM delta.`{table_path}`
            )
            GROUP BY {partition_column}
            HAVING COUNT(*) > 10
            ORDER BY file_count DESC
        """)

        return partitions.collect()

    def compact_partition(
        self,
        table_path: str,
        partition_filter: str,
        zorder_columns: list[str] = None
    ):
        """Compact specific partition."""

        delta_table = DeltaTable.forPath(self.spark, table_path)

        if zorder_columns:
            delta_table.optimize() \
                .where(partition_filter) \
                .executeZOrderBy(*zorder_columns)
        else:
            delta_table.optimize() \
                .where(partition_filter) \
                .executeCompaction()

    def compact_recent_partitions(
        self,
        table_path: str,
        partition_column: str,
        days_back: int = 7
    ):
        """Compact partitions from recent days."""

        from datetime import date, timedelta

        for i in range(days_back):
            partition_date = date.today() - timedelta(days=i)
            partition_filter = f"{partition_column} = '{partition_date}'"

            print(f"Compacting partition: {partition_filter}")
            self.compact_partition(table_path, partition_filter)

    def compact_hot_partitions(
        self,
        table_path: str,
        partition_column: str,
        file_threshold: int = 50
    ):
        """Compact only partitions with many small files."""

        # This requires analyzing file distribution
        # Simplified approach: compact recent partitions
        partition_filter = f"{partition_column} >= date_sub(current_date(), 7)"

        delta_table = DeltaTable.forPath(self.spark, table_path)
        delta_table.optimize().where(partition_filter).executeCompaction()

# Usage
compactor = PartitionCompactor(spark)

# Compact only recent partitions
compactor.compact_recent_partitions(
    table_path="Tables/events",
    partition_column="event_date",
    days_back=7
)

# Compact specific partition
compactor.compact_partition(
    table_path="Tables/sales",
    partition_filter="order_date = '2024-08-01'",
    zorder_columns=["customer_id"]
)
```

### Strategy 3: Auto-Compaction

```python
# Enable auto-compaction on table
spark.sql("""
    ALTER TABLE sales
    SET TBLPROPERTIES (
        'delta.autoOptimize.autoCompact' = 'true',
        'delta.autoOptimize.optimizeWrite' = 'true'
    )
""")

# Configure auto-compact thresholds
auto_compact_config = {
    # Minimum number of files before auto-compact triggers
    "spark.databricks.delta.autoCompact.minNumFiles": "50",

    # Target file size for compaction
    "spark.databricks.delta.autoCompact.maxFileSize": "134217728",  # 128MB

    # Enable for all tables in session
    "spark.databricks.delta.properties.defaults.autoOptimize.autoCompact": "true"
}

for key, value in auto_compact_config.items():
    spark.conf.set(key, value)
```

## Optimized Write

### Enable Optimized Write

```python
# Optimized write bins data into optimal file sizes during write
# Prevents small files from being created in the first place

# Enable globally
spark.conf.set("spark.databricks.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.databricks.delta.optimizeWrite.binSize", "134217728")  # 128MB

# Enable per-table
spark.sql("""
    ALTER TABLE sales
    SET TBLPROPERTIES ('delta.autoOptimize.optimizeWrite' = 'true')
""")

# Write with optimized settings
df.write.format("delta") \
    .option("optimizeWrite", "true") \
    .mode("append") \
    .saveAsTable("sales")
```

### Adaptive Shuffle for Better File Distribution

```python
# Enable adaptive query execution for better file sizes
spark.conf.set("spark.sql.adaptive.enabled", "true")
spark.conf.set("spark.sql.adaptive.coalescePartitions.enabled", "true")
spark.conf.set("spark.sql.adaptive.advisoryPartitionSizeInBytes", "134217728")
```

## Vacuum Old Files

### Cleaning Up After Compaction

```python
class TableMaintenance:
    """Full table maintenance including compaction and vacuum."""

    def __init__(self, spark):
        self.spark = spark

    def full_maintenance(
        self,
        table_path: str,
        zorder_columns: list[str] = None,
        vacuum_hours: int = 168
    ):
        """Run full maintenance routine."""

        print(f"Starting maintenance for {table_path}")

        # Step 1: Get current state
        before = self.spark.sql(f"DESCRIBE DETAIL delta.`{table_path}`").first()
        print(f"Before: {before.numFiles} files, {before.sizeInBytes/(1024**3):.2f}GB")

        # Step 2: Compact
        print("Running compaction...")
        delta_table = DeltaTable.forPath(self.spark, table_path)

        if zorder_columns:
            delta_table.optimize().executeZOrderBy(*zorder_columns)
        else:
            delta_table.optimize().executeCompaction()

        # Step 3: Vacuum old files
        print(f"Vacuuming files older than {vacuum_hours} hours...")
        delta_table.vacuum(vacuum_hours)

        # Step 4: Get final state
        after = self.spark.sql(f"DESCRIBE DETAIL delta.`{table_path}`").first()
        print(f"After: {after.numFiles} files, {after.sizeInBytes/(1024**3):.2f}GB")

        return {
            "files_before": before.numFiles,
            "files_after": after.numFiles,
            "files_reduced": before.numFiles - after.numFiles,
            "size_change_gb": (after.sizeInBytes - before.sizeInBytes) / (1024**3)
        }

    def maintenance_all_tables(self, tables: list[str]):
        """Run maintenance on all tables."""

        results = {}
        for table in tables:
            results[table] = self.full_maintenance(table)

        return results

# Usage
maintenance = TableMaintenance(spark)

# Run full maintenance
result = maintenance.full_maintenance(
    table_path="Tables/sales",
    zorder_columns=["order_date", "region"],
    vacuum_hours=168  # 7 days
)

print(f"Reduced files from {result['files_before']} to {result['files_after']}")
```

## Monitoring Compaction Needs

### Compaction Dashboard Query

```sql
-- Query to identify tables needing compaction
WITH table_stats AS (
    SELECT
        'sales' as table_name,
        (SELECT COUNT(*) FROM sales) as row_count,
        (SELECT numFiles FROM (DESCRIBE DETAIL sales)) as file_count,
        (SELECT sizeInBytes FROM (DESCRIBE DETAIL sales)) as size_bytes
    UNION ALL
    SELECT
        'customers' as table_name,
        (SELECT COUNT(*) FROM customers) as row_count,
        (SELECT numFiles FROM (DESCRIBE DETAIL customers)) as file_count,
        (SELECT sizeInBytes FROM (DESCRIBE DETAIL customers)) as size_bytes
)
SELECT
    table_name,
    row_count,
    file_count,
    size_bytes / (1024*1024*1024) as size_gb,
    size_bytes / file_count / (1024*1024) as avg_file_size_mb,
    CASE
        WHEN size_bytes / file_count < 64*1024*1024 THEN 'COMPACT NOW'
        WHEN size_bytes / file_count < 128*1024*1024 THEN 'CONSIDER COMPACTION'
        ELSE 'OK'
    END as recommendation
FROM table_stats
ORDER BY avg_file_size_mb;
```

### Python Monitoring

```python
class CompactionMonitor:
    """Monitor tables for compaction needs."""

    def __init__(self, spark):
        self.spark = spark

    def analyze_all_tables(self, table_paths: list[str]) -> list[dict]:
        """Analyze all tables and return status."""

        results = []

        for path in table_paths:
            try:
                detail = self.spark.sql(f"DESCRIBE DETAIL delta.`{path}`").first()

                avg_size_mb = (detail.sizeInBytes / detail.numFiles) / (1024 * 1024)

                results.append({
                    "table": path,
                    "files": detail.numFiles,
                    "size_gb": detail.sizeInBytes / (1024**3),
                    "avg_file_mb": avg_size_mb,
                    "needs_compaction": avg_size_mb < 64 or detail.numFiles > 500,
                    "priority": self._calculate_priority(detail.numFiles, avg_size_mb)
                })
            except Exception as e:
                results.append({
                    "table": path,
                    "error": str(e)
                })

        return sorted(results, key=lambda x: x.get("priority", 0), reverse=True)

    def _calculate_priority(self, file_count: int, avg_size_mb: float) -> int:
        """Calculate compaction priority (higher = more urgent)."""

        priority = 0

        if file_count > 1000:
            priority += 50
        elif file_count > 500:
            priority += 30
        elif file_count > 100:
            priority += 10

        if avg_size_mb < 16:
            priority += 50
        elif avg_size_mb < 32:
            priority += 30
        elif avg_size_mb < 64:
            priority += 10

        return priority

    def generate_report(self, table_paths: list[str]) -> str:
        """Generate compaction status report."""

        results = self.analyze_all_tables(table_paths)

        report = "# Compaction Status Report\n\n"
        report += f"Generated: {datetime.utcnow().isoformat()}\n\n"

        for result in results:
            if "error" in result:
                report += f"- {result['table']}: ERROR - {result['error']}\n"
            else:
                status = "NEEDS COMPACTION" if result["needs_compaction"] else "OK"
                report += f"- {result['table']}: {status}\n"
                report += f"  Files: {result['files']}, Avg Size: {result['avg_file_mb']:.1f}MB\n"

        return report

# Usage
monitor = CompactionMonitor(spark)

tables = ["Tables/sales", "Tables/customers", "Tables/events"]
report = monitor.generate_report(tables)
print(report)
```

## Best Practices

1. **Schedule regular compaction**: Daily for high-volume tables
2. **Use partition-aware compaction**: Avoid rewriting entire large tables
3. **Enable auto-compaction**: For streaming or frequent write tables
4. **Set vacuum retention**: Balance storage vs. time travel needs
5. **Monitor file statistics**: Track avg file size over time

## Conclusion

File compaction is essential for maintaining Delta Lake performance. Combine scheduled compaction with auto-compact features to keep your tables optimized. Monitor file statistics regularly and adjust thresholds based on your query patterns.

The goal is files between 128-256MB for optimal query performance in Microsoft Fabric and other analytics engines.
