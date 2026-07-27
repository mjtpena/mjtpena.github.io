---
title: "AI-Powered Data Quality: Intelligent Data Validation"
author: Michael John Pena
draft: false
date: 2023-04-23
tags:
  - AI
  - Data Quality
  - Data Engineering
  - OpenAI
  - Python

---

I wrote "AI-Powered Data Quality: Intelligent Data Validation" to share practical, production-minded guidance on this topic.

## Intelligent Data Validation

```python
import pandas as pd
import openai
from dataclasses import dataclass
from typing import List, Optional
import json

@dataclass
class DataQualityIssue:
    column: str
    issue_type: str
    severity: str  # critical, warning, info
    description: str
    affected_rows: int
    suggested_fix: Optional[str] = None

class AIDataQualityChecker:
    """AI-powered data quality validation."""

    def __init__(self, client, model: str = "gpt-4"):
        self.client = client
        self.model = model

    async def analyze_data_quality(
        self,
        df: pd.DataFrame,
        context: str = None
    ) -> List[DataQualityIssue]:
        """Analyze DataFrame for quality issues."""

        # Build data profile
        profile = self._create_profile(df)

        prompt = f"""Analyze this data profile for quality issues.

Data Profile:
{json.dumps(profile, indent=2)}

{f'Context: {context}' if context else ''}

Identify:
1. Missing value patterns that seem problematic
2. Potential outliers or impossible values
3. Inconsistent data formats
4. Duplicates or near-duplicates
5. Referential integrity issues
6. Business rule violations (inferred)

For each issue provide:
- column: affected column
- issue_type: missing/outlier/format/duplicate/integrity/business_rule
- severity: critical/warning/info
- description: detailed description
- affected_rows: estimated count
- suggested_fix: how to fix it

Return as JSON array."""

        response = await self.client.chat_completion(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2
        )

        try:
            issues_data = json.loads(response.content)
            return [DataQualityIssue(**issue) for issue in issues_data]
        except:
            return []

    def _create_profile(self, df: pd.DataFrame) -> dict:
        """Create data profile for analysis."""
        profile = {
            "shape": df.shape,
            "columns": {}
        }

        for col in df.columns:
            col_profile = {
                "dtype": str(df[col].dtype),
                "null_count": int(df[col].isnull().sum()),
                "null_pct": round(df[col].isnull().mean() * 100, 2),
                "unique_count": int(df[col].nunique())
            }

            if pd.api.types.is_numeric_dtype(df[col]):
                col_profile.update({
                    "mean": round(df[col].mean(), 4) if not df[col].isnull().all() else None,
                    "std": round(df[col].std(), 4) if not df[col].isnull().all() else None,
                    "min": df[col].min() if not df[col].isnull().all() else None,
                    "max": df[col].max() if not df[col].isnull().all() else None,
                    "percentiles": {
                        "25": df[col].quantile(0.25) if not df[col].isnull().all() else None,
                        "50": df[col].quantile(0.50) if not df[col].isnull().all() else None,
                        "75": df[col].quantile(0.75) if not df[col].isnull().all() else None
                    }
                })
            else:
                top_values = df[col].value_counts().head(5).to_dict()
                col_profile["top_values"] = {str(k): v for k, v in top_values.items()}
                col_profile["sample_values"] = df[col].dropna().head(5).tolist()

            profile["columns"][col] = col_profile

        return profile

    async def generate_validation_rules(
        self,
        df: pd.DataFrame,
        table_name: str
    ) -> str:
        """Generate data validation rules."""

        profile = self._create_profile(df)

        prompt = f"""Generate comprehensive data validation rules for this table.

Table: {table_name}
Profile:
{json.dumps(profile, indent=2)}

Generate rules as Great Expectations expectation suite including:
1. Null checks for required columns
2. Type validations
3. Range checks for numeric columns
4. Uniqueness constraints
5. Pattern matching for strings
6. Cross-column validations

Return as Python code using Great Expectations API."""

        response = await self.client.chat_completion(
            model=self.model,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Anomaly Detection with LLMs

```python
class AIAnomalyDetector:
    """Detect anomalies using AI reasoning."""

    def __init__(self, client):
        self.client = client

    async def detect_row_anomalies(
        self,
        df: pd.DataFrame,
        sample_size: int = 100
    ) -> List[dict]:
        """Detect anomalous rows."""

        # Get sample of data
        sample = df.sample(min(sample_size, len(df)))

        # Get statistical context
        stats = df.describe().to_dict()

        prompt = f"""Analyze these data rows for anomalies.

Data Sample (JSON):
{sample.to_json(orient='records')}

Column Statistics:
{json.dumps(stats, indent=2, default=str)}

Identify anomalous rows based on:
1. Values far from typical ranges
2. Unusual combinations of values
3. Logical inconsistencies
4. Pattern breaks

For each anomaly provide:
- row_index: which row
- columns: affected columns
- reason: why it's anomalous
- confidence: 0.0-1.0

Return as JSON array."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2
        )

        try:
            return json.loads(response.content)
        except:
            return []

    async def detect_temporal_anomalies(
        self,
        df: pd.DataFrame,
        date_col: str,
        value_col: str
    ) -> List[dict]:
        """Detect anomalies in time series data."""

        # Prepare time series summary
        df_sorted = df.sort_values(date_col)
        recent = df_sorted.tail(30)

        time_series_data = recent[[date_col, value_col]].to_dict(orient='records')

        prompt = f"""Analyze this time series for anomalies.

