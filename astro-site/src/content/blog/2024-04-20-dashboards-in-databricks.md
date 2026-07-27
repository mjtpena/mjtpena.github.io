---
title: "Dashboards in Databricks: Building Data Applications"
author: "Michael John Peña"
draft: false
date: 2024-04-20
tags: ["Databricks", "Dashboards", "Visualization", "Analytics", "BI"]

---

I wrote "Dashboards in Databricks: Building Data Applications" to share practical, production-minded guidance on this topic.

Databricks dashboards (including Lakeview) provide powerful visualization capabilities integrated with the lakehouse. This guide covers building effective dashboards.

## Dashboard Types in Databricks

```python
DASHBOARD_TYPES = {
    "lakeview": {
        "description": "Native Databricks dashboards with AI features",
        "capabilities": [
            "Drag-and-drop design",
            "AI-generated visualizations",
            "Natural language filters",
            "Automatic formatting"
        ],
        "best_for": "Quick, self-service analytics"
    },
    "sql_dashboards": {
        "description": "SQL-based dashboards with scheduled refresh",
        "capabilities": [
            "Parameter-driven queries",
            "Multiple visualization types",
            "Scheduled refresh",
            "Alerts and notifications"
        ],
        "best_for": "Operational dashboards"
    },
    "notebook_dashboards": {
        "description": "Notebook-based dashboards with Python visualizations",
        "capabilities": [
            "Custom visualizations",
            "Complex calculations",
            "Interactive widgets",
            "ML model integration"
        ],
        "best_for": "Advanced analytics and ML dashboards"
    }
}
```

## Creating SQL Dashboards

```sql
-- Dashboard query examples

-- KPI Card: Total Revenue
SELECT
    SUM(revenue) as total_revenue,
    SUM(revenue) - LAG(SUM(revenue)) OVER (ORDER BY month) as change_from_last
FROM monthly_sales
WHERE month = DATE_TRUNC('month', CURRENT_DATE - INTERVAL 1 MONTH);

-- Time Series: Revenue Trend
SELECT
    date,
    SUM(revenue) as daily_revenue,
    AVG(SUM(revenue)) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as rolling_7d_avg
FROM sales
WHERE date >= DATE_SUB(CURRENT_DATE, 90)
GROUP BY date
ORDER BY date;

-- Bar Chart: Revenue by Category
SELECT
    category,
    SUM(revenue) as revenue,
    COUNT(DISTINCT order_id) as orders
FROM sales
JOIN products USING (product_id)
WHERE date >= DATE_SUB(CURRENT_DATE, 30)
GROUP BY category
ORDER BY revenue DESC
LIMIT 10;

-- Table: Top Customers
SELECT
    customer_name,
    SUM(revenue) as total_revenue,
    COUNT(DISTINCT order_id) as order_count,
    AVG(revenue) as avg_order_value,
    MAX(date) as last_order_date
FROM sales
JOIN customers USING (customer_id)
GROUP BY customer_name
ORDER BY total_revenue DESC
LIMIT 20;

-- Map: Revenue by State
SELECT
    state,
    SUM(revenue) as revenue,
    COUNT(DISTINCT customer_id) as customers
FROM sales
JOIN customers USING (customer_id)
WHERE country = 'USA'
GROUP BY state;
```

## Dashboard with Parameters

```sql
-- Parameterized dashboard queries

-- Date range parameter: {{ date_range }}
-- Category parameter: {{ category }}

SELECT
    date,
    category,
    SUM(revenue) as revenue
FROM sales
JOIN products USING (product_id)
WHERE date BETWEEN '{{ date_range.start }}' AND '{{ date_range.end }}'
  AND ({{ category }} IS NULL OR category = {{ category }})
GROUP BY date, category
ORDER BY date;
```

## Python Notebook Dashboards

