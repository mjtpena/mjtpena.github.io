---
title: "Automated Report Generation with AI"
author: "Michael John Peña"
draft: false
date: 2024-04-05
tags: ["AI", "Reporting", "Data", "Automation", "Microsoft Fabric"]

---

I wrote "Automated Report Generation with AI" to share practical, production-minded guidance on this topic.

AI can transform raw data into polished, narrative reports. This guide covers building automated report generation systems that combine data analysis with natural language generation.

## Report Generation Architecture

```python
from dataclasses import dataclass
from typing import List, Dict, Any
from datetime import datetime
import anthropic

@dataclass
class ReportSection:
    title: str
    content: str
    visualizations: List[Dict]
    data_tables: List[Dict]

@dataclass
class Report:
    title: str
    generated_at: datetime
    sections: List[ReportSection]
    summary: str
    key_insights: List[str]

class AIReportGenerator:
    """Generate reports from data using AI"""

    def __init__(self):
        self.client = anthropic.Anthropic()

    def generate_report(
        self,
        data: Dict[str, Any],
        report_type: str,
        audience: str = "executive"
    ) -> Report:
        """Generate a complete report from data"""

        # Analyze data
        analysis = self._analyze_data(data)

        # Generate sections
        sections = self._generate_sections(analysis, report_type)

        # Generate summary
        summary = self._generate_executive_summary(analysis, audience)

        # Extract key insights
        insights = self._extract_key_insights(analysis)

        return Report(
            title=f"{report_type.title()} Report - {datetime.now().strftime('%B %Y')}",
            generated_at=datetime.now(),
            sections=sections,
            summary=summary,
            key_insights=insights
        )

    def _analyze_data(self, data: Dict) -> Dict:
        """Analyze data and compute statistics"""
        # This would connect to your data analysis pipeline
        return {
            "summary_stats": self._compute_statistics(data),
            "trends": self._identify_trends(data),
            "anomalies": self._detect_anomalies(data),
            "comparisons": self._compute_comparisons(data)
        }

    def _generate_sections(
        self,
        analysis: Dict,
        report_type: str
    ) -> List[ReportSection]:
        """Generate report sections"""

        section_templates = {
            "sales": ["overview", "regional_performance", "product_analysis", "forecast"],
            "financial": ["summary", "revenue", "expenses", "profitability"],
            "operational": ["kpis", "efficiency", "capacity", "issues"]
        }

        sections = []
        for section_name in section_templates.get(report_type, ["overview"]):
            section = self._generate_section(section_name, analysis)
            sections.append(section)

        return sections

    def _generate_section(
        self,
        section_name: str,
        analysis: Dict
    ) -> ReportSection:
        """Generate a single report section"""

        prompt = f"""Generate a report section about "{section_name}" based on this data analysis:

{self._format_analysis(analysis)}

Write in a professional, business style. Include:
1. Key observations (2-3 paragraphs)
2. Important numbers with context
3. Trends and their implications

Format the response as clear, readable paragraphs."""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )

        return ReportSection(
            title=section_name.replace("_", " ").title(),
            content=response.content[0].text,
            visualizations=[],  # Would include chart specifications
            data_tables=[]
        )

    def _generate_executive_summary(
        self,
        analysis: Dict,
        audience: str
    ) -> str:
        """Generate executive summary"""

        prompt = f"""Write an executive summary for {audience} audience based on this analysis:

{self._format_analysis(analysis)}

Requirements:
- Maximum 3 paragraphs
- Lead with the most important finding
- Include key numbers
- End with recommended actions

Write in a confident, professional tone."""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text

    def _extract_key_insights(self, analysis: Dict) -> List[str]:
        """Extract bullet-point insights"""

        prompt = f"""Based on this analysis, provide 5 key insights as bullet points:

{self._format_analysis(analysis)}

Each insight should be:
- One sentence
- Specific (include numbers)
- Actionable when possible"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        # Parse bullet points
        insights = []
        for line in response.content[0].text.split('\n'):
            line = line.strip().lstrip('•-*123456789. ')
            if line:
                insights.append(line)

        return insights[:5]

    def _format_analysis(self, analysis: Dict) -> str:
        """Format analysis data for prompts"""
        import json
        return json.dumps(analysis, indent=2, default=str)

    def _compute_statistics(self, data: Dict) -> Dict:
        """Placeholder for statistics computation"""
        return data.get("statistics", {})

    def _identify_trends(self, data: Dict) -> List[Dict]:
        """Placeholder for trend identification"""
        return data.get("trends", [])

    def _detect_anomalies(self, data: Dict) -> List[Dict]:
        """Placeholder for anomaly detection"""
        return data.get("anomalies", [])

    def _compute_comparisons(self, data: Dict) -> Dict:
        """Placeholder for comparison computation"""
        return data.get("comparisons", {})
```

## Narrative Generation

