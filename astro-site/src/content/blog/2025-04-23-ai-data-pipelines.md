---
title: "AI in Data Pipelines: Intelligent ETL and ELT"
author: Michael John Peña
draft: false
date: 2025-04-23
tags:
  - AI
  - Data Pipelines
  - ETL
  - Data Engineering
  - Automation

---

I wrote "AI in Data Pipelines: Intelligent ETL and ELT" to share practical, production-minded guidance on this topic.

## AI-Enhanced Data Pipeline

```python
from azure.ai.openai import AzureOpenAI
import pandas as pd
from typing import Callable, List

class AIDataPipeline:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client
        self.stages: List[Callable] = []

    def add_stage(self, stage: Callable):
        """Add processing stage to pipeline."""
        self.stages.append(stage)
        return self

    async def run(self, df: pd.DataFrame) -> pd.DataFrame:
        """Run pipeline on dataframe."""
        for stage in self.stages:
            df = await stage(df)
        return df

    async def ai_transform(self, df: pd.DataFrame, instructions: str) -> pd.DataFrame:
        """Apply AI-driven transformation."""
        # Get sample for context
        sample = df.head(5).to_dict('records')

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """You are a data transformation expert.
                Generate Python/pandas code to transform the data.
                Return only executable code, no explanations."""
            }, {
                "role": "user",
                "content": f"""Transform this data: {instructions}

Sample data: {sample}
Columns: {list(df.columns)}
Data types: {df.dtypes.to_dict()}"""
            }]
        )

        code = self.extract_code(response.choices[0].message.content)
        # Execute transformation (with sandboxing in production)
        local_vars = {"df": df.copy(), "pd": pd}
        exec(code, {"pd": pd}, local_vars)

        return local_vars.get("result", local_vars.get("df"))

    async def ai_quality_check(self, df: pd.DataFrame) -> dict:
        """AI-powered data quality assessment."""
        sample = df.sample(min(100, len(df))).to_dict('records')
        stats = df.describe().to_dict()

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Analyze data quality and identify issues:
                - Missing values patterns
                - Outliers and anomalies
                - Data type mismatches
                - Inconsistent formats
                - Business rule violations"""
            }, {
                "role": "user",
                "content": f"Sample: {sample}\nStatistics: {stats}"
            }],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    async def ai_schema_mapping(self, source_df: pd.DataFrame, target_schema: dict) -> dict:
        """AI-assisted schema mapping."""
        source_info = {
            "columns": list(source_df.columns),
            "types": source_df.dtypes.astype(str).to_dict(),
            "sample": source_df.head(3).to_dict('records')
        }

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": "Map source columns to target schema. Suggest transformations needed."
            }, {
                "role": "user",
                "content": f"Source: {source_info}\n\nTarget schema: {target_schema}"
            }],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    async def ai_anomaly_detection(self, df: pd.DataFrame) -> pd.DataFrame:
        """Detect anomalies using AI reasoning."""
        # Statistical detection
        numeric_cols = df.select_dtypes(include=['number']).columns
        for col in numeric_cols:
            q1, q3 = df[col].quantile([0.25, 0.75])
            iqr = q3 - q1
            df[f'{col}_anomaly'] = (df[col] < q1 - 1.5*iqr) | (df[col] > q3 + 1.5*iqr)

        # AI explanation for anomalies
        anomalies = df[df[[f'{c}_anomaly' for c in numeric_cols]].any(axis=1)]
        if len(anomalies) > 0:
            df['anomaly_explanation'] = await self.explain_anomalies(anomalies)

        return df
```

AI-enhanced pipelines handle complex transformations and quality issues automatically.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
