---
title: "SQL Database in Microsoft Fabric: Deep Dive"
author: "Michael John Peña"
draft: false
date: 2024-10-23
tags: ["SQL Database", "Microsoft Fabric", "Azure", "T-SQL", "Database"]

---

I wrote "SQL Database in Microsoft Fabric: Deep Dive" to share practical, production-minded guidance on this topic.

## SQL Database Architecture in Fabric

```python
"""
SQL Database in Fabric Architecture:
+------------------+
|  Applications    |
+------------------+
         |
         v
+------------------+
| TDS Endpoint     |  <- T-SQL Queries
+------------------+
         |
         v
+------------------+
| SQL Engine       |  <- Full SQL Server Engine
| (Azure SQL)      |
+------------------+
         |
    Automatic
    Mirroring
         |
         v
+------------------+
| OneLake          |  <- Delta Format
| (Parquet)        |
+------------------+
"""
```

## T-SQL Feature Support

```sql
-- Full T-SQL support with some Fabric-specific considerations

-- Standard DDL
CREATE SCHEMA sales;

CREATE TABLE sales.products (
    product_id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    category NVARCHAR(100),
    price DECIMAL(10, 2) NOT NULL,
    stock_quantity INT DEFAULT 0,
    created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 DEFAULT SYSUTCDATETIME(),

    -- Indexes
    INDEX IX_products_category NONCLUSTERED (category),

    -- Check constraints
    CONSTRAINT CHK_price_positive CHECK (price > 0),
    CONSTRAINT CHK_stock_nonnegative CHECK (stock_quantity >= 0)
);

-- Computed columns
ALTER TABLE sales.products ADD
    is_in_stock AS (CASE WHEN stock_quantity > 0 THEN 1 ELSE 0 END);

-- Triggers (supported)
CREATE TRIGGER trg_products_update
ON sales.products
AFTER UPDATE
AS
BEGIN
    UPDATE sales.products
    SET updated_at = SYSUTCDATETIME()
    FROM sales.products p
    INNER JOIN inserted i ON p.product_id = i.product_id;
END;

-- Stored procedures
CREATE PROCEDURE sales.usp_UpdateStock
    @product_id INT,
    @quantity_change INT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE sales.products
    SET stock_quantity = stock_quantity + @quantity_change
    WHERE product_id = @product_id;

    SELECT
        product_id,
        name,
        stock_quantity as new_stock
    FROM sales.products
    WHERE product_id = @product_id;
END;

-- User-defined functions
CREATE FUNCTION sales.fn_GetDiscountedPrice(
    @price DECIMAL(10, 2),
    @discount_percent DECIMAL(5, 2)
)
RETURNS DECIMAL(10, 2)
AS
BEGIN
    RETURN @price * (1 - @discount_percent / 100);
END;

-- Views
CREATE VIEW sales.vw_LowStockProducts AS
SELECT
    product_id,
    name,
    category,
    stock_quantity
FROM sales.products
WHERE stock_quantity < 10;
```

## Transactional Operations

```python
import pyodbc
from contextlib import contextmanager

class TransactionalOperations:
    """Handle transactions in Fabric SQL Database"""

    def __init__(self, connection_string: str):
        self.conn_str = connection_string

    @contextmanager
    def transaction(self):
        """Context manager for transactions"""
        conn = pyodbc.connect(self.conn_str)
        conn.autocommit = False

        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise
        finally:
            conn.close()

    def transfer_inventory(self, from_product_id: int,
                          to_product_id: int, quantity: int) -> bool:
        """Transfer inventory between products atomically"""

        with self.transaction() as conn:
            cursor = conn.cursor()

            # Check source has enough stock
            cursor.execute("""
                SELECT stock_quantity
                FROM sales.products WITH (UPDLOCK, ROWLOCK)
                WHERE product_id = ?
            """, (from_product_id,))

            row = cursor.fetchone()
            if not row or row[0] < quantity:
                raise ValueError("Insufficient stock")

            # Deduct from source
            cursor.execute("""
                UPDATE sales.products
                SET stock_quantity = stock_quantity - ?
                WHERE product_id = ?
            """, (quantity, from_product_id))

            # Add to destination
            cursor.execute("""
                UPDATE sales.products
                SET stock_quantity = stock_quantity + ?
                WHERE product_id = ?
            """, (quantity, to_product_id))

            return True

    def process_order(self, order_items: list) -> int:
        """Process an order with multiple items"""

        with self.transaction() as conn:
            cursor = conn.cursor()

            # Create order
            cursor.execute("""
                INSERT INTO sales.orders (customer_id, status)
                OUTPUT INSERTED.order_id
                VALUES (?, 'pending')
            """, (order_items[0]['customer_id'],))

            order_id = cursor.fetchone()[0]

            # Add order items and update stock
            for item in order_items:
                # Check and lock stock
                cursor.execute("""
                    SELECT stock_quantity
                    FROM sales.products WITH (UPDLOCK, ROWLOCK)
                    WHERE product_id = ?
                """, (item['product_id'],))

                stock = cursor.fetchone()[0]
                if stock < item['quantity']:
                    raise ValueError(f"Insufficient stock for product {item['product_id']}")

                # Add order item
                cursor.execute("""
                    INSERT INTO sales.order_items
                    (order_id, product_id, quantity, unit_price)
                    VALUES (?, ?, ?, ?)
                """, (order_id, item['product_id'],
                      item['quantity'], item['unit_price']))

                # Update stock
                cursor.execute("""
                    UPDATE sales.products
                    SET stock_quantity = stock_quantity - ?
                    WHERE product_id = ?
                """, (item['quantity'], item['product_id']))

            # Update order total
            cursor.execute("""
                UPDATE sales.orders
                SET total_amount = (
                    SELECT SUM(quantity * unit_price)
                    FROM sales.order_items
                    WHERE order_id = ?
                ),
                status = 'confirmed'
                WHERE order_id = ?
            """, (order_id, order_id))

            return order_id
```

