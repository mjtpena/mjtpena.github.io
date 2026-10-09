---
title: "GenAI Impact Assessment: Measuring Real Business Value"
description: "When teams move from pilots to production, the question I hear most is: 'Did this deliver measurable business value?' From dozens of GenAI assessments this…"
author: "Michael John Peña"
draft: false
date: 2023-12-01
tags: ["AI", "GenAI", "ROI", "Business Value", "Assessment"]
---

When teams move from pilots to production, the question I hear most is: 'Did this deliver measurable business value?' From dozens of GenAI assessments this year, the frameworks that work focus on clear baselines, conservative attribution, and KPIs that map directly to revenue or cost reduction rather than vague productivity claims.

## The Impact Assessment Framework

## The Impact Assessment Framework

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from enum import Enum
from datetime import datetime

class ImpactCategory(Enum):
    PRODUCTIVITY = "Productivity"
    QUALITY = "Quality"
    COST = "Cost"
    REVENUE = "Revenue"
    EXPERIENCE = "Customer Experience"
    INNOVATION = "Innovation"

@dataclass
class ImpactMetric:
    name: str
    category: ImpactCategory
    baseline_value: float
    current_value: float
    unit: str
    measurement_method: str

    @property
    def improvement_percent(self) -> float:
        if self.baseline_value == 0:
            return 0
        return ((self.current_value - self.baseline_value) / self.baseline_value) * 100

@dataclass
class GenAIProject:
    name: str
    use_case: str
    start_date: datetime
    investment: float
    metrics: List[ImpactMetric] = field(default_factory=list)

    def calculate_roi(self, time_period_months: int = 12) -> Dict:
        """Calculate ROI for the project."""
        total_value = 0

        for metric in self.metrics:
            # Simplified value calculation
            if metric.category == ImpactCategory.COST:
                savings = metric.baseline_value - metric.current_value
                total_value += savings * time_period_months
            elif metric.category == ImpactCategory.PRODUCTIVITY:
                # Assume productivity translates to time savings
                time_saved = metric.improvement_percent / 100
                total_value += time_saved * 1000 * time_period_months  # Placeholder

        roi = ((total_value - self.investment) / self.investment) * 100
        payback_months = self.investment / (total_value / time_period_months) if total_value > 0 else float('inf')

        return {
            "total_value": total_value,
            "investment": self.investment,
            "roi_percent": roi,
            "payback_months": payback_months
        }
