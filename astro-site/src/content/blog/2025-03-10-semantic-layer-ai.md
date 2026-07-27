---
title: "Semantic Layer for AI: Building Business-Ready Data Interfaces"
author: Michael John Peña
draft: false
date: 2025-03-10
tags:
  - Semantic Layer
  - AI
  - Data
  - Business Intelligence
  - Architecture

---

I wrote "Semantic Layer for AI: Building Business-Ready Data Interfaces" to share practical, production-minded guidance on this topic.

## AI-Ready Semantic Layer

```python
from dataclasses import dataclass
from typing import Optional
import yaml

@dataclass
class Metric:
    name: str
    description: str
    calculation: str
    dimensions: list[str]
    filters: Optional[dict] = None

@dataclass
class Dimension:
    name: str
    description: str
    source_column: str
    hierarchy: Optional[list[str]] = None

class SemanticLayer:
    def __init__(self, config_path: str):
        self.metrics = {}
        self.dimensions = {}
        self.load_config(config_path)

    def load_config(self, path: str):
        """Load semantic layer definitions."""
        with open(path) as f:
            config = yaml.safe_load(f)

        for metric in config['metrics']:
            self.metrics[metric['name']] = Metric(**metric)

        for dim in config['dimensions']:
            self.dimensions[dim['name']] = Dimension(**dim)

    def get_metric_sql(self, metric_name: str, dimensions: list[str]) -> str:
        """Generate SQL for a metric with dimensions."""
        metric = self.metrics[metric_name]
        dim_columns = [self.dimensions[d].source_column for d in dimensions]

        return f"""
        SELECT
            {', '.join(dim_columns)},
            {metric.calculation} as {metric.name}
        FROM {metric.source_table}
        GROUP BY {', '.join(dim_columns)}
        """

    def get_context_for_ai(self, question: str) -> str:
        """Generate context about available metrics for AI."""
        relevant_metrics = self.find_relevant_metrics(question)
        context = "Available metrics:\n"
        for metric in relevant_metrics:
            context += f"- {metric.name}: {metric.description}\n"
            context += f"  Dimensions: {', '.join(metric.dimensions)}\n"
        return context

    def natural_language_query(self, question: str) -> str:
        """Convert natural language to semantic layer query."""
        context = self.get_context_for_ai(question)
        # Use LLM to map question to metrics and dimensions
        return self.llm_translate(question, context)
```

A semantic layer enables AI to understand business terminology and generate accurate queries.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