## Querying Mirrored Data

```sql
-- Fabric SQL Database automatically mirrors to OneLake
-- Query operational data directly
SELECT TOP 100
    p.name,
    p.category,
    SUM(oi.quantity) as total_sold,
    SUM(oi.quantity * oi.unit_price) as revenue
FROM sales.products p
JOIN sales.order_items oi ON p.product_id = oi.product_id
JOIN sales.orders o ON oi.order_id = o.order_id
WHERE o.order_date >= DATEADD(month, -1, GETUTCDATE())
GROUP BY p.name, p.category
ORDER BY revenue DESC;

-- For heavy analytical queries, use the mirrored data in Lakehouse
-- This offloads analytics from the operational database
```

## Change Data Capture

```sql
-- Enable CDC for tracking changes
EXEC sys.sp_cdc_enable_db;

-- Enable CDC on specific tables
EXEC sys.sp_cdc_enable_table
    @source_schema = N'sales',
    @source_name = N'products',
    @role_name = NULL,
    @supports_net_changes = 1;

-- Query changes
DECLARE @from_lsn binary(10), @to_lsn binary(10);
SET @from_lsn = sys.fn_cdc_get_min_lsn('sales_products');
SET @to_lsn = sys.fn_cdc_get_max_lsn();

SELECT *
FROM cdc.fn_cdc_get_all_changes_sales_products(
    @from_lsn, @to_lsn, 'all'
);

-- CDC changes are also reflected in OneLake mirroring
```

## Integration with Fabric Analytics

```python
# Combine SQL Database with Fabric Analytics
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

# Read mirrored data from OneLake
products_df = spark.read.format("delta").load(
    "abfss://workspace@onelake.dfs.fabric.microsoft.com/"
    "SalesDB.Database/Tables/sales/products"
)

orders_df = spark.read.format("delta").load(
    "abfss://workspace@onelake.dfs.fabric.microsoft.com/"
    "SalesDB.Database/Tables/sales/orders"
)

# Perform analytical queries that would be expensive in OLTP
sales_analysis = orders_df.join(
    products_df,
    orders_df.product_id == products_df.product_id
).groupBy(
    "category",
    spark.sql("date_trunc('month', order_date)").alias("month")
).agg(
    spark.sql("sum(quantity)").alias("units_sold"),
    spark.sql("sum(quantity * unit_price)").alias("revenue"),
    spark.sql("count(distinct customer_id)").alias("unique_customers")
)

# Write insights back to Lakehouse (not to operational DB)
sales_analysis.write.format("delta").mode("overwrite").saveAsTable(
    "analytics.monthly_sales_summary"
)
```

## Security and Access Control

```sql
-- Row-level security
CREATE FUNCTION sales.fn_SecurityPredicate(@region NVARCHAR(50))
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS result
WHERE @region = USER_NAME()
   OR IS_MEMBER('sales_admin') = 1;

CREATE SECURITY POLICY sales.RegionPolicy
ADD FILTER PREDICATE sales.fn_SecurityPredicate(region)
    ON sales.orders;

-- Column-level encryption
-- Sensitive data can be encrypted using Always Encrypted
-- This works with Fabric's integrated security model

-- Roles and permissions
CREATE ROLE sales_reader;
GRANT SELECT ON SCHEMA::sales TO sales_reader;

CREATE ROLE sales_writer;
GRANT SELECT, INSERT, UPDATE ON SCHEMA::sales TO sales_writer;

-- Add users to roles
ALTER ROLE sales_reader ADD MEMBER [user@domain.com];
```

SQL Database in Fabric brings enterprise-grade transactional capabilities to the unified data platform, with seamless integration to analytical workloads through automatic mirroring.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
