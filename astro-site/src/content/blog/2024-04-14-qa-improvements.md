---
title: "Q&A Improvements in Power BI: Natural Language Analytics"
author: "Michael John Peña"
draft: false
date: 2024-04-14
tags: ["Power BI", "Q&A", "Natural Language", "AI", "Analytics"]

---

I wrote "Q&A Improvements in Power BI: Natural Language Analytics" to share practical, production-minded guidance on this topic.

Power BI Q&A enables users to ask questions in natural language and receive instant visualizations. Recent improvements make it more accurate and powerful.

## Q&A Capabilities

```python
QA_FEATURES_2024 = {
    "understanding": [
        "Better handling of business terminology",
        "Improved date/time parsing",
        "Context awareness from previous questions",
        "Disambiguation dialogs"
    ],
    "visualization": [
        "Smarter chart type selection",
        "Automatic formatting",
        "Follow-up question suggestions",
        "Comparative visualizations"
    ],
    "customization": [
        "Synonyms and linguistic schema",
        "Featured questions",
        "Suggest questions",
        "Custom phrasings"
    ]
}
```

## Configuring Q&A for Better Results

```python
# Q&A Linguistic Schema

LINGUISTIC_SCHEMA = {
    "entities": {
        "Revenue": {
            "name": "Revenue",
            "state": "Binding",
            "type": "Currency",
            "source": {"table": "Sales", "column": "Amount"},
            "synonyms": ["sales", "income", "earnings", "total sales"]
        },
        "Customer": {
            "name": "Customer",
            "state": "Binding",
            "type": "String",
            "source": {"table": "Customers", "column": "CustomerName"},
            "synonyms": ["client", "account", "buyer"]
        },
        "OrderDate": {
            "name": "Order Date",
            "state": "Binding",
            "type": "DateTime",
            "source": {"table": "Orders", "column": "OrderDate"},
            "synonyms": ["date", "when", "order time", "purchase date"]
        }
    },
    "relationships": {
        "sold_to": {
            "predicate": "sold to",
            "subject": "Product",
            "object": "Customer"
        },
        "purchased_by": {
            "predicate": "purchased by",
            "subject": "Product",
            "object": "Customer"
        }
    }
}
```

## Training Q&A

```python
# Examples to train Q&A understanding

QA_TRAINING_EXAMPLES = {
    "simple_queries": [
        {
            "question": "total sales",
            "expected": {
                "measure": "Total Sales",
                "visual_type": "card"
            }
        },
        {
            "question": "sales by region",
            "expected": {
                "measure": "Total Sales",
                "dimension": "Region",
                "visual_type": "bar_chart"
            }
        },
        {
            "question": "monthly sales trend",
            "expected": {
                "measure": "Total Sales",
                "dimension": "Date (Month)",
                "visual_type": "line_chart"
            }
        }
    ],

    "comparative_queries": [
        {
            "question": "compare sales this year vs last year",
            "expected": {
                "measures": ["Total Sales", "SPLY Sales"],
                "dimension": "Month",
                "visual_type": "column_chart"
            }
        },
        {
            "question": "which region had the highest growth",
            "expected": {
                "measure": "YoY Growth",
                "dimension": "Region",
                "visual_type": "table",
                "sort": "descending"
            }
        }
    ],

    "filter_queries": [
        {
            "question": "sales in North region last quarter",
            "expected": {
                "measure": "Total Sales",
                "filters": {
                    "Region": "North",
                    "Date": "Last Quarter"
                }
            }
        }
    ]
}
```

## Implementing Custom Q&A Handler

