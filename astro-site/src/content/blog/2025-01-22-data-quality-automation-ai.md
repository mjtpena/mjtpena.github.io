---
title: "Data Quality Automation with AI: Beyond Rule-Based Validation"
description: "AI transforms data quality from reactive checking to proactive management. Start with profiling and anomaly detection, then expand to automated rule…"
author: Michael John Peña
draft: false
date: 2025-01-22
tags:
  - Data Quality
  - AI
  - Data Engineering
  - Automation
  - Azure
---

## The Evolution of Data Quality

```
Rule-Based (Traditional):
Define rules → Execute checks → Report violations

AI-Powered:
Profile data → Learn patterns → Detect anomalies → Suggest rules → Auto-remediate
```

## Intelligent Data Profiling

```python
from azure.ai.foundry import AIFoundryClient
import pandas as pd
import numpy as np

class AIDataProfiler:
    def __init__(self, llm_client: AIFoundryClient):
        self.llm = llm_client

    async def profile_dataframe(self, df: pd.DataFrame, context: str = "") -> dict:
        """Generate intelligent data profile."""

        # Basic statistics
        stats = self._compute_statistics(df)

        # AI-powered analysis
        analysis = await self._analyze_with_ai(df, stats, context)

        return {
            "statistics": stats,
            "analysis": analysis,
            "suggested_rules": analysis.get("suggested_rules", []),
            "quality_score": analysis.get("quality_score", 0),
            "issues_found": analysis.get("issues", [])
        }

    def _compute_statistics(self, df: pd.DataFrame) -> dict:
        """Compute basic statistics for all columns."""
        stats = {}

        for col in df.columns:
            col_stats = {
                "dtype": str(df[col].dtype),
                "null_count": int(df[col].isnull().sum()),
                "null_pct": float(df[col].isnull().mean() * 100),
                "unique_count": int(df[col].nunique()),
                "unique_pct": float(df[col].nunique() / len(df) * 100)
            }

            if pd.api.types.is_numeric_dtype(df[col]):
                col_stats.update({
                    "min": float(df[col].min()) if not pd.isna(df[col].min()) else None,
                    "max": float(df[col].max()) if not pd.isna(df[col].max()) else None,
                    "mean": float(df[col].mean()) if not pd.isna(df[col].mean()) else None,
                    "std": float(df[col].std()) if not pd.isna(df[col].std()) else None,
                    "median": float(df[col].median()) if not pd.isna(df[col].median()) else None
                })
            elif pd.api.types.is_string_dtype(df[col]):
                col_stats.update({
                    "min_length": int(df[col].str.len().min()) if df[col].notna().any() else None,
                    "max_length": int(df[col].str.len().max()) if df[col].notna().any() else None,
                    "sample_values": df[col].dropna().head(5).tolist()
                })

            stats[col] = col_stats

        return stats

    async def _analyze_with_ai(self, df: pd.DataFrame, stats: dict, context: str) -> dict:
        """Use AI to analyze data quality."""

        # Sample data for AI analysis
        sample = df.head(100).to_dict(orient='records')

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Analyze this data for quality issues:

                Context: {context}

                Column Statistics:
                {json.dumps(stats, indent=2)}

                Sample Data (first 5 rows):
                {json.dumps(sample[:5], indent=2, default=str)}

                Identify:
                1. Data quality issues (nulls, outliers, inconsistencies, format issues)
                2. Potential data type mismatches
                3. Business rule violations you can infer
                4. Suggested validation rules

                Return JSON:
                {{
                    "quality_score": 0-100,
                    "issues": [
                        {{"column": "col", "issue": "description", "severity": "high|medium|low", "affected_rows_estimate": "X%"}}
                    ],
                    "suggested_rules": [
                        {{"column": "col", "rule_type": "not_null|range|pattern|unique|custom", "rule_definition": "...", "rationale": "why this rule"}}
                    ],
                    "insights": ["interesting observations about the data"]
                }}"""
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Anomaly Detection

```python
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

