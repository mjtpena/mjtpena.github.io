---
title: "Databricks Genie Spaces: Natural Language Data Exploration"
author: "Michael John Peña"
draft: false
date: 2024-04-19
tags: ["Databricks", "Genie", "AI", "Natural Language", "Analytics"]

---

I wrote "Databricks Genie Spaces: Natural Language Data Exploration" to share practical, production-minded guidance on this topic.

Genie Spaces enable non-technical users to explore data using natural language. This guide covers setting up and optimizing Genie Spaces for your organization.

## Understanding Genie Spaces

```python
GENIE_SPACE_CONCEPTS = {
    "space": {
        "definition": "A curated collection of tables with business context",
        "components": ["Tables", "Instructions", "Sample questions", "Permissions"]
    },
    "conversation": {
        "definition": "Multi-turn dialogue with Genie about data",
        "capabilities": ["Follow-up questions", "Drill-downs", "Comparisons"]
    },
    "instructions": {
        "definition": "Business context to help Genie understand your data",
        "includes": ["Terminology", "Calculations", "Relationships", "Constraints"]
    }
}
```

## Creating an Effective Genie Space

```python
# Configuration for a well-designed Genie Space

GENIE_SPACE_BEST_PRACTICES = {
    "name": "Customer Analytics Hub",
    "description": "Explore customer behavior, engagement, and lifetime value",

    # Table configuration
    "tables": {
        "fact_orders": {
            "catalog": "analytics",
            "schema": "ecommerce",
            "table": "fact_orders",
            "description": "Order transactions including revenue, items, and fulfillment details",
            "column_descriptions": {
                "order_id": "Unique identifier for each order",
                "customer_id": "Reference to the customer who placed the order",
                "order_date": "Date when the order was placed",
                "total_amount": "Total order value in USD",
                "status": "Current order status: pending, shipped, delivered, returned"
            }
        },
        "dim_customers": {
            "catalog": "analytics",
            "schema": "ecommerce",
            "table": "dim_customers",
            "description": "Customer master data including segments and acquisition info",
            "column_descriptions": {
                "customer_id": "Unique customer identifier",
                "segment": "Customer segment: Premium, Standard, Basic",
                "acquisition_channel": "How the customer was acquired",
                "first_order_date": "Date of customer's first purchase",
                "ltv": "Customer lifetime value in USD"
            }
        }
    },

    # Business instructions
    "instructions": """
    ## Business Context
    This space is for analyzing customer and order data for our e-commerce business.

    ## Key Metrics
    - **Revenue**: SUM(total_amount) from fact_orders
    - **AOV (Average Order Value)**: Revenue / COUNT(DISTINCT order_id)
    - **Customer Count**: COUNT(DISTINCT customer_id)
    - **Repeat Rate**: Customers with 2+ orders / Total customers

    ## Terminology
    - "sales" means revenue (total_amount)
    - "active customers" means customers with orders in the last 90 days
    - "new customers" means first_order_date in the current period
    - "churned" means no orders in the last 180 days

    ## Important Relationships
    - fact_orders.customer_id joins to dim_customers.customer_id
    - Always filter by order status = 'delivered' for revenue calculations
    - Exclude test orders (customer_id starting with 'TEST_')

    ## Time Conventions
    - Default to last 30 days when no time period specified
    - Compare to same period last year for YoY metrics
    """,

    # Sample questions
    "sample_questions": [
        "What was our revenue last month?",
        "How many new customers did we acquire this quarter?",
        "What's the average order value by customer segment?",
        "Which acquisition channel has the best LTV?",
        "Show me the revenue trend for the past 12 months",
        "Who are our top 10 customers by lifetime value?"
    ]
}
```

## Configuring Table Relationships

```python
# Define relationships for better query generation

TABLE_RELATIONSHIPS = {
    "relationships": [
        {
            "from_table": "fact_orders",
            "from_column": "customer_id",
            "to_table": "dim_customers",
            "to_column": "customer_id",
            "relationship_type": "many_to_one",
            "description": "Each order belongs to one customer"
        },
        {
            "from_table": "fact_orders",
            "from_column": "product_id",
            "to_table": "dim_products",
            "to_column": "product_id",
            "relationship_type": "many_to_one",
            "description": "Each order line references one product"
        }
    ],

    "hierarchies": [
        {
            "name": "time_hierarchy",
            "levels": ["year", "quarter", "month", "week", "day"]
        },
        {
            "name": "geography_hierarchy",
            "levels": ["country", "region", "state", "city"]
        },
        {
            "name": "product_hierarchy",
            "levels": ["category", "subcategory", "product"]
        }
    ]
}
```

## Optimizing Genie Responses

