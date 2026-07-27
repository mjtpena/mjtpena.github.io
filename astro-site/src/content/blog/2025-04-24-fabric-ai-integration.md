---
title: "Microsoft Fabric AI Integration: Unified Analytics and Intelligence"
author: Michael John Peña
draft: false
date: 2025-04-24
tags:
  - Microsoft Fabric
  - AI
  - Analytics
  - Data Platform
  - Integration

---

I wrote "Microsoft Fabric AI Integration: Unified Analytics and Intelligence" to share practical, production-minded guidance on this topic.

## Fabric AI Features

```python
# Fabric AI integration patterns

from azure.identity import DefaultAzureCredential
from azure.ai.openai import AzureOpenAI
import sempy.fabric as fabric

class FabricAIWorkspace:
    def __init__(self, workspace_name: str):
        self.workspace = workspace_name
        self.credential = DefaultAzureCredential()

    def get_semantic_link(self):
        """Access Fabric data through Semantic Link."""
        # Read data from Fabric lakehouse
        df = fabric.read_table(
            workspace=self.workspace,
            dataset="SalesData",
            table="FactSales"
        )
        return df

    async def copilot_query(self, question: str) -> dict:
        """Query data using Copilot natural language."""
        # Fabric Copilot integration
        result = fabric.evaluate_dax(
            dataset="SalesData",
            dax_string=await self.nl_to_dax(question)
        )
        return result

    async def nl_to_dax(self, question: str) -> str:
        """Convert natural language to DAX."""
        schema = self.get_semantic_model_schema()

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"""Convert natural language to DAX query.
                Semantic model schema: {schema}
                Return only the DAX query."""
            }, {
                "role": "user",
                "content": question
            }]
        )

        return response.choices[0].message.content

    def get_semantic_model_schema(self) -> dict:
        """Get semantic model schema for context."""
        return fabric.list_measures(
            dataset="SalesData",
            workspace=self.workspace
        )


class FabricNotebookAI:
    """AI capabilities in Fabric notebooks."""

    def __init__(self):
        self.openai = AzureOpenAI(...)

    async def analyze_dataframe(self, df, question: str) -> str:
        """Analyze dataframe using AI."""
        # Create pandas AI agent
        from pandasai import SmartDataframe

        sdf = SmartDataframe(df, config={
            "llm": self.openai,
            "enable_cache": True
        })

        return sdf.chat(question)

    async def generate_visualization(self, df, description: str) -> str:
        """Generate visualization code from description."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Generate Python visualization code using matplotlib or plotly.
                The dataframe is available as 'df'.
                Return only executable code."""
            }, {
                "role": "user",
                "content": f"Columns: {list(df.columns)}\n\nVisualization: {description}"
            }]
        )

        return response.choices[0].message.content

    async def explain_insights(self, df) -> str:
        """Generate insights from data."""
        stats = df.describe().to_dict()
        sample = df.head(10).to_dict('records')

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Analyze this data and provide key insights:
                Statistics: {stats}
                Sample: {sample}

                Identify trends, anomalies, and actionable insights."""
            }]
        )

        return response.choices[0].message.content
```

Microsoft Fabric integrates AI throughout the analytics lifecycle from ingestion to insights.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