Recent Data:
{json.dumps(time_series_data, indent=2, default=str)}

Historical Statistics:
- Mean: {df[value_col].mean():.2f}
- Std: {df[value_col].std():.2f}
- Min: {df[value_col].min():.2f}
- Max: {df[value_col].max():.2f}

Identify:
1. Sudden spikes or drops
2. Trend breaks
3. Seasonal anomalies
4. Missing expected patterns

For each anomaly provide:
- date: when it occurred
- value: the anomalous value
- expected_range: what was expected
- anomaly_type: spike/drop/trend_break/missing_pattern
- severity: high/medium/low

Return as JSON array."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)

    async def explain_anomaly(
        self,
        anomaly_data: dict,
        context_data: pd.DataFrame
    ) -> str:
        """Generate human-readable anomaly explanation."""

        prompt = f"""Explain this data anomaly in business terms.

Anomaly Details:
{json.dumps(anomaly_data, indent=2)}

Surrounding Context:
{context_data.to_string()}

Provide:
1. Plain English explanation
2. Potential root causes
3. Business impact
4. Recommended actions"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Automated Data Cleaning

```python
class AIDataCleaner:
    """AI-powered automated data cleaning."""

    def __init__(self, client):
        self.client = client

    async def suggest_cleaning_steps(
        self,
        df: pd.DataFrame,
        issues: List[DataQualityIssue]
    ) -> List[dict]:
        """Suggest data cleaning steps."""

        issues_str = "\n".join([
            f"- {i.column}: {i.issue_type} - {i.description}"
            for i in issues
        ])

        sample = df.head(10).to_string()

        prompt = f"""Suggest data cleaning steps for these issues.

Data Sample:
{sample}

Issues Found:
{issues_str}

For each cleaning step provide:
- step_number: order of execution
- target_column: which column
- operation: what to do (impute/transform/remove/standardize/etc.)
- parameters: operation parameters
- python_code: pandas code to implement
- impact: expected impact

Return as JSON array ordered by recommended execution."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)

    async def impute_missing_values(
        self,
        df: pd.DataFrame,
        column: str,
        context_columns: List[str] = None
    ) -> pd.DataFrame:
        """Intelligently impute missing values."""

        # Get rows with missing values
        missing_mask = df[column].isnull()
        missing_count = missing_mask.sum()

        if missing_count == 0:
            return df

        # Get context for imputation
        if context_columns:
            context_df = df[context_columns + [column]].dropna(subset=context_columns)
        else:
            context_df = df

        # Sample for LLM context
        sample_with_values = context_df[~context_df[column].isnull()].head(20)

        prompt = f"""Suggest imputation strategy for missing values.

Column: {column}
Missing Count: {missing_count}
Total Rows: {len(df)}

Sample rows WITH values:
{sample_with_values.to_string()}

Column statistics (non-null):
- Mean: {df[column].mean() if pd.api.types.is_numeric_dtype(df[column]) else 'N/A'}
- Mode: {df[column].mode().iloc[0] if len(df[column].mode()) > 0 else 'N/A'}

Recommend:
1. Best imputation strategy (mean/median/mode/predictive/domain-specific)
2. Reasoning
3. Python code to implement

Return as JSON."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        strategy = json.loads(response.content)

        # Apply suggested strategy
        if strategy.get("python_code"):
            exec(strategy["python_code"])

        return df

    async def standardize_column(
        self,
        df: pd.DataFrame,
        column: str,
        target_format: str = None
    ) -> pd.DataFrame:
        """Standardize column values using AI."""

        # Get unique values
        unique_values = df[column].dropna().unique()[:50]

        prompt = f"""Standardize these values to a consistent format.

