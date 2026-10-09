---
title: "Auto-Generated Insights: AI-Driven Data Discovery"
description: "Auto-generated insights use AI to automatically discover patterns, anomalies, and trends in your data. This guide covers building insight generation systems."
author: "Michael John Peña"
draft: false
date: 2024-04-16
tags: ["AI", "Data", "Insights", "Analytics", "Machine Learning"]
---

Auto-generated insights use AI to automatically discover patterns, anomalies, and trends in your data. This guide covers building insight generation systems.

## Types of Automated Insights

```python
from enum import Enum
from dataclasses import dataclass
from typing import List, Dict, Optional

class InsightType(Enum):
    TREND = "trend"  # Changes over time
    ANOMALY = "anomaly"  # Unusual values
    CORRELATION = "correlation"  # Relationships
    DISTRIBUTION = "distribution"  # Data shape
    COMPARISON = "comparison"  # Segment differences
    DRIVER = "driver"  # Contributing factors

@dataclass
class Insight:
    type: InsightType
    title: str
    description: str
    importance: float  # 0-1
    data_points: List[Dict]
    visualization: Optional[Dict] = None
    actions: Optional[List[str]] = None
```

## Insight Generation Engine

```python
import numpy as np
import pandas as pd
from scipy import stats
from typing import List, Dict
import anthropic

class InsightEngine:
    """Generate insights automatically from data"""

    def __init__(self):
        self.client = anthropic.Anthropic()

    def generate_insights(
        self,
        df: pd.DataFrame,
        metric_columns: List[str],
        dimension_columns: List[str],
        date_column: Optional[str] = None
    ) -> List[Insight]:
        """Generate all types of insights from dataframe"""

        insights = []

        # Trend insights
        if date_column:
            insights.extend(
                self._find_trends(df, metric_columns, date_column)
            )

        # Anomaly insights
        insights.extend(
            self._find_anomalies(df, metric_columns)
        )

        # Correlation insights
        insights.extend(
            self._find_correlations(df, metric_columns)
        )

        # Distribution insights
        insights.extend(
            self._find_distribution_insights(df, metric_columns)
        )

        # Comparison insights
        for dim in dimension_columns:
            insights.extend(
                self._find_comparisons(df, metric_columns, dim)
            )

        # Driver analysis
        for metric in metric_columns:
            insights.extend(
                self._find_drivers(df, metric, dimension_columns)
            )

        # Rank and return top insights
        insights.sort(key=lambda x: x.importance, reverse=True)
        return insights[:10]  # Top 10 insights

    def _find_trends(
        self,
        df: pd.DataFrame,
        metrics: List[str],
        date_col: str
    ) -> List[Insight]:
        """Identify significant trends"""

        insights = []

        for metric in metrics:
            # Group by date and calculate trend
            trend_df = df.groupby(date_col)[metric].sum().reset_index()

            if len(trend_df) < 3:
                continue

            # Calculate trend direction and strength
            x = np.arange(len(trend_df))
            y = trend_df[metric].values

            slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)

            if p_value < 0.05 and abs(r_value) > 0.7:
                direction = "increasing" if slope > 0 else "decreasing"
                pct_change = ((y[-1] - y[0]) / y[0]) * 100

                importance = min(abs(r_value) * abs(pct_change) / 100, 1.0)

                insights.append(Insight(
                    type=InsightType.TREND,
                    title=f"{metric} is {direction}",
                    description=f"{metric} has been consistently {direction}, "
                               f"changing by {pct_change:.1f}% over the period.",
                    importance=importance,
                    data_points=[{
                        "start_value": y[0],
                        "end_value": y[-1],
                        "change_pct": pct_change,
                        "r_squared": r_value ** 2
                    }],
                    visualization={"type": "line_chart", "metric": metric}
                ))

        return insights

    def _find_anomalies(
        self,
        df: pd.DataFrame,
        metrics: List[str]
    ) -> List[Insight]:
        """Detect anomalies using statistical methods"""

        insights = []

        for metric in metrics:
            values = df[metric].dropna()

            if len(values) < 10:
                continue

            # Calculate Z-scores
            z_scores = np.abs(stats.zscore(values))
            anomaly_mask = z_scores > 3

            if anomaly_mask.any():
                anomaly_indices = np.where(anomaly_mask)[0]
                anomaly_values = values.iloc[anomaly_indices]

                insights.append(Insight(
                    type=InsightType.ANOMALY,
                    title=f"Unusual values detected in {metric}",
                    description=f"Found {len(anomaly_indices)} unusual data points "
                               f"in {metric} that deviate significantly from normal.",
                    importance=0.8,
                    data_points=[{
                        "count": len(anomaly_indices),
                        "values": anomaly_values.tolist()[:5],
                        "threshold_z": 3
                    }],
                    actions=["Investigate data quality", "Review source systems"]
                ))

        return insights

    def _find_correlations(
        self,
        df: pd.DataFrame,
        metrics: List[str]
    ) -> List[Insight]:
        """Find significant correlations between metrics"""

        insights = []

        if len(metrics) < 2:
            return insights

        corr_matrix = df[metrics].corr()

        for i, m1 in enumerate(metrics):
            for j, m2 in enumerate(metrics):
                if i >= j:
                    continue

                corr = corr_matrix.loc[m1, m2]

                if abs(corr) > 0.7:
                    direction = "positively" if corr > 0 else "negatively"

                    insights.append(Insight(
                        type=InsightType.CORRELATION,
                        title=f"{m1} and {m2} are {direction} correlated",
                        description=f"When {m1} increases, {m2} tends to "
                                   f"{'increase' if corr > 0 else 'decrease'}. "
                                   f"Correlation strength: {abs(corr):.2f}",
                        importance=abs(corr),
                        data_points=[{
                            "metric1": m1,
                            "metric2": m2,
                            "correlation": corr
                        }],
                        visualization={"type": "scatter", "x": m1, "y": m2}
                    ))

        return insights

    def _find_distribution_insights(
        self,
        df: pd.DataFrame,
        metrics: List[str]
    ) -> List[Insight]:
        """Analyze distributions for insights"""

        insights = []

        for metric in metrics:
            values = df[metric].dropna()

            if len(values) < 10:
                continue

            # Check for skewness
            skewness = stats.skew(values)

            if abs(skewness) > 1:
                direction = "right" if skewness > 0 else "left"

                insights.append(Insight(
                    type=InsightType.DISTRIBUTION,
                    title=f"{metric} distribution is skewed {direction}",
                    description=f"The distribution of {metric} is heavily "
                               f"skewed to the {direction}, indicating "
                               f"{'many low values with few high outliers' if skewness > 0 else 'many high values with few low outliers'}.",
                    importance=min(abs(skewness) / 3, 0.7),
                    data_points=[{
                        "skewness": skewness,
                        "mean": values.mean(),
                        "median": values.median()
                    }],
                    visualization={"type": "histogram", "metric": metric}
                ))

        return insights

    def _find_comparisons(
        self,
        df: pd.DataFrame,
        metrics: List[str],
        dimension: str
    ) -> List[Insight]:
        """Compare metrics across dimensions"""

        insights = []

        for metric in metrics:
            grouped = df.groupby(dimension)[metric].agg(['mean', 'sum', 'count'])

            if len(grouped) < 2:
                continue

            # Find best and worst performers
            best = grouped['sum'].idxmax()
            worst = grouped['sum'].idxmin()

            if best != worst:
                best_val = grouped.loc[best, 'sum']
                worst_val = grouped.loc[worst, 'sum']
                diff_pct = ((best_val - worst_val) / worst_val) * 100

                if diff_pct > 50:  # Significant difference
                    insights.append(Insight(
                        type=InsightType.COMPARISON,
                        title=f"Large {metric} gap between {dimension}s",
                        description=f"{best} leads in {metric} with {best_val:,.0f}, "
                                   f"while {worst} has only {worst_val:,.0f} - "
                                   f"a {diff_pct:.0f}% difference.",
                        importance=min(diff_pct / 200, 0.9),
                        data_points=[{
                            "best": {"name": best, "value": best_val},
                            "worst": {"name": worst, "value": worst_val},
                            "difference_pct": diff_pct
                        }],
                        visualization={"type": "bar", "dimension": dimension, "metric": metric}
                    ))

        return insights

    def _find_drivers(
        self,
        df: pd.DataFrame,
        target_metric: str,
        dimensions: List[str]
    ) -> List[Insight]:
        """Find what drives a metric"""

        insights = []

        for dim in dimensions:
            if df[dim].dtype == 'object' or df[dim].nunique() < 20:
                grouped = df.groupby(dim)[target_metric].sum()
                contribution = grouped / grouped.sum() * 100

                top_contributor = contribution.idxmax()
                top_pct = contribution.max()

                if top_pct > 30:  # Significant contributor
                    insights.append(Insight(
                        type=InsightType.DRIVER,
                        title=f"{top_contributor} drives {target_metric}",
                        description=f"{top_contributor} accounts for {top_pct:.1f}% "
                                   f"of total {target_metric}.",
                        importance=top_pct / 100,
                        data_points=[{
                            "driver": top_contributor,
                            "contribution_pct": top_pct,
                            "dimension": dim
                        }],
                        actions=[f"Focus on {top_contributor}", f"Analyze {dim} breakdown"]
                    ))

        return insights
```

## Generating Insight Narratives

```python
def generate_insight_narrative(insights: List[Insight]) -> str:
    """Generate a narrative summary of insights"""

    client = anthropic.Anthropic()

    insights_text = "\n".join([
        f"- {i.title}: {i.description} (importance: {i.importance:.2f})"
        for i in insights[:5]
    ])

    prompt = f"""Create a brief executive summary based on these data insights:

{insights_text}

Requirements:
- 2-3 paragraphs
- Lead with the most important finding
- Connect related insights
- End with recommended actions

Write in a professional, business style."""

    response = client.messages.create(
        model="claude-3-sonnet-20240229",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )

    return response.content[0].text
```

## Conclusion

Automated insight generation transforms raw data into actionable intelligence. Combine statistical analysis with AI-powered narrative generation to surface the most important patterns in your data.
