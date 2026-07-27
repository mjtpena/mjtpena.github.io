---
title: "Microsoft Fabric Copilot Now Available for All Paid SKUs"
author: Michael John Peña
draft: false
date: 2025-03-10
tags:
  - Microsoft Fabric
  - Copilot
  - AI
  - Data Engineering
  - Power BI

---

I wrote "Microsoft Fabric Copilot Now Available for All Paid SKUs" to share practical, production-minded guidance on this topic.

## What Changed

**Before (until March 2025):**
- Copilot required F64 capacity (~$8,400/month)
- Smaller organizations priced out of AI features
- Development teams couldn't experiment without significant investment

**Now (April 30, 2025 onwards):**
- Copilot available from F2 capacity (~$262/month)
- AI Functions available in notebooks
- Data Agents accessible in preview
- Same AI capabilities, smaller scale

## What You Get

### Copilot in Power BI

Natural language report creation:

```
User: "Create a report showing sales by region with year-over-year comparison"

Copilot generates:
- Regional sales card visuals
- YoY comparison measures
- Appropriate filters and slicers
- Executive summary narrative
```

This works on F2 and above now. For small businesses, this transforms how reports are built.

### Copilot in Data Engineering

Ask questions, get Spark code:

```python
# In a Fabric notebook, prompt Copilot:
# "Load the customer data, remove duplicates by email, and add a customer_tier column based on total_purchases"

# Copilot generates:
from pyspark.sql.functions import col, when, row_number
from pyspark.sql.window import Window

df = spark.table("lakehouse.customers")

# Remove duplicates keeping most recent
window = Window.partitionBy("email").orderBy(col("created_date").desc())
df = df.withColumn("rn", row_number().over(window)) \
       .filter(col("rn") == 1) \
       .drop("rn")

# Add customer tier
df = df.withColumn("customer_tier",
    when(col("total_purchases") >= 10000, "platinum")
    .when(col("total_purchases") >= 5000, "gold")
    .when(col("total_purchases") >= 1000, "silver")
    .otherwise("bronze"))

df.write.mode("overwrite").saveAsTable("lakehouse.customers_tiered")
```

### Copilot in Data Factory

Natural language to pipeline:

```
User: "Create a pipeline that copies data from our SQL Server to the lakehouse daily, incrementally based on the modified_date column"

Copilot creates:
- Copy activity with incremental query
- Watermark tracking
- Schedule trigger
- Error handling
```

### AI Functions

Use LLMs directly in your data transformations:

```python
from pyspark.sql.functions import ai

# Classify customer feedback
df = df.withColumn(
    "sentiment",
    ai.analyze_sentiment(col("feedback_text"))
)

# Summarize long descriptions
df = df.withColumn(
    "summary",
    ai.summarize(col("product_description"), max_words=50)
)

# Extract entities
df = df.withColumn(
    "entities",
    ai.extract_entities(col("support_ticket"))
)
```

These AI functions consume Fabric capacity like any other compute, making them accessible to all paid tiers.

## Cost Considerations

AI features consume capacity. On smaller SKUs, you'll need to manage this carefully:

```python
# Monitor AI function costs
from fabric_admin import CapacityClient

client = CapacityClient()
usage = client.get_ai_usage_metrics(
    workspace_id="...",
    timeframe="last_24h"
)

print(f"AI tokens consumed: {usage['tokens_used']}")
print(f"Estimated cost: ${usage['estimated_cost']:.2f}")
```

**Tips for smaller capacities:**
1. Use AI functions on aggregated data, not raw rows
2. Cache AI results when possible
3. Schedule AI-heavy workloads during off-peak hours
4. Use smaller models when GPT-4 isn't necessary

## Data Agents Preview

Data Agents - AI assistants that understand your enterprise data - are now in preview for all paid SKUs:

```python
# Create a data agent
from fabric.agents import DataAgent

agent = DataAgent(
    name="SalesAnalyst",
    description="Answers questions about sales data",
    data_sources=[
        "lakehouse.fact_sales",
        "lakehouse.dim_customer",
        "lakehouse.dim_product"
    ]
)

# Users can ask natural language questions
result = agent.ask("What were our top 10 products by revenue last quarter?")
# Agent generates SQL, executes query, formats response
```

This is still preview, but the path to conversational analytics is clear.

## Migration Path

If you've been waiting for Copilot to become accessible:

1. **Start Small**: Begin with Copilot in Power BI for report creation
2. **Validate Quality**: AI-generated code needs review
3. **Educate Users**: Train teams on effective prompting
4. **Monitor Usage**: Track capacity consumption
5. **Scale Up**: Move to larger SKUs when value is proven

## Real-World Impact

For our clients on smaller budgets, this changes the calculus:

**Before:** "Fabric is interesting but Copilot is only for enterprises."

**After:** "We can start with F4 for development, use Copilot to accelerate building, and scale when we go to production."

The barrier to entry for AI-assisted analytics dropped significantly.

## What's Still F64+

Some capabilities still require higher SKUs:
- Real-time AI inference at scale
- Multi-agent orchestration
- Custom model fine-tuning

For most analytics use cases, though, F2-F16 with Copilot is sufficient.

## My Recommendations

1. **Enable Copilot** on your existing capacity
2. **Start with Power BI** - lowest risk, highest visibility
3. **Experiment in notebooks** - let developers explore AI functions
4. **Build validation habits** - AI generates code, humans verify
5. **Track ROI** - measure time saved vs capacity consumed

The democratization of AI in analytics is accelerating. Microsoft Fabric Copilot for all paid SKUs is a significant step toward AI-augmented data work becoming standard practice.

## Resources

- [Fabric Copilot SKU Announcement](https://blog.fabric.microsoft.com/en/blog/copilot-and-ai-capabilities-now-accessible-to-all-paid-skus-in-microsoft-fabric/)
- [Copilot in Fabric Documentation](https://learn.microsoft.com/en-us/fabric/fundamentals/copilot-fabric-overview)
- [AI Functions Reference](https://learn.microsoft.com/en-us/fabric/data-engineering/ai-functions)
- [Fabric Capacity Planning](https://learn.microsoft.com/en-us/fabric/enterprise/capacity-planning)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
