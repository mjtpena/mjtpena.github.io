---
title: "Smart Narratives in Power BI: Automated Data Storytelling"
description: "Smart Narratives automatically generate text summaries of your data, transforming numbers into stories. This guide covers implementation and customization."
author: "Michael John Peña"
draft: false
date: 2024-04-13
tags: ["Power BI", "Smart Narratives", "AI", "Data Storytelling", "Analytics"]
---

Smart Narratives automatically generate text summaries of your data, transforming numbers into stories. This guide covers implementation and customization.

## Understanding Smart Narratives

```python
SMART_NARRATIVE_FEATURES = {
    "automatic_summaries": [
        "Key metrics and trends",
        "Comparisons and rankings",
        "Anomaly callouts",
        "Percentage changes"
    ],
    "customization": [
        "Define custom phrases",
        "Control which metrics appear",
        "Set conditional text",
        "Add dynamic calculations"
    ],
    "formatting": [
        "Bullet points and lists",
        "Bold/italic emphasis",
        "Value formatting",
        "Conditional colors"
    ]
}
```

## Creating Smart Narratives

```python
# Smart Narrative configuration

NARRATIVE_CONFIGURATION = {
    "basic_setup": {
        "visual_type": "smartNarrative",
        "data_bindings": {
            "summarize_values": ["Total Sales", "Order Count", "Avg Order Value"]
        },
        "settings": {
            "auto_generate": True,
            "max_sentences": 5
        }
    },

    "custom_template": """
    Total sales for {{selected_period}} reached {{Total Sales:$#,##0}},
    {{#if YoY_positive}}up{{else}}down{{/if}} {{YoY Change:%}} compared to last year.

    Key highlights:
    - Top region: {{Top Region}} with {{Top Region Sales:$#,##0}}
    - Best product: {{Top Product}} ({{Top Product Units:#,##0}} units)
    - Average order value: {{Avg Order Value:$#,##0}}

    {{#if has_anomalies}}
    Note: Unusual activity detected in {{Anomaly Region}} on {{Anomaly Date}}.
    {{/if}}
    """
}
```

## Building Custom Narratives

```python
from typing import List, Dict
import anthropic

class SmartNarrativeBuilder:
    """Build smart narratives from data"""

    def __init__(self):
        self.client = anthropic.Anthropic()

    def generate_narrative(
        self,
        metrics: Dict[str, float],
        comparisons: Dict[str, Dict],
        context: str
    ) -> str:
        """Generate narrative from metrics and comparisons"""

        prompt = f"""Generate a professional business narrative based on this data:

Context: {context}

Current Metrics:
{self._format_metrics(metrics)}

Comparisons:
{self._format_comparisons(comparisons)}

Requirements:
- Write 3-4 sentences
- Lead with the most important finding
- Include specific numbers with proper formatting
- Mention trends and changes
- Use professional business language

Narrative:"""

        response = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text.strip()

    def generate_highlights(
        self,
        data: List[Dict],
        metric_name: str,
        top_n: int = 3
    ) -> str:
        """Generate highlights for top performers"""

        sorted_data = sorted(data, key=lambda x: x[metric_name], reverse=True)
        top = sorted_data[:top_n]
        bottom = sorted_data[-1:]

        prompt = f"""Create a brief highlight summary:

Top {top_n} by {metric_name}:
{self._format_list(top, metric_name)}

Lowest:
{self._format_list(bottom, metric_name)}

Write 2-3 sentences highlighting the top performers and noting any concerns about the lowest."""

        response = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text.strip()

    def explain_change(
        self,
        metric_name: str,
        current: float,
        previous: float,
        contributing_factors: List[Dict]
    ) -> str:
        """Explain why a metric changed"""

        change_pct = ((current - previous) / previous) * 100

        prompt = f"""{metric_name} changed from {previous:,.2f} to {current:,.2f} ({change_pct:+.1f}%).

Contributing factors:
{self._format_factors(contributing_factors)}

Explain this change in 2-3 sentences, focusing on the main drivers."""

        response = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text.strip()

    def _format_metrics(self, metrics: Dict) -> str:
        return "\n".join(f"- {k}: {v:,.2f}" for k, v in metrics.items())

    def _format_comparisons(self, comparisons: Dict) -> str:
        lines = []
        for metric, data in comparisons.items():
            change = ((data["current"] - data["previous"]) / data["previous"]) * 100
            lines.append(f"- {metric}: {data['current']:,.2f} vs {data['previous']:,.2f} ({change:+.1f}%)")
        return "\n".join(lines)

    def _format_list(self, items: List[Dict], metric: str) -> str:
        return "\n".join(
            f"- {item.get('name', 'Item')}: {item[metric]:,.2f}"
            for item in items
        )

    def _format_factors(self, factors: List[Dict]) -> str:
        return "\n".join(
            f"- {f['factor']}: {f['impact']:+,.2f} ({f['percentage']:+.1f}%)"
            for f in factors
        )

# Usage
builder = SmartNarrativeBuilder()

narrative = builder.generate_narrative(
    metrics={
        "Total Revenue": 4250000,
        "Order Count": 12500,
        "Avg Order Value": 340
    },
    comparisons={
        "Total Revenue": {"current": 4250000, "previous": 3800000},
        "Order Count": {"current": 12500, "previous": 11200}
    },
    context="Q1 2024 Sales Performance Report"
)
print(narrative)
```

