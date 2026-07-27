---
title: "Natural Language Queries for Data: Beyond Simple Q&A"
author: "Michael John Peña"
draft: false
date: 2024-04-15
tags: ["AI", "Natural Language", "Data", "Analytics", "LLM"]

---

I wrote "Natural Language Queries for Data: Beyond Simple Q&A" to share practical, production-minded guidance on this topic.

Natural language interfaces for data go beyond simple Q&A to enable complex analytical conversations. This guide explores advanced natural language query patterns.

## Evolution of NL Data Interfaces

```python
from enum import Enum
from dataclasses import dataclass
from typing import List, Dict, Optional

class QueryComplexity(Enum):
    SIMPLE = "simple"  # "Show me sales"
    FILTERED = "filtered"  # "Sales in 2024"
    COMPARATIVE = "comparative"  # "Sales vs last year"
    ANALYTICAL = "analytical"  # "Why did sales drop?"
    PREDICTIVE = "predictive"  # "What will sales be next month?"
    CONVERSATIONAL = "conversational"  # Multi-turn dialogue

@dataclass
class NLQuery:
    raw_text: str
    complexity: QueryComplexity
    intent: str
    entities: Dict[str, str]
    context: Optional[Dict] = None
```

## Advanced Query Understanding

```python
import anthropic
from typing import List, Dict, Tuple

class AdvancedNLQueryProcessor:
    """Process complex natural language queries"""

    def __init__(self, data_context: Dict):
        self.client = anthropic.Anthropic()
        self.context = data_context
        self.conversation_history = []

    def process(self, query: str) -> Dict:
        """Process query with full context awareness"""

        # Classify query type
        query_type = self._classify_query(query)

        # Extract entities and intent
        parsed = self._parse_query(query, query_type)

        # Handle based on type
        if query_type == QueryComplexity.ANALYTICAL:
            result = self._handle_analytical(query, parsed)
        elif query_type == QueryComplexity.PREDICTIVE:
            result = self._handle_predictive(query, parsed)
        elif query_type == QueryComplexity.CONVERSATIONAL:
            result = self._handle_conversational(query, parsed)
        else:
            result = self._handle_standard(query, parsed)

        # Update conversation history
        self.conversation_history.append({
            "query": query,
            "result": result
        })

        return result

    def _classify_query(self, query: str) -> QueryComplexity:
        """Classify query complexity"""

        prompt = f"""Classify this data query:
"{query}"

Categories:
- simple: Basic metric request ("show me sales")
- filtered: With conditions ("sales in 2024")
- comparative: Comparing values ("sales vs last year")
- analytical: Asking why/how ("why did sales drop")
- predictive: Future-looking ("what will sales be")
- conversational: References previous context ("break that down by region")

Previous context: {self._get_recent_context()}

Return only the category name."""

        response = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=20,
            messages=[{"role": "user", "content": prompt}]
        )

        category = response.content[0].text.strip().lower()
        return QueryComplexity(category) if category in [e.value for e in QueryComplexity] else QueryComplexity.SIMPLE

    def _parse_query(self, query: str, query_type: QueryComplexity) -> Dict:
        """Extract structured information from query"""

        prompt = f"""Parse this {query_type.value} query:
"{query}"

Data context:
{self._format_context()}

Extract as JSON:
{{
    "intent": "what user wants to know",
    "metrics": ["list of metrics mentioned"],
    "dimensions": ["grouping dimensions"],
    "filters": {{"dimension": "value"}},
    "time_reference": "any time period",
    "comparison": "what's being compared if any",
    "references_previous": true/false
}}"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        return self._parse_json(response.content[0].text)

    def _handle_analytical(self, query: str, parsed: Dict) -> Dict:
        """Handle analytical/diagnostic queries"""

        # For "why" questions, we need to analyze contributing factors
        prompt = f"""Analyze this question: "{query}"

Based on the parsed intent: {parsed}
And data context: {self._format_context()}

Generate an analytical response structure:
1. Identify the key metric to analyze
2. List factors that could explain the observation
3. Suggest data points to examine
4. Recommend visualizations

Return as JSON with: metric, factors, data_points, visualizations"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}]
        )

        analysis = self._parse_json(response.content[0].text)

        return {
            "query_type": "analytical",
            "parsed": parsed,
            "analysis": analysis,
            "response_type": "multi_visual",
            "suggested_actions": [
                "View trend analysis",
                "See contributing factors",
                "Drill into segments"
            ]
        }

    def _handle_predictive(self, query: str, parsed: Dict) -> Dict:
        """Handle predictive/forecasting queries"""

        return {
            "query_type": "predictive",
            "parsed": parsed,
            "response_type": "forecast_visual",
            "model_recommendation": "time_series_forecast",
            "confidence_required": True,
            "note": "Predictions are based on historical patterns"
        }

    def _handle_conversational(self, query: str, parsed: Dict) -> Dict:
        """Handle queries that reference conversation history"""

        # Get previous context
        previous = self.conversation_history[-1] if self.conversation_history else None

        if previous:
            # Resolve references to previous query
            resolved = self._resolve_references(query, previous)
            return self._handle_standard(resolved, parsed)

        return self._handle_standard(query, parsed)

    def _handle_standard(self, query: str, parsed: Dict) -> Dict:
        """Handle standard queries"""

        return {
            "query_type": "standard",
            "parsed": parsed,
            "sql": self._generate_sql(parsed),
            "visualization": self._recommend_visualization(parsed)
        }

    def _resolve_references(self, query: str, previous: Dict) -> str:
        """Resolve pronouns and references to previous context"""

        prompt = f"""Resolve references in this follow-up query:
Current: "{query}"
Previous query: "{previous['query']}"
Previous result context: {previous.get('result', {}).get('parsed', {})}

Rewrite the current query to be self-contained, replacing pronouns and references.
Return only the resolved query."""

        response = self.client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=100,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text.strip()

    def _generate_sql(self, parsed: Dict) -> str:
        """Generate SQL from parsed query"""
        # Simplified SQL generation
        metrics = parsed.get("metrics", ["COUNT(*)"])
        dimensions = parsed.get("dimensions", [])
        filters = parsed.get("filters", {})

        select_clause = ", ".join(dimensions + [f"SUM({m})" for m in metrics])
        group_clause = ", ".join(dimensions) if dimensions else ""
        where_clause = " AND ".join(f"{k} = '{v}'" for k, v in filters.items())

        sql = f"SELECT {select_clause} FROM data"
        if where_clause:
            sql += f" WHERE {where_clause}"
        if group_clause:
            sql += f" GROUP BY {group_clause}"

        return sql

    def _recommend_visualization(self, parsed: Dict) -> Dict:
        """Recommend visualization type"""
        dims = len(parsed.get("dimensions", []))
        metrics = len(parsed.get("metrics", []))

        if metrics == 1 and dims == 0:
            return {"type": "kpi_card"}
        elif dims == 1 and metrics == 1:
            return {"type": "bar_chart"}
        elif dims == 1 and metrics > 1:
            return {"type": "grouped_bar"}
        elif "time" in str(parsed.get("dimensions", [])).lower():
            return {"type": "line_chart"}
        else:
            return {"type": "table"}

    def _get_recent_context(self) -> str:
        if not self.conversation_history:
            return "No previous context"
        recent = self.conversation_history[-3:]
        return str([h["query"] for h in recent])

    def _format_context(self) -> str:
        import json
        return json.dumps(self.context, indent=2)

    def _parse_json(self, text: str) -> Dict:
        import json
        try:
            start = text.find('{')
            end = text.rfind('}') + 1
            return json.loads(text[start:end])
        except:
            return {}
```