```python
import anthropic
from typing import Dict, List, Optional

class EnhancedQAHandler:
    """Enhanced Q&A processing with LLM assistance"""

    def __init__(self, schema: Dict):
        self.client = anthropic.Anthropic()
        self.schema = schema

    def process_question(self, question: str) -> Dict:
        """Process natural language question"""

        # Parse question to understand intent
        intent = self._parse_intent(question)

        # Map to data model
        mapping = self._map_to_model(intent)

        # Generate visualization config
        viz_config = self._generate_visualization(mapping)

        return {
            "question": question,
            "intent": intent,
            "mapping": mapping,
            "visualization": viz_config
        }

    def _parse_intent(self, question: str) -> Dict:
        """Use LLM to understand question intent"""

        prompt = f"""Analyze this business question:
"{question}"

Extract:
1. What metric(s) are being asked about?
2. What dimension(s) to group by?
3. Any filters or conditions?
4. Time period if mentioned?
5. Comparison if any?

Schema available:
{self._format_schema()}

Return JSON with: metrics, dimensions, filters, time_period, comparison"""

        response = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        return self._parse_json(response.content[0].text)

    def _map_to_model(self, intent: Dict) -> Dict:
        """Map intent to data model"""

        mapping = {
            "measures": [],
            "dimensions": [],
            "filters": []
        }

        # Map metrics to measures
        for metric in intent.get("metrics", []):
            measure = self._find_measure(metric)
            if measure:
                mapping["measures"].append(measure)

        # Map dimensions
        for dim in intent.get("dimensions", []):
            column = self._find_column(dim)
            if column:
                mapping["dimensions"].append(column)

        # Map filters
        for filter_name, filter_value in intent.get("filters", {}).items():
            column = self._find_column(filter_name)
            if column:
                mapping["filters"].append({
                    "column": column,
                    "value": filter_value
                })

        return mapping

    def _find_measure(self, name: str) -> Optional[str]:
        """Find measure in schema by name or synonym"""
        name_lower = name.lower()

        for measure_name, measure_info in self.schema.get("measures", {}).items():
            if name_lower == measure_name.lower():
                return measure_name
            if name_lower in [s.lower() for s in measure_info.get("synonyms", [])]:
                return measure_name

        return None

    def _find_column(self, name: str) -> Optional[str]:
        """Find column in schema by name or synonym"""
        name_lower = name.lower()

        for table_name, table_info in self.schema.get("tables", {}).items():
            for col_name, col_info in table_info.get("columns", {}).items():
                if name_lower == col_name.lower():
                    return f"{table_name}[{col_name}]"
                if name_lower in [s.lower() for s in col_info.get("synonyms", [])]:
                    return f"{table_name}[{col_name}]"

        return None

    def _generate_visualization(self, mapping: Dict) -> Dict:
        """Determine best visualization for the query"""

        num_measures = len(mapping["measures"])
        num_dimensions = len(mapping["dimensions"])
        has_time = any("date" in d.lower() for d in mapping["dimensions"])

        if num_measures == 1 and num_dimensions == 0:
            return {"type": "card", "measure": mapping["measures"][0]}

        elif num_measures == 1 and num_dimensions == 1:
            if has_time:
                return {
                    "type": "line_chart",
                    "x": mapping["dimensions"][0],
                    "y": mapping["measures"][0]
                }
            else:
                return {
                    "type": "bar_chart",
                    "category": mapping["dimensions"][0],
                    "value": mapping["measures"][0]
                }

        elif num_measures > 1 and num_dimensions == 1:
            return {
                "type": "clustered_bar",
                "category": mapping["dimensions"][0],
                "values": mapping["measures"]
            }

        else:
            return {
                "type": "table",
                "columns": mapping["dimensions"] + mapping["measures"]
            }

    def _format_schema(self) -> str:
        import json
        return json.dumps(self.schema, indent=2)

    def _parse_json(self, text: str) -> Dict:
        import json
        try:
            start = text.find('{')
            end = text.rfind('}') + 1
            return json.loads(text[start:end])
        except:
            return {}

# Usage
schema = {
    "measures": {
        "Total Sales": {"synonyms": ["revenue", "sales", "income"]},
        "Order Count": {"synonyms": ["orders", "number of orders"]},
        "Avg Order Value": {"synonyms": ["aov", "average order"]}
    },
    "tables": {
        "Sales": {
            "columns": {
                "Region": {"synonyms": ["territory", "area"]},
                "Product": {"synonyms": ["item", "sku"]},
                "OrderDate": {"synonyms": ["date", "when"]}
            }
        }
    }
}

handler = EnhancedQAHandler(schema)
result = handler.process_question("What were total sales by region last month?")
print(result)
```

## Follow-up Question Generation

```python
def generate_followup_questions(
    current_question: str,
    current_result: Dict,
    schema: Dict
) -> List[str]:
    """Generate relevant follow-up questions"""

    client = anthropic.Anthropic()

    prompt = f"""Given this Q&A interaction:
Question: {current_question}
Result showed: {current_result.get('summary', 'data visualization')}

Available data:
- Measures: {list(schema.get('measures', {}).keys())}
- Dimensions: Regional, Product, Time

Generate 3 natural follow-up questions a user might ask next.
Consider:
1. Drilling down for more detail
2. Comparing to another period
3. Exploring related metrics"""

    response = client.messages.create(
        model="claude-3-haiku-20240307",
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}]
    )

    # Parse questions from response
    questions = []
    for line in response.content[0].text.split('\n'):
        line = line.strip().lstrip('0123456789.- ')
        if line and '?' in line:
            questions.append(line)

    return questions[:3]
```

## Conclusion

Power BI Q&A empowers users to explore data conversationally. Configure linguistic schemas, train with examples, and consider adding LLM enhancement for the best natural language analytics experience.

