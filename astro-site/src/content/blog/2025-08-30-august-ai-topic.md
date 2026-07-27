---
title: "AI-Powered Data Exploration with Microsoft Fabric Copilot"
author: Michael John Peña
draft: false
date: 2025-08-30
tags:
  - Microsoft Fabric
  - Copilot
  - Data Analysis
  - Natural Language
  - Power BI

---

I wrote "AI-Powered Data Exploration with Microsoft Fabric Copilot" to share practical, production-minded guidance on this topic.

## Copilot in Notebooks

Ask questions about your data in natural language and get executable code.

```python
# Example prompt to Copilot: "Load the sales data and show me monthly trends"
# Copilot generates:

import pandas as pd
import matplotlib.pyplot as plt

# Load data from Lakehouse
df = spark.table("gold.sales_summary").toPandas()

# Calculate monthly trends
monthly_sales = df.groupby(pd.to_datetime(df['date']).dt.to_period('M'))['amount'].sum()

# Visualize
plt.figure(figsize=(12, 6))
monthly_sales.plot(kind='line', marker='o')
plt.title('Monthly Sales Trends')
plt.xlabel('Month')
plt.ylabel('Total Sales')
plt.xticks(rotation=45)
plt.tight_layout()
plt.show()
```

## Copilot for SQL Queries

Generate complex SQL from natural language descriptions.

```sql
-- Prompt: "Find customers who increased spending by more than 50% this quarter vs last quarter"
-- Copilot generates:

WITH quarterly_spending AS (
    SELECT
        customer_id,
        DATEPART(quarter, order_date) as quarter,
        DATEPART(year, order_date) as year,
        SUM(amount) as total_spend
    FROM silver.orders
    WHERE order_date >= DATEADD(month, -6, GETDATE())
    GROUP BY customer_id, DATEPART(quarter, order_date), DATEPART(year, order_date)
),
comparison AS (
    SELECT
        curr.customer_id,
        curr.total_spend as current_quarter,
        prev.total_spend as previous_quarter,
        (curr.total_spend - prev.total_spend) / prev.total_spend * 100 as growth_pct
    FROM quarterly_spending curr
    JOIN quarterly_spending prev
        ON curr.customer_id = prev.customer_id
        AND curr.quarter = prev.quarter + 1
)
SELECT * FROM comparison WHERE growth_pct > 50 ORDER BY growth_pct DESC;
```

## Copilot in Power BI

Create visuals by describing what you want to see. Copilot suggests appropriate chart types, handles formatting, and can explain the insights in the data.

## Best Practices

Be specific in your prompts. Review generated code before executing. Use Copilot to learn new techniques, then refine based on your domain knowledge. Copilot accelerates exploration but doesn't replace understanding your data.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