## Multi-Turn Conversations

```python
class ConversationalDataAssistant:
    """Maintain conversation state for data exploration"""

    def __init__(self, data_context: Dict):
        self.processor = AdvancedNLQueryProcessor(data_context)
        self.state = {
            "current_dataset": None,
            "current_filters": {},
            "current_view": None,
            "drill_path": []
        }

    def chat(self, message: str) -> Dict:
        """Process message in conversation context"""

        # Check for navigation commands
        if self._is_navigation(message):
            return self._handle_navigation(message)

        # Check for refinement
        if self._is_refinement(message):
            return self._handle_refinement(message)

        # Standard query processing
        result = self.processor.process(message)

        # Update state based on result
        self._update_state(result)

        return result

    def _is_navigation(self, message: str) -> bool:
        nav_keywords = ["go back", "undo", "start over", "reset"]
        return any(kw in message.lower() for kw in nav_keywords)

    def _is_refinement(self, message: str) -> bool:
        refine_keywords = ["add filter", "remove", "also show", "exclude"]
        return any(kw in message.lower() for kw in refine_keywords)

    def _handle_navigation(self, message: str) -> Dict:
        if "go back" in message.lower() and self.state["drill_path"]:
            self.state["drill_path"].pop()
            return {"action": "navigate_back", "state": self.state}
        elif "reset" in message.lower():
            self.state = {
                "current_dataset": None,
                "current_filters": {},
                "current_view": None,
                "drill_path": []
            }
            return {"action": "reset", "state": self.state}
        return {"action": "unknown_navigation"}

    def _handle_refinement(self, message: str) -> Dict:
        # Add or modify filters based on refinement
        return self.processor.process(message)

    def _update_state(self, result: Dict):
        parsed = result.get("parsed", {})
        if parsed.get("filters"):
            self.state["current_filters"].update(parsed["filters"])
        if result.get("visualization"):
            self.state["current_view"] = result["visualization"]
```

## Conclusion

Natural language interfaces for data are evolving from simple Q&A to sophisticated conversational analytics. Build systems that understand context, handle follow-ups, and provide analytical insights beyond basic queries.

