---
title: "Databricks AI/BI: Intelligent Analytics Platform"
author: "Michael John Peña"
draft: false
date: 2024-04-18
tags: ["Databricks", "AI", "BI", "Analytics", "Data"]

---

I wrote "Databricks AI/BI: Intelligent Analytics Platform" to share practical, production-minded guidance on this topic.

Databricks AI/BI combines the power of the lakehouse with AI-driven analytics. This guide explores how to leverage AI/BI for intelligent data analysis.

## AI/BI Components

```python
AI_BI_COMPONENTS = {
    "genie": {
        "description": "Natural language interface for data exploration",
        "capabilities": [
            "Conversational data queries",
            "Automatic SQL generation",
            "Context-aware responses",
            "Multi-turn conversations"
        ]
    },
    "dashboards": {
        "description": "AI-powered visualization and reporting",
        "capabilities": [
            "Auto-generated visualizations",
            "Smart formatting",
            "Natural language filters",
            "Embedded AI insights"
        ]
    },
    "ai_functions": {
        "description": "SQL functions powered by LLMs",
        "capabilities": [
            "Text analysis",
            "Classification",
            "Summarization",
            "Custom queries"
        ]
    }
}
```

## Setting Up a Genie Space

```python
# Genie Space configuration for a sales analytics use case

GENIE_SPACE_CONFIG = {
    "name": "Sales Analytics Genie",
    "description": "Natural language interface for sales data analysis",

    "tables": [
        {
            "catalog": "main",
            "schema": "sales",
            "table": "fact_sales",
            "description": "Sales transactions with amounts, dates, and dimensions"
        },
        {
            "catalog": "main",
            "schema": "sales",
            "table": "dim_customer",
            "description": "Customer information including segments and regions"
        },
        {
            "catalog": "main",
            "schema": "sales",
            "table": "dim_product",
            "description": "Product catalog with categories and pricing"
        }
    ],

    "instructions": """
    This Genie space is for analyzing sales performance.

    Key concepts:
    - Revenue = SUM(amount)
    - Units = SUM(quantity)
    - Average Order Value = Revenue / COUNT(DISTINCT order_id)

    When users ask about:
    - "sales" they usually mean revenue
    - "customers" refer to unique customer counts
    - "products" refer to product performance

    Always include appropriate filters for date ranges.
    """,

    "sample_questions": [
        "What were total sales last month?",
        "Show me the top 10 products by revenue",
        "How do sales compare across regions?",
        "Which customer segment is growing fastest?"
    ]
}
```

## Implementing AI-Enhanced Queries

```python
from databricks import sql
import json

class AIEnhancedQuery:
    """Execute AI-enhanced queries in Databricks"""

    def __init__(self, connection):
        self.connection = connection
        self.cursor = connection.cursor()

    def analyze_sentiment_batch(
        self,
        table: str,
        text_column: str,
        id_column: str,
        batch_size: int = 1000
    ) -> dict:
        """Analyze sentiment for text data"""

        query = f"""
        SELECT
            {id_column},
            {text_column},
            ai_analyze_sentiment({text_column}) as sentiment
        FROM {table}
        LIMIT {batch_size}
        """

        self.cursor.execute(query)
        results = self.cursor.fetchall()

        # Aggregate results
        sentiment_counts = {"positive": 0, "negative": 0, "neutral": 0}
        for row in results:
            sentiment = row[2].lower()
            if sentiment in sentiment_counts:
                sentiment_counts[sentiment] += 1

        return {
            "total_analyzed": len(results),
            "sentiment_distribution": sentiment_counts,
            "samples": results[:5]
        }

    def extract_entities(
        self,
        table: str,
        text_column: str,
        entity_types: list
    ) -> list:
        """Extract named entities from text"""

        entity_prompt = f"Extract these entity types: {', '.join(entity_types)}"

        query = f"""
        SELECT
            {text_column},
            ai_query(
                'databricks-meta-llama-3-70b-instruct',
                CONCAT('{entity_prompt}. Text: ', {text_column})
            ) as entities
        FROM {table}
        LIMIT 100
        """

        self.cursor.execute(query)
        return self.cursor.fetchall()

    def generate_summaries(
        self,
        table: str,
        text_column: str,
        group_column: str,
        max_length: int = 100
    ) -> dict:
        """Generate summaries grouped by category"""

        query = f"""
        SELECT
            {group_column},
            ai_summarize(
                CONCAT_WS(' ', COLLECT_LIST({text_column})),
                {max_length}
            ) as summary
        FROM {table}
        GROUP BY {group_column}
        """

        self.cursor.execute(query)
        results = self.cursor.fetchall()

        return {row[0]: row[1] for row in results}

    def classify_text(
        self,
        table: str,
        text_column: str,
        categories: list
    ) -> list:
        """Classify text into predefined categories"""

        categories_str = ", ".join(categories)

        query = f"""
        SELECT
            {text_column},
            ai_query(
                'databricks-meta-llama-3-70b-instruct',
                CONCAT(
                    'Classify this text into one of these categories: {categories_str}. ',
                    'Text: ', {text_column},
                    '. Return only the category name.'
                )
            ) as category
        FROM {table}
        LIMIT 500
        """

        self.cursor.execute(query)
        return self.cursor.fetchall()
```