Column: {column}
{f'Target format: {target_format}' if target_format else ''}

Current unique values:
{list(unique_values)}

Provide a mapping from current values to standardized values.
Return as JSON: {{"original_value": "standardized_value", ...}}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        mapping = json.loads(response.content)
        df[column] = df[column].map(lambda x: mapping.get(str(x), x))

        return df
```

## Data Quality Monitoring

```python
class AIDataQualityMonitor:
    """Continuous data quality monitoring with AI."""

    def __init__(self, client, alert_callback=None):
        self.client = client
        self.alert_callback = alert_callback
        self.baseline_profiles = {}

    async def establish_baseline(
        self,
        df: pd.DataFrame,
        table_name: str
    ):
        """Establish data quality baseline."""
        checker = AIDataQualityChecker(self.client)
        profile = checker._create_profile(df)

        self.baseline_profiles[table_name] = {
            "profile": profile,
            "established_at": pd.Timestamp.now().isoformat(),
            "row_count": len(df)
        }

    async def check_drift(
        self,
        df: pd.DataFrame,
        table_name: str
    ) -> dict:
        """Check for data drift from baseline."""

        if table_name not in self.baseline_profiles:
            raise ValueError(f"No baseline for {table_name}")

        baseline = self.baseline_profiles[table_name]
        checker = AIDataQualityChecker(self.client)
        current_profile = checker._create_profile(df)

        prompt = f"""Compare current data profile to baseline and identify drift.

Baseline Profile:
{json.dumps(baseline['profile'], indent=2)}

Current Profile:
{json.dumps(current_profile, indent=2)}

Identify:
1. Distribution shifts
2. New or missing columns
3. Cardinality changes
4. Statistical drift (mean, std changes)
5. Pattern changes

For each drift provide:
- column: affected column
- drift_type: distribution/cardinality/statistical/structural
- severity: high/medium/low
- baseline_value: what it was
- current_value: what it is now
- action_required: yes/no

Return as JSON array."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        drifts = json.loads(response.content)

        # Alert on high severity drifts
        high_severity = [d for d in drifts if d.get("severity") == "high"]
        if high_severity and self.alert_callback:
            await self.alert_callback(table_name, high_severity)

        return {
            "table": table_name,
            "drifts": drifts,
            "baseline_date": baseline["established_at"],
            "check_date": pd.Timestamp.now().isoformat()
        }

    async def generate_quality_report(
        self,
        df: pd.DataFrame,
        table_name: str
    ) -> str:
        """Generate comprehensive quality report."""

        checker = AIDataQualityChecker(self.client)
        issues = await checker.analyze_data_quality(df)
        profile = checker._create_profile(df)

        prompt = f"""Generate a data quality report.

Table: {table_name}
Profile:
{json.dumps(profile, indent=2)}

Issues Found:
{json.dumps([i.__dict__ for i in issues], indent=2)}

Generate a Markdown report including:
1. Executive Summary
2. Overall Quality Score (0-100)
3. Column-by-Column Analysis
4. Critical Issues
5. Recommendations
6. Trend Analysis (if baseline available)"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

# Usage
monitor = AIDataQualityMonitor(client)

# Establish baseline
await monitor.establish_baseline(df_baseline, "customer_data")

# Check drift periodically
drift_report = await monitor.check_drift(df_current, "customer_data")
print(f"Found {len(drift_report['drifts'])} drift issues")
```

AI-powered data quality goes beyond static rules. Intelligent systems understand context, detect subtle anomalies, and provide actionable recommendations for maintaining data integrity.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