## Conditional Narratives

```python
# Templates with conditional logic

CONDITIONAL_TEMPLATES = {
    "performance_summary": {
        "template": """
        {{period_name}} performance:
        {{#if above_target}}
        Excellent results! We exceeded target by {{excess_pct}}%, reaching {{actual_value}}.
        {{else if near_target}}
        We came close to our target, achieving {{achievement_pct}}% of goal.
        {{else}}
        We fell short of our target, achieving only {{achievement_pct}}% of goal. Key improvement areas:
        {{#each improvement_areas}}
        - {{this}}
        {{/each}}
        {{/if}}
        """,

        "data_needed": [
            "period_name",
            "actual_value",
            "target_value",
            "improvement_areas"
        ]
    },

    "trend_description": {
        "template": """
        {{metric_name}} has been {{trend_direction}} over the past {{period_count}} periods.
        {{#if consistent}}
        The trend has been consistent, with an average {{trend_direction}}ly change of {{avg_change}}.
        {{else}}
        However, the trend shows some volatility:
        - Highest: {{max_value}} ({{max_period}})
        - Lowest: {{min_value}} ({{min_period}})
        {{/if}}
        """,

        "data_needed": [
            "metric_name",
            "trend_direction",
            "period_count",
            "avg_change",
            "max_value",
            "min_value"
        ]
    }
}

def apply_conditional_template(template: str, data: Dict) -> str:
    """Apply conditional logic to template"""
    import re

    result = template

    # Handle if/else blocks
    if_pattern = r'\{\{#if (\w+)\}\}(.*?)\{\{else\}\}(.*?)\{\{/if\}\}'

    def replace_if(match):
        condition = match.group(1)
        if_true = match.group(2)
        if_false = match.group(3)
        return if_true.strip() if data.get(condition) else if_false.strip()

    result = re.sub(if_pattern, replace_if, result, flags=re.DOTALL)

    # Handle simple placeholders
    for key, value in data.items():
        if isinstance(value, (int, float)):
            result = result.replace(f"{{{{{key}}}}}", f"{value:,.2f}")
        else:
            result = result.replace(f"{{{{{key}}}}}", str(value))

    return result.strip()
```

## Dynamic Narrative Updates

```python
class DynamicNarrativeManager:
    """Manage narratives that update with data changes"""

    def __init__(self):
        self.builder = SmartNarrativeBuilder()
        self.cache = {}

    def get_narrative(
        self,
        report_id: str,
        filters: Dict,
        force_refresh: bool = False
    ) -> str:
        """Get narrative for current filter context"""

        cache_key = f"{report_id}:{hash(frozenset(filters.items()))}"

        if not force_refresh and cache_key in self.cache:
            return self.cache[cache_key]

        # Fetch current data based on filters
        data = self._fetch_data(report_id, filters)

        # Generate appropriate narrative
        if self._is_comparison_view(filters):
            narrative = self._generate_comparison_narrative(data)
        elif self._is_drill_down(filters):
            narrative = self._generate_detail_narrative(data)
        else:
            narrative = self._generate_overview_narrative(data)

        self.cache[cache_key] = narrative
        return narrative

    def _is_comparison_view(self, filters: Dict) -> bool:
        return "compare_to" in filters

    def _is_drill_down(self, filters: Dict) -> bool:
        return len(filters) > 2

    def _fetch_data(self, report_id: str, filters: Dict) -> Dict:
        # Implement data fetching logic
        return {}

    def _generate_comparison_narrative(self, data: Dict) -> str:
        return self.builder.generate_narrative(
            metrics=data.get("metrics", {}),
            comparisons=data.get("comparisons", {}),
            context="Comparison Analysis"
        )

    def _generate_detail_narrative(self, data: Dict) -> str:
        return self.builder.generate_highlights(
            data=data.get("details", []),
            metric_name=data.get("primary_metric", "value"),
            top_n=3
        )

    def _generate_overview_narrative(self, data: Dict) -> str:
        return self.builder.generate_narrative(
            metrics=data.get("metrics", {}),
            comparisons=data.get("comparisons", {}),
            context="Overview"
        )
```

## Conclusion

Smart Narratives transform data into accessible stories. Combine Power BI's built-in capabilities with custom AI-generated narratives for comprehensive automated reporting.