```python
# Instructions for improving Genie accuracy

OPTIMIZATION_INSTRUCTIONS = """
## Query Guidelines

### For Time-based Questions
- Always use the date dimension when available
- For "this month", use: WHERE date >= DATE_TRUNC('month', CURRENT_DATE)
- For "last month", use: WHERE date >= DATE_TRUNC('month', ADD_MONTHS(CURRENT_DATE, -1))
                         AND date < DATE_TRUNC('month', CURRENT_DATE)

### For Aggregations
- Revenue calculations should always exclude returns (status != 'returned')
- Customer counts should be DISTINCT
- Product metrics should be at the SKU level unless asked for categories

### For Comparisons
- YoY comparisons should use the same number of days
- MoM comparisons should account for month length differences
- Always show both values and the percentage change

### Visualization Hints
- Time series data: Use line charts
- Category comparisons: Use bar charts
- Proportions: Use pie or donut charts (max 5 categories)
- Distributions: Use histograms

### Common Clarifications
- If asked about "customers", ask whether they mean all-time or active
- If asked about "products", ask whether they mean SKUs or categories
- If asked about "growth", clarify absolute or percentage
"""
```

## Handling Complex Questions

```python
# Examples of handling complex analytical questions

COMPLEX_QUERY_EXAMPLES = {
    "cohort_analysis": {
        "question": "Show me retention by monthly acquisition cohort",
        "approach": """
        1. Identify cohort (first order month)
        2. Calculate subsequent month activity
        3. Compute retention rates
        """,
        "sql": """
        WITH cohorts AS (
            SELECT
                customer_id,
                DATE_TRUNC('month', MIN(order_date)) as cohort_month
            FROM fact_orders
            GROUP BY customer_id
        ),
        activity AS (
            SELECT
                c.cohort_month,
                DATEDIFF(month, c.cohort_month, DATE_TRUNC('month', o.order_date)) as month_number,
                COUNT(DISTINCT o.customer_id) as customers
            FROM fact_orders o
            JOIN cohorts c ON o.customer_id = c.customer_id
            GROUP BY 1, 2
        )
        SELECT
            cohort_month,
            month_number,
            customers,
            customers / FIRST_VALUE(customers) OVER (PARTITION BY cohort_month ORDER BY month_number) as retention_rate
        FROM activity
        ORDER BY cohort_month, month_number
        """
    },

    "rfm_segmentation": {
        "question": "Segment customers by RFM",
        "approach": """
        1. Calculate Recency, Frequency, Monetary
        2. Score each dimension (1-5)
        3. Combine into segments
        """,
        "sql": """
        WITH rfm AS (
            SELECT
                customer_id,
                DATEDIFF(day, MAX(order_date), CURRENT_DATE) as recency,
                COUNT(DISTINCT order_id) as frequency,
                SUM(total_amount) as monetary
            FROM fact_orders
            WHERE order_date >= DATE_SUB(CURRENT_DATE, 365)
            GROUP BY customer_id
        ),
        scored AS (
            SELECT
                *,
                NTILE(5) OVER (ORDER BY recency DESC) as r_score,
                NTILE(5) OVER (ORDER BY frequency) as f_score,
                NTILE(5) OVER (ORDER BY monetary) as m_score
            FROM rfm
        )
        SELECT
            customer_id,
            CONCAT(r_score, f_score, m_score) as rfm_segment,
            CASE
                WHEN r_score >= 4 AND f_score >= 4 THEN 'Champions'
                WHEN r_score >= 3 AND f_score >= 3 THEN 'Loyal'
                WHEN r_score >= 4 AND f_score <= 2 THEN 'New'
                WHEN r_score <= 2 AND f_score >= 3 THEN 'At Risk'
                ELSE 'Others'
            END as segment_name
        FROM scored
        """
    }
}
```

## Monitoring Genie Usage

```python
class GenieUsageAnalytics:
    """Track and analyze Genie space usage"""

    def __init__(self, workspace_client):
        self.client = workspace_client

    def get_usage_metrics(self, space_id: str, days: int = 30) -> dict:
        """Get usage metrics for a Genie space"""

        # Query Genie audit logs
        metrics = {
            "total_conversations": 0,
            "total_questions": 0,
            "unique_users": set(),
            "question_categories": {},
            "success_rate": 0,
            "common_questions": []
        }

        # Aggregate metrics from audit logs
        # (Implementation depends on audit log access)

        return metrics

    def identify_improvement_areas(self, space_id: str) -> list:
        """Identify areas where Genie could be improved"""

        improvements = []

        # Check for failed queries
        # Check for clarification requests
        # Check for low confidence responses

        return improvements

    def generate_report(self, space_id: str) -> str:
        """Generate usage report"""

        metrics = self.get_usage_metrics(space_id)

        report = f"""
        # Genie Space Usage Report

        ## Overview
        - Total Conversations: {metrics['total_conversations']}
        - Total Questions: {metrics['total_questions']}
        - Unique Users: {len(metrics['unique_users'])}
        - Success Rate: {metrics['success_rate']:.1%}

        ## Common Question Types
        {self._format_categories(metrics['question_categories'])}

        ## Recommendations
        {self._generate_recommendations(metrics)}
        """

        return report

    def _format_categories(self, categories: dict) -> str:
        return "\n".join(f"- {k}: {v}" for k, v in categories.items())

    def _generate_recommendations(self, metrics: dict) -> str:
        recs = []
        if metrics.get('success_rate', 0) < 0.8:
            recs.append("- Add more sample questions to instructions")
        return "\n".join(recs) if recs else "- Space performing well"
```

## Conclusion

Genie Spaces democratize data access by enabling natural language exploration. Invest in clear instructions, comprehensive column descriptions, and sample questions to maximize accuracy and user adoption.