## Building AI/BI Dashboards

```python
# Dashboard with AI-generated insights

AIBI_DASHBOARD_SPEC = {
    "name": "Sales Intelligence Dashboard",
    "pages": [
        {
            "name": "Executive Summary",
            "layout": "grid",
            "widgets": [
                {
                    "type": "kpi",
                    "position": {"row": 0, "col": 0, "width": 3, "height": 1},
                    "query": "SELECT SUM(revenue) as total_revenue FROM sales WHERE date >= DATE_SUB(CURRENT_DATE(), 30)",
                    "format": {"prefix": "$", "decimals": 0}
                },
                {
                    "type": "kpi",
                    "position": {"row": 0, "col": 3, "width": 3, "height": 1},
                    "query": "SELECT COUNT(DISTINCT customer_id) as active_customers FROM sales WHERE date >= DATE_SUB(CURRENT_DATE(), 30)",
                    "format": {"decimals": 0}
                },
                {
                    "type": "ai_insight",
                    "position": {"row": 1, "col": 0, "width": 6, "height": 2},
                    "query": """
                        SELECT
                            ai_query(
                                'databricks-meta-llama-3-70b-instruct',
                                CONCAT(
                                    'Analyze these sales metrics and provide 3 key insights: ',
                                    'Total Revenue: ', CAST(SUM(revenue) AS STRING),
                                    ', YoY Growth: ', CAST(AVG(yoy_growth) AS STRING), '%',
                                    ', Top Region: ', MAX(CASE WHEN rank = 1 THEN region END)
                                )
                            ) as insight
                        FROM sales_summary
                    """,
                    "style": {"background": "light-blue"}
                },
                {
                    "type": "chart",
                    "chart_type": "line",
                    "position": {"row": 3, "col": 0, "width": 6, "height": 3},
                    "query": """
                        SELECT date, SUM(revenue) as revenue
                        FROM sales
                        WHERE date >= DATE_SUB(CURRENT_DATE(), 90)
                        GROUP BY date
                        ORDER BY date
                    """
                }
            ]
        },
        {
            "name": "Customer Insights",
            "widgets": [
                {
                    "type": "ai_analysis",
                    "title": "Customer Sentiment Analysis",
                    "query": """
                        SELECT
                            segment,
                            ai_analyze_sentiment(feedback) as sentiment,
                            COUNT(*) as count
                        FROM customer_feedback
                        GROUP BY segment, ai_analyze_sentiment(feedback)
                    """
                }
            ]
        }
    ]
}
```

## Conversational Analytics with Genie

```python
class GenieConversation:
    """Manage conversational analytics with Genie"""

    def __init__(self, genie_client, space_id: str):
        self.client = genie_client
        self.space_id = space_id
        self.conversation_id = None
        self.history = []

    def start_conversation(self) -> str:
        """Start a new conversation"""
        response = self.client.create_conversation(self.space_id)
        self.conversation_id = response["conversation_id"]
        return self.conversation_id

    def ask(self, question: str) -> dict:
        """Ask a question in the conversation"""

        if not self.conversation_id:
            self.start_conversation()

        response = self.client.send_message(
            conversation_id=self.conversation_id,
            message=question
        )

        self.history.append({
            "question": question,
            "response": response
        })

        return {
            "answer": response.get("text_response"),
            "sql": response.get("generated_sql"),
            "data": response.get("query_results"),
            "visualization": response.get("suggested_chart")
        }

    def drill_down(self, dimension: str) -> dict:
        """Drill down on a dimension"""
        return self.ask(f"Break that down by {dimension}")

    def compare(self, comparison: str) -> dict:
        """Compare to another period or segment"""
        return self.ask(f"Compare that to {comparison}")

    def get_insights(self) -> dict:
        """Get AI-generated insights on current view"""
        return self.ask("What insights can you give me about this data?")

# Usage example
# genie = GenieConversation(genie_client, "space_id")
# genie.start_conversation()
#
# result = genie.ask("What were sales last month?")
# print(result["answer"])
#
# result = genie.drill_down("region")
# print(result["answer"])
```

## Conclusion

Databricks AI/BI brings intelligent analytics to the lakehouse. From natural language queries with Genie to AI-enhanced SQL functions, these capabilities make advanced analytics accessible to everyone.