class AnomalyDetector:
    def __init__(self, llm_client: AIFoundryClient):
        self.llm = llm_client

    def detect_numeric_anomalies(self, df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
        """Detect anomalies in numeric columns using Isolation Forest."""

        # Prepare data
        data = df[columns].dropna()
        scaler = StandardScaler()
        scaled = scaler.fit_transform(data)

        # Fit model
        model = IsolationForest(contamination=0.05, random_state=42)
        predictions = model.fit_predict(scaled)

        # Mark anomalies
        result = df.copy()
        result['is_anomaly'] = False
        result.loc[data.index, 'is_anomaly'] = predictions == -1

        return result

    async def explain_anomalies(self, df: pd.DataFrame, anomaly_rows: pd.DataFrame) -> list[dict]:
        """Use AI to explain detected anomalies."""

        normal_stats = df[~df['is_anomaly']].describe().to_dict()
        anomaly_sample = anomaly_rows.head(10).to_dict(orient='records')

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Explain these data anomalies:

                Normal data statistics:
                {json.dumps(normal_stats, indent=2, default=str)}

                Anomaly samples:
                {json.dumps(anomaly_sample, indent=2, default=str)}

                For each anomaly, explain:
                1. Why it's anomalous
                2. Possible causes
                3. Recommended action (investigate, fix, or accept)

                Return JSON array of explanations."""
            }]
        )

        return json.loads(response.choices[0].message.content)

    async def detect_semantic_anomalies(self, df: pd.DataFrame, column: str, context: str) -> dict:
        """Detect anomalies based on semantic understanding."""

        sample = df[column].dropna().sample(min(100, len(df))).tolist()

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Analyze these values for semantic anomalies:

                Column: {column}
                Context: {context}
                Sample values: {sample}

                Identify values that seem incorrect based on context.
                Consider:
                - Values that don't fit the expected pattern
                - Inconsistent formats
                - Unlikely values
                - Potential typos or encoding issues

                Return JSON:
                {{
                    "anomalies": [
                        {{"value": "...", "reason": "why it's anomalous", "suggestion": "possible correction"}}
                    ],
                    "pattern_detected": "the expected pattern if any"
                }}"""
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Automated Rule Generation

```python
class RuleGenerator:
    def __init__(self, llm_client: AIFoundryClient):
        self.llm = llm_client

    async def generate_rules(self, df: pd.DataFrame, table_name: str, context: str) -> list[dict]:
        """Generate data quality rules from data analysis."""

        profile = AIDataProfiler(self.llm)
        profile_result = await profile.profile_dataframe(df, context)

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Generate comprehensive data quality rules for this table:

                Table: {table_name}
                Context: {context}
                Profile: {json.dumps(profile_result['statistics'], indent=2)}

                Generate rules in Great Expectations format:
                {{
                    "rules": [
                        {{
                            "name": "rule_name",
                            "type": "expect_column_values_to_not_be_null|expect_column_values_to_be_between|...",
                            "column": "column_name",
                            "parameters": {{}},
                            "severity": "critical|warning|info",
                            "description": "what this rule checks"
                        }}
                    ]
                }}

                Include rules for:
                - Completeness (nulls)
                - Uniqueness
                - Valid ranges
                - Valid patterns (regex)
                - Referential integrity hints
                - Business logic"""
            }]
        )

        return json.loads(response.choices[0].message.content)["rules"]

    def to_great_expectations(self, rules: list[dict]) -> dict:
        """Convert rules to Great Expectations suite."""

        expectations = []

        for rule in rules:
            expectation = {
                "expectation_type": rule["type"],
                "kwargs": {"column": rule["column"], **rule["parameters"]}
            }
            expectations.append(expectation)

        return {
            "expectation_suite_name": "ai_generated_suite",
            "expectations": expectations,
            "meta": {"generated_by": "ai", "timestamp": datetime.utcnow().isoformat()}
        }
```

## Intelligent Remediation

```python
class DataRemediator:
    def __init__(self, llm_client: AIFoundryClient):
        self.llm = llm_client

    async def suggest_remediation(self, issue: dict, sample_data: list) -> dict:
        """Suggest remediation for a data quality issue."""

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Suggest remediation for this data quality issue:

                Issue: {json.dumps(issue)}
                Sample affected data: {json.dumps(sample_data[:10], default=str)}

                Provide:
                1. Recommended action
                2. SQL/Python code to fix
                3. Risk assessment
                4. Validation query to verify fix

                Return JSON:
                {{
                    "action": "delete|update|flag|quarantine",
                    "code": "SQL or Python code to apply fix",
                    "risk": "high|medium|low",
                    "risk_explanation": "why this risk level",
                    "validation": "query to verify fix worked"
                }}"""
            }]
        )

        return json.loads(response.choices[0].message.content)

    async def auto_fix(self, df: pd.DataFrame, issue: dict) -> pd.DataFrame:
        """Automatically fix certain data quality issues."""

        fix_type = issue.get("fix_type")

        if fix_type == "standardize_format":
            return await self._standardize_format(df, issue)
        elif fix_type == "fill_missing":
            return await self._fill_missing(df, issue)
        elif fix_type == "fix_typos":
            return await self._fix_typos(df, issue)
        else:
            raise ValueError(f"Unknown fix type: {fix_type}")

    async def _standardize_format(self, df: pd.DataFrame, issue: dict) -> pd.DataFrame:
        """Standardize format using AI."""

        column = issue["column"]
        sample = df[column].dropna().unique()[:50].tolist()

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Standardize these values to a consistent format:

                Values: {sample}

                Return JSON mapping: {{"original": "standardized", ...}}"""
            }]
        )

        mapping = json.loads(response.choices[0].message.content)

        result = df.copy()
        result[column] = result[column].map(lambda x: mapping.get(x, x))

        return result
```

## Continuous Monitoring

```python
class DQMonitor:
    def __init__(self, llm_client: AIFoundryClient, alert_threshold: float = 0.9):
        self.llm = llm_client
        self.alert_threshold = alert_threshold
        self.baseline = {}

    def set_baseline(self, table: str, profile: dict):
        """Set baseline statistics for comparison."""
        self.baseline[table] = profile

    async def check_drift(self, table: str, current_profile: dict) -> dict:
        """Check for data drift from baseline."""

        if table not in self.baseline:
            return {"drift_detected": False, "message": "No baseline set"}

        baseline = self.baseline[table]

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Compare these data profiles and detect drift:

                Baseline: {json.dumps(baseline, indent=2)}
                Current: {json.dumps(current_profile, indent=2)}

                Identify significant changes in:
                - Value distributions
                - Null rates
                - Unique counts
                - Statistical measures

                Return JSON:
                {{
                    "drift_detected": true|false,
                    "drift_score": 0-1,
                    "changes": [
                        {{"column": "col", "metric": "what changed", "baseline_value": "...", "current_value": "...", "severity": "high|medium|low"}}
                    ],
                    "recommendations": ["what to do about the drift"]
                }}"""
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Best Practices

1. **Combine AI with rules**: Use AI to discover, rules to enforce
2. **Human oversight**: Review AI-generated rules before production
3. **Continuous learning**: Update models with new data patterns
4. **Explainability**: Always understand why something is flagged
5. **Gradual automation**: Start with detection, then move to remediation

AI transforms data quality from reactive checking to proactive management. Start with profiling and anomaly detection, then expand to automated rule generation and remediation.