```python
# Notebook-based dashboard with interactive widgets

import ipywidgets as widgets
from IPython.display import display
import plotly.express as px
import plotly.graph_objects as go
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

class InteractiveDashboard:
    """Interactive dashboard using notebook widgets"""

    def __init__(self):
        self.df = self._load_data()
        self._create_widgets()

    def _load_data(self):
        """Load data from lakehouse"""
        return spark.sql("""
            SELECT
                date,
                region,
                category,
                SUM(revenue) as revenue,
                COUNT(*) as transactions
            FROM sales
            WHERE date >= DATE_SUB(CURRENT_DATE, 365)
            GROUP BY date, region, category
        """).toPandas()

    def _create_widgets(self):
        """Create filter widgets"""

        self.region_filter = widgets.SelectMultiple(
            options=['All'] + sorted(self.df['region'].unique().tolist()),
            value=['All'],
            description='Region:',
            disabled=False
        )

        self.category_filter = widgets.SelectMultiple(
            options=['All'] + sorted(self.df['category'].unique().tolist()),
            value=['All'],
            description='Category:',
            disabled=False
        )

        self.date_range = widgets.DatePicker(
            description='Start Date:',
            disabled=False
        )

        # Create update button
        self.update_btn = widgets.Button(
            description='Update Dashboard',
            button_style='primary'
        )
        self.update_btn.on_click(self._update_dashboard)

        # Output area
        self.output = widgets.Output()

    def _filter_data(self):
        """Apply filters to data"""
        filtered = self.df.copy()

        if 'All' not in self.region_filter.value:
            filtered = filtered[filtered['region'].isin(self.region_filter.value)]

        if 'All' not in self.category_filter.value:
            filtered = filtered[filtered['category'].isin(self.category_filter.value)]

        return filtered

    def _update_dashboard(self, btn):
        """Update dashboard visualizations"""

        self.output.clear_output()

        with self.output:
            filtered = self._filter_data()

            # KPIs
            total_revenue = filtered['revenue'].sum()
            total_transactions = filtered['transactions'].sum()
            avg_transaction = total_revenue / total_transactions if total_transactions > 0 else 0

            print(f"Total Revenue: ${total_revenue:,.0f}")
            print(f"Total Transactions: {total_transactions:,}")
            print(f"Average Transaction: ${avg_transaction:,.2f}")

            # Revenue trend
            trend_df = filtered.groupby('date')['revenue'].sum().reset_index()
            fig1 = px.line(trend_df, x='date', y='revenue', title='Revenue Trend')
            fig1.show()

            # Revenue by region
            region_df = filtered.groupby('region')['revenue'].sum().reset_index()
            fig2 = px.bar(region_df, x='region', y='revenue', title='Revenue by Region')
            fig2.show()

            # Revenue by category
            cat_df = filtered.groupby('category')['revenue'].sum().reset_index()
            fig3 = px.pie(cat_df, values='revenue', names='category', title='Revenue by Category')
            fig3.show()

    def display(self):
        """Display the dashboard"""

        # Layout
        filters = widgets.HBox([
            self.region_filter,
            self.category_filter
        ])

        display(widgets.VBox([
            widgets.HTML("<h1>Sales Dashboard</h1>"),
            filters,
            self.update_btn,
            self.output
        ]))

        # Initial load
        self._update_dashboard(None)

# Create and display dashboard
# dashboard = InteractiveDashboard()
# dashboard.display()
```

## Dashboard API

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import (
    CreateDashboardRequest,
    Dashboard,
    Widget
)

class DashboardManager:
    """Manage Databricks dashboards programmatically"""

    def __init__(self):
        self.client = WorkspaceClient()

    def create_dashboard(
        self,
        name: str,
        warehouse_id: str,
        queries: list
    ) -> Dashboard:
        """Create a new dashboard"""

        # Create dashboard
        dashboard = self.client.dashboards.create(
            name=name,
            parent=None  # Root folder
        )

        # Add widgets for each query
        for i, query_config in enumerate(queries):
            self._add_widget(
                dashboard_id=dashboard.id,
                query_config=query_config,
                position=i
            )

        return dashboard

    def _add_widget(
        self,
        dashboard_id: str,
        query_config: dict,
        position: int
    ):
        """Add a widget to dashboard"""

        # Create query first
        query = self.client.queries.create(
            name=query_config['name'],
            data_source_id=query_config['warehouse_id'],
            query=query_config['sql']
        )

        # Create visualization
        visualization = self.client.query_visualizations.create(
            query_id=query.id,
            type=query_config.get('chart_type', 'TABLE'),
            options=query_config.get('options', {})
        )

        # Add widget to dashboard
        self.client.dashboard_widgets.create(
            dashboard_id=dashboard_id,
            visualization_id=visualization.id,
            width=query_config.get('width', 1),
            options={
                "position": {"col": position % 2, "row": position // 2}
            }
        )

    def refresh_dashboard(self, dashboard_id: str):
        """Trigger dashboard refresh"""
        # Refresh all queries in dashboard
        dashboard = self.client.dashboards.get(dashboard_id)
        for widget in dashboard.widgets:
            if widget.visualization:
                self.client.queries.execute(widget.visualization.query.id)

    def schedule_refresh(
        self,
        dashboard_id: str,
        schedule: str  # Cron expression
    ):
        """Schedule automatic refresh"""
        # Note: Implement based on available scheduling APIs
        pass

# Usage
# manager = DashboardManager()
# dashboard = manager.create_dashboard(
#     name="Sales Overview",
#     warehouse_id="warehouse_id",
#     queries=[
#         {"name": "Revenue KPI", "sql": "SELECT SUM(revenue) FROM sales", "chart_type": "counter"},
#         {"name": "Revenue Trend", "sql": "SELECT date, SUM(revenue) FROM sales GROUP BY date", "chart_type": "line"}
#     ]
# )
```

## Conclusion

Databricks dashboards provide flexible options from quick Lakeview dashboards to sophisticated notebook-based visualizations. Choose the right type based on your audience and update requirements.