```

## Common Impact Metrics by Use Case

```python
use_case_metrics = {
    "customer_support_chatbot": {
        "metrics": [
            ImpactMetric(
                name="Average Handle Time",
                category=ImpactCategory.PRODUCTIVITY,
                baseline_value=8.5,  # minutes
                current_value=5.2,
                unit="minutes",
                measurement_method="CRM system logs"
            ),
            ImpactMetric(
                name="First Contact Resolution",
                category=ImpactCategory.QUALITY,
                baseline_value=65,  # percent
                current_value=78,
                unit="percent",
                measurement_method="Ticket resolution tracking"
            ),
            ImpactMetric(
                name="Cost per Interaction",
                category=ImpactCategory.COST,
                baseline_value=12.50,
                current_value=4.30,
                unit="USD",
                measurement_method="Cost accounting"
            ),
            ImpactMetric(
                name="Customer Satisfaction",
                category=ImpactCategory.EXPERIENCE,
                baseline_value=3.8,  # out of 5
                current_value=4.2,
                unit="CSAT score",
                measurement_method="Post-interaction surveys"
            )
        ],
        "typical_investment": 150000,
        "typical_payback_months": 8
    },
    "content_generation": {
        "metrics": [
            ImpactMetric(
                name="Content Production Time",
                category=ImpactCategory.PRODUCTIVITY,
                baseline_value=4,  # hours per piece
                current_value=1.5,
                unit="hours",
                measurement_method="Time tracking"
            ),
            ImpactMetric(
                name="Content Volume",
                category=ImpactCategory.PRODUCTIVITY,
                baseline_value=20,  # pieces per month
                current_value=80,
                unit="pieces/month",
                measurement_method="CMS records"
            ),
            ImpactMetric(
                name="Editorial Revision Cycles",
                category=ImpactCategory.QUALITY,
                baseline_value=3.2,
                current_value=1.8,
                unit="cycles",
                measurement_method="Workflow tracking"
            )
        ],
        "typical_investment": 50000,
        "typical_payback_months": 4
    },
    "code_assistance": {
        "metrics": [
            ImpactMetric(
                name="Code Completion Acceptance",
                category=ImpactCategory.PRODUCTIVITY,
                baseline_value=0,
                current_value=46,
                unit="percent",
                measurement_method="IDE telemetry"
            ),
            ImpactMetric(
                name="Developer Velocity",
                category=ImpactCategory.PRODUCTIVITY,
                baseline_value=100,  # baseline index
                current_value=155,
                unit="velocity index",
                measurement_method="Sprint metrics"
            ),
            ImpactMetric(
                name="Developer Satisfaction",
                category=ImpactCategory.EXPERIENCE,
                baseline_value=3.5,
                current_value=4.3,
                unit="score (1-5)",
                measurement_method="Survey"
            )
        ],
        "typical_investment": 30000,
        "typical_payback_months": 2
    }
}
```

## Assessment Process

```python
class GenAIImpactAssessment:
    """Structured process for assessing GenAI impact."""

    def __init__(self, project: GenAIProject):
        self.project = project
        self.assessment_phases = []

    def phase1_baseline(self) -> Dict:
        """Establish baseline metrics before AI implementation."""
        baseline_checklist = {
            "metrics_identified": False,
            "measurement_tools_ready": False,
            "baseline_data_collected": False,
            "stakeholders_aligned": False
        }

        return {
            "phase": "Baseline Establishment",
            "duration": "2-4 weeks",
            "activities": [
                "Identify key metrics aligned with business goals",
                "Set up measurement infrastructure",
                "Collect 4-6 weeks of baseline data",
                "Document current processes",
                "Align stakeholders on success criteria"
            ],
            "checklist": baseline_checklist
        }

    def phase2_pilot(self) -> Dict:
        """Run pilot and collect initial data."""
        return {
            "phase": "Pilot Measurement",
            "duration": "4-8 weeks",
            "activities": [
                "Deploy AI solution to pilot group",
                "Monitor adoption and usage",
                "Collect performance metrics",
                "Gather qualitative feedback",
                "Identify issues and iterate"
            ],
            "success_criteria": {
                "adoption_rate": ">60% of pilot users",
                "satisfaction_score": ">3.5/5",
                "no_critical_issues": True
            }
        }

    def phase3_scale(self) -> Dict:
        """Measure impact at scale."""
        return {
            "phase": "Scale Assessment",
            "duration": "3-6 months",
            "activities": [
                "Roll out to broader organization",
                "Continuous metric tracking",
                "A/B testing where possible",
                "Cost-benefit analysis",
                "ROI calculation"
            ],
            "deliverables": [
                "Impact dashboard",
                "ROI report",
                "Recommendations for optimization",
                "Business case for expansion"
            ]
        }

    def generate_report(self) -> str:
        """Generate impact assessment report."""
        roi_data = self.project.calculate_roi()

        report = f"""
# GenAI Impact Assessment Report

## Project: {self.project.name}
## Use Case: {self.project.use_case}
## Assessment Date: {datetime.now().strftime('%Y-%m-%d')}

## Executive Summary
Investment: ${self.project.investment:,.0f}
Total Value Generated: ${roi_data['total_value']:,.0f}
ROI: {roi_data['roi_percent']:.1f}%
Payback Period: {roi_data['payback_months']:.1f} months

## Detailed Metrics

| Metric | Category | Baseline | Current | Improvement |
|--------|----------|----------|---------|-------------|
"""
        for metric in self.project.metrics:
            report += f"| {metric.name} | {metric.category.value} | "
            report += f"{metric.baseline_value} {metric.unit} | "
            report += f"{metric.current_value} {metric.unit} | "
            report += f"{metric.improvement_percent:.1f}% |\n"

        return report
```

## Best Practices

```python
impact_assessment_best_practices = {
    "measurement": [
        "Define metrics before deployment",
        "Use control groups where possible",
        "Measure both quantitative and qualitative",
        "Account for learning curve effects"
    ],
    "attribution": [
        "Isolate AI impact from other changes",
        "Consider seasonal factors",
        "Document confounding variables",
        "Use statistical significance testing"
    ],
    "reporting": [
        "Align metrics with business objectives",
        "Present in business language",
        "Include both successes and challenges",
        "Provide actionable recommendations"
    ]
}
```

Tomorrow, we'll explore AI adoption patterns and what drives successful implementations!
