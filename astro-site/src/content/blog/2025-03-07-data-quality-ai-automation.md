---
title: "Data Quality Automation with AI: Beyond Rule-Based Validation"
description: "AI-powered data quality catches issues that traditional rules miss."
author: Michael John Peña
draft: false
date: 2025-03-07
tags:
  - Data Quality
  - AI
  - Automation
  - Validation
  - ML
---

## AI-Powered Data Quality

```python
from azure.ai.openai import AzureOpenAI
import pandas as pd
from sklearn.ensemble import IsolationForest

class AIDataQuality:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client
        self.anomaly_detector = IsolationForest(contamination=0.01)

    async def validate_semantic(self, df: pd.DataFrame, column: str, expected_type: str) -> dict:
        """Validate semantic correctness of data."""
        sample = df[column].dropna().sample(min(100, len(df))).tolist()

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"""Analyze if these values are valid {expected_type}.
                Return JSON with:
                - valid_percentage: float
                - invalid_examples: list of invalid values
                - issues: list of detected problems"""
            }, {
                "role": "user",
                "content": str(sample)
            }],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)

    def detect_anomalies(self, df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
        """Detect statistical anomalies in numeric columns."""
        numeric_data = df[columns].fillna(0)
        predictions = self.anomaly_detector.fit_predict(numeric_data)
        df['is_anomaly'] = predictions == -1
        return df[df['is_anomaly']]

    async def check_consistency(self, df: pd.DataFrame, rules: list[str]) -> list[dict]:
        """Check cross-column consistency using AI."""
        sample = df.head(100).to_dict('records')

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"""Check data consistency against these rules: {rules}
                Identify violations and explain why they're problematic."""
            }, {
                "role": "user",
                "content": str(sample)
            }]
        )
        return self.parse_violations(response)

    async def suggest_fixes(self, invalid_records: list[dict]) -> list[dict]:
        """Suggest corrections for invalid data."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"Suggest corrections for these records:\n{invalid_records}"
            }]
        )
        return self.parse_suggestions(response)
```

AI-powered data quality catches issues that traditional rules miss.