```python
class NarrativeGenerator:
    """Generate natural language narratives from data"""

    def __init__(self):
        self.client = anthropic.Anthropic()

    def generate_trend_narrative(
        self,
        metric_name: str,
        current_value: float,
        previous_value: float,
        trend_direction: str
    ) -> str:
        """Generate narrative for a trend"""

        change_pct = ((current_value - previous_value) / previous_value) * 100

        prompt = f"""Write a one-sentence narrative about this metric change:

Metric: {metric_name}
Current: {current_value:,.2f}
Previous: {previous_value:,.2f}
Change: {change_pct:+.1f}%
Trend: {trend_direction}

Write naturally, as you would in a business report. Include the percentage change and appropriate context."""

        response = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=100,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text.strip()

    def generate_comparison_narrative(
        self,
        items: List[Dict],
        metric_name: str
    ) -> str:
        """Generate narrative comparing multiple items"""

        sorted_items = sorted(items, key=lambda x: x["value"], reverse=True)

        prompt = f"""Write a brief narrative comparing these {metric_name} values:

{self._format_items(sorted_items)}

Include:
- The top performer
- The range between highest and lowest
- Any notable patterns

Keep it to 2-3 sentences."""

        response = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text.strip()

    def _format_items(self, items: List[Dict]) -> str:
        return "\n".join(f"- {item['name']}: {item['value']:,.2f}" for item in items)

# Usage example
narrator = NarrativeGenerator()

# Generate trend narrative
trend_text = narrator.generate_trend_narrative(
    metric_name="Monthly Revenue",
    current_value=1250000,
    previous_value=1100000,
    trend_direction="increasing"
)
print(trend_text)
# Output: "Monthly revenue rose to $1.25M, a 13.6% increase from the previous period, continuing the upward trend."

# Generate comparison narrative
comparison_text = narrator.generate_comparison_narrative(
    items=[
        {"name": "North Region", "value": 450000},
        {"name": "South Region", "value": 380000},
        {"name": "East Region", "value": 320000},
        {"name": "West Region", "value": 100000}
    ],
    metric_name="regional sales"
)
print(comparison_text)
```

## Report Templates

```python
class ReportTemplate:
    """Define report templates with placeholders"""

    def __init__(self, template_str: str):
        self.template = template_str

    def render(self, data: Dict, narrator: NarrativeGenerator) -> str:
        """Render template with data and AI-generated narratives"""

        rendered = self.template

        # Replace simple placeholders
        for key, value in data.items():
            if isinstance(value, (int, float)):
                rendered = rendered.replace(f"{{{{{key}}}}}", f"{value:,.2f}")
            else:
                rendered = rendered.replace(f"{{{{{key}}}}}", str(value))

        # Generate narratives for special placeholders
        import re
        narrative_pattern = r'\{\{narrative:(\w+)\}\}'

        for match in re.finditer(narrative_pattern, rendered):
            narrative_key = match.group(1)
            if narrative_key in data:
                narrative_data = data[narrative_key]
                narrative = narrator.generate_trend_narrative(**narrative_data)
                rendered = rendered.replace(match.group(0), narrative)

        return rendered

# Example template
monthly_report_template = ReportTemplate("""
# Monthly Sales Report - {{month}} {{year}}

## Executive Summary

{{narrative:revenue_trend}}

## Key Metrics

| Metric | Value | vs Last Month |
|--------|-------|---------------|
| Total Revenue | ${{total_revenue}} | {{revenue_change}}% |
| Orders | {{total_orders}} | {{orders_change}}% |
| Avg Order Value | ${{avg_order_value}} | {{aov_change}}% |

## Regional Performance

{{narrative:regional_comparison}}

## Recommendations

Based on this month's performance:
1. {{recommendation_1}}
2. {{recommendation_2}}
3. {{recommendation_3}}
""")
```

## Scheduling Reports

```python
from datetime import datetime, timedelta
import asyncio

class ReportScheduler:
    """Schedule and distribute automated reports"""

    def __init__(self, generator: AIReportGenerator):
        self.generator = generator
        self.schedules = []

    def schedule_report(
        self,
        report_type: str,
        frequency: str,  # "daily", "weekly", "monthly"
        recipients: List[str],
        data_source: callable
    ):
        """Schedule a recurring report"""
        self.schedules.append({
            "report_type": report_type,
            "frequency": frequency,
            "recipients": recipients,
            "data_source": data_source,
            "last_run": None
        })

    async def run_scheduled_reports(self):
        """Run all scheduled reports that are due"""
        for schedule in self.schedules:
            if self._is_due(schedule):
                await self._run_report(schedule)

    def _is_due(self, schedule: Dict) -> bool:
        """Check if report is due"""
        if schedule["last_run"] is None:
            return True

        now = datetime.now()
        last = schedule["last_run"]

        if schedule["frequency"] == "daily":
            return (now - last) >= timedelta(days=1)
        elif schedule["frequency"] == "weekly":
            return (now - last) >= timedelta(weeks=1)
        elif schedule["frequency"] == "monthly":
            return (now - last) >= timedelta(days=30)

        return False

    async def _run_report(self, schedule: Dict):
        """Generate and distribute report"""
        # Get data
        data = schedule["data_source"]()

        # Generate report
        report = self.generator.generate_report(
            data=data,
            report_type=schedule["report_type"]
        )

        # Distribute
        await self._distribute_report(report, schedule["recipients"])

        # Update last run
        schedule["last_run"] = datetime.now()

    async def _distribute_report(self, report: Report, recipients: List[str]):
        """Distribute report to recipients"""
        # Implement email, Teams, Slack distribution
        print(f"Distributing report to {recipients}")
```

## Conclusion

AI-powered report generation automates the translation of data into actionable narratives. Combine data analysis, narrative generation, and templates for consistent, insightful reports.

