---
title: "Building AI Data Analysis Assistants"
description: "AI data analysis assistants make insights accessible to everyone, regardless of technical expertise. The key is combining natural language understanding…"
author: Michael John Pena
draft: false
date: 2023-04-15
tags:
  - AI
  - Data Analysis
  - OpenAI
  - Python
  - Analytics
---

## Data Analysis Assistant

```python
import pandas as pd
from dataclasses import dataclass

@dataclass
class AnalysisResult:
    summary: str
    insights: list[str]
    visualizations: list[dict]
    recommendations: list[str]
    code: str

class DataAnalysisAssistant:
    """AI-powered data analysis assistant."""

    def __init__(self, client):
        self.client = client

    async def analyze(
        self,
        df: pd.DataFrame,
        question: str = None
    ) -> AnalysisResult:
        """Analyze DataFrame and generate insights."""

        # Get data profile
        profile = self._profile_data(df)

        # Generate analysis
        analysis = await self._generate_analysis(profile, question)

        # Generate visualization recommendations
        viz_recs = await self._recommend_visualizations(profile, question)

        return AnalysisResult(
            summary=analysis["summary"],
            insights=analysis["insights"],
            visualizations=viz_recs,
            recommendations=analysis["recommendations"],
            code=analysis.get("code", "")
        )

    def _profile_data(self, df: pd.DataFrame) -> dict:
        """Create data profile for LLM context."""
        return {
            "shape": df.shape,
            "columns": list(df.columns),
            "dtypes": df.dtypes.to_dict(),
            "sample": df.head(5).to_dict(),
            "stats": df.describe().to_dict(),
            "nulls": df.isnull().sum().to_dict(),
            "unique_counts": {col: df[col].nunique() for col in df.columns}
        }

    async def _generate_analysis(
        self,
        profile: dict,
        question: str
    ) -> dict:
        """Generate analysis from profile."""

        import json
        profile_str = json.dumps(profile, indent=2, default=str)

        prompt = f"""Analyze this dataset.

Data Profile:
{profile_str}

{f'Specific question: {question}' if question else 'Provide general analysis'}

Provide:
1. Summary of what the data contains
2. Key insights (5-7 points)
3. Anomalies or issues found
4. Recommendations for further analysis
5. Python code to reproduce key findings

Return as JSON."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            return json.loads(response.content)
        except:
            return {"summary": response.content, "insights": [], "recommendations": []}

    async def _recommend_visualizations(
        self,
        profile: dict,
        question: str
    ) -> list[dict]:
        """Recommend visualizations."""

        prompt = f"""Recommend visualizations for this data.

Columns: {profile['columns']}
Types: {profile['dtypes']}
{f'Focus: {question}' if question else ''}

For each recommendation provide:
- chart_type: type of chart
- columns: columns to use
- purpose: what it shows
- code: matplotlib/seaborn code

Return as JSON array."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return []
```

## Conversational Data Analysis

```python
class ConversationalAnalyst:
    """Have a conversation about your data."""

    def __init__(self, client, df: pd.DataFrame):
        self.client = client
        self.df = df
        self.history = []
        self.context = self._create_context()

    def _create_context(self) -> str:
        """Create context about the data."""
        return f"""Dataset Information:
- Shape: {self.df.shape}
- Columns: {list(self.df.columns)}
- Types: {self.df.dtypes.to_dict()}
- Sample: {self.df.head(3).to_dict()}"""

    async def chat(self, message: str) -> str:
        """Chat about the data."""

        self.history.append({"role": "user", "content": message})

        messages = [
            {"role": "system", "content": f"""You are a data analyst assistant.

{self.context}

You can:
- Answer questions about the data
- Generate analysis code
- Explain patterns and insights
- Recommend visualizations

When you write code, it will be executed on the DataFrame 'df'."""},
            *self.history
        ]

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=messages
        )

        self.history.append({
            "role": "assistant",
            "content": response.content
        })

        # Check if response contains code to execute
        if "```python" in response.content:
            code = self._extract_code(response.content)
            result = self._execute_code(code)
            if result:
                return f"{response.content}\n\nExecution Result:\n{result}"

        return response.content

    def _extract_code(self, response: str) -> str:
        """Extract Python code from response."""
        if "```python" in response:
            start = response.find("```python") + 9
            end = response.find("```", start)
            return response[start:end].strip()
        return ""

    def _execute_code(self, code: str) -> str:
        """Safely execute analysis code."""
        try:
            # Create safe execution environment
            local_vars = {"df": self.df, "pd": pd}
            exec(code, {"__builtins__": {}}, local_vars)

            # Get result variable if it exists
            if "result" in local_vars:
                return str(local_vars["result"])
            return "Code executed successfully"
        except Exception as e:
            return f"Error: {e}"
```

## Automated Reporting

```python
class AutoReportGenerator:
    """Generate analysis reports automatically."""

    async def generate_report(
        self,
        df: pd.DataFrame,
        report_type: str = "executive"
    ) -> str:
        """Generate formatted analysis report."""

        profile = self._profile_data(df)

        prompts = {
            "executive": "Generate an executive summary with key metrics and insights",
            "technical": "Generate a technical analysis with statistical details",
            "exploratory": "Generate an exploratory data analysis report"
        }

        prompt = f"""{prompts.get(report_type, prompts['executive'])}

Data:
{json.dumps(profile, indent=2, default=str)}

Format as Markdown with:
1. Title
2. Executive Summary
3. Key Metrics
4. Insights
5. Visualizations (describe what to create)
6. Recommendations
7. Next Steps"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

AI data analysis assistants make insights accessible to everyone, regardless of technical expertise. The key is combining natural language understanding with proper data handling.
