---
title: "GPT-4 for Data Analysis: Practical Applications"
author: Michael John Pena
draft: false
date: 2023-03-20
tags:
  - OpenAI
  - AI
  - GPT-4
  - Data Analysis
  - Analytics

---

I wrote "GPT-4 for Data Analysis: Practical Applications" to share practical, production-minded guidance on this topic.

## Natural Language to SQL

GPT-4 excels at understanding complex data questions:

```python
class NL2SQLEngine:
    """Convert natural language to SQL with GPT-4."""

    def __init__(self, client, schema_provider):
        self.client = client
        self.schema_provider = schema_provider

    async def query(
        self,
        question: str,
        database: str,
        validate: bool = True
    ) -> dict:
        """Convert question to SQL and optionally execute."""

        # Get database schema
        schema = await self.schema_provider.get_schema(database)

        prompt = f"""Convert this question to SQL.

Database Schema:
{schema}

Question: {question}

Requirements:
- Use appropriate JOINs
- Handle NULL values
- Use aliases for readability
- Include comments for complex logic
- Optimize for performance

Return only the SQL query."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a SQL expert. Generate correct, efficient SQL."},
                {"role": "user", "content": prompt}
            ],
            temperature=0
        )

        sql = self._extract_sql(response.content)

        result = {
            "question": question,
            "sql": sql,
            "model": "gpt-4"
        }

        if validate:
            result["validation"] = await self._validate_sql(sql, schema)

        return result

    def _extract_sql(self, content: str) -> str:
        """Extract SQL from response."""
        # Handle markdown code blocks
        if "```sql" in content:
            start = content.find("```sql") + 6
            end = content.find("```", start)
            return content[start:end].strip()
        elif "```" in content:
            start = content.find("```") + 3
            end = content.find("```", start)
            return content[start:end].strip()
        return content.strip()

    async def _validate_sql(self, sql: str, schema: str) -> dict:
        """Validate generated SQL."""
        prompt = f"""Validate this SQL query.

Schema:
{schema}

Query:
{sql}

Check for:
1. Syntax errors
2. Invalid table/column references
3. Type mismatches
4. Potential performance issues
5. SQL injection risks

Return JSON:
{{"valid": true/false, "issues": ["issue1", ...], "suggestions": ["suggestion1", ...]}}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return {"valid": True, "raw": response.content}
```

## Data Interpretation

```python
class DataInterpreter:
    """Interpret data results with GPT-4."""

    async def interpret_results(
        self,
        data: list[dict],
        question: str,
        context: str = ""
    ) -> str:
        """Interpret query results in natural language."""

        # Format data for prompt
        if len(data) > 20:
            data_sample = data[:10] + [{"...": f"({len(data) - 20} more rows)"}] + data[-10:]
        else:
            data_sample = data

        import json
        data_str = json.dumps(data_sample, indent=2, default=str)

        prompt = f"""Interpret these data results.

Original Question: {question}
{f'Context: {context}' if context else ''}

Results ({len(data)} rows):
{data_str}

Provide:
1. Direct answer to the question
2. Key insights from the data
3. Notable patterns or anomalies
4. Caveats or limitations"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def statistical_summary(
        self,
        data: list[dict],
        focus_columns: list[str] = None
    ) -> dict:
        """Generate statistical summary."""

        import json
        data_str = json.dumps(data[:100], indent=2, default=str)

        focus = f"Focus on columns: {', '.join(focus_columns)}" if focus_columns else ""

        prompt = f"""Analyze this dataset statistically.

Data (sample of {len(data)} rows):
{data_str}

{focus}

Provide comprehensive statistical analysis including:
1. Data types and distributions
2. Central tendencies (mean, median, mode)
3. Spread (std dev, range, IQR)
4. Correlations between numeric columns
5. Categorical breakdowns
6. Outliers and anomalies
7. Data quality issues

Return as structured JSON."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )

        return {"analysis": response.content}
```

## Analysis Code Generation

```python
class AnalysisCodeGenerator:
    """Generate data analysis code with GPT-4."""

    async def generate_pandas_analysis(
        self,
        data_description: str,
        analysis_goal: str
    ) -> str:
        """Generate pandas analysis code."""

        prompt = f"""Write Python code to analyze this data.

Data Description:
{data_description}

Analysis Goal: {analysis_goal}

Requirements:
- Use pandas for data manipulation
- Include data loading (assume CSV file)
- Add data cleaning steps
- Perform the requested analysis
- Create relevant visualizations with matplotlib/seaborn
- Add comments explaining each step
- Handle potential errors"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a data scientist writing clean, well-documented Python code."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2
        )

        return response.content

    async def generate_visualization(
        self,
        data_description: str,
        chart_request: str
    ) -> str:
        """Generate visualization code."""

        prompt = f"""Create a visualization for this data.

Data: {data_description}
Request: {chart_request}

Generate Python code using matplotlib/seaborn that:
- Creates the requested chart
- Includes proper labels and titles
- Uses appropriate colors
- Handles edge cases
- Is ready to save as image"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Anomaly Detection

```python
class AnomalyAnalyzer:
    """Detect anomalies with GPT-4 reasoning."""

    async def detect_anomalies(
        self,
        data: list[dict],
        context: str = ""
    ) -> dict:
        """Detect anomalies in data."""

        import json
        data_str = json.dumps(data[:50], indent=2, default=str)

        prompt = f"""Analyze this data for anomalies.

{f'Context: {context}' if context else ''}

Data:
{data_str}

Identify:
1. Statistical outliers
2. Pattern breaks
3. Unexpected values
4. Missing data patterns
5. Suspicious combinations

For each anomaly:
- Description
- Severity (high/medium/low)
- Possible causes
- Recommended action

Return as JSON."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )

        return {"anomalies": response.content}

    async def explain_metric_change(
        self,
        metric_name: str,
        current_value: float,
        previous_value: float,
        context_data: dict = None
    ) -> str:
        """Explain why a metric changed."""

        change_pct = ((current_value - previous_value) / previous_value * 100) if previous_value else 0

        context_str = ""
        if context_data:
            import json
            context_str = f"\nContext data:\n{json.dumps(context_data, indent=2)}"

        prompt = f"""Explain this metric change.

Metric: {metric_name}
Previous: {previous_value}
Current: {current_value}
Change: {change_pct:.1f}%
{context_str}

Provide:
1. Possible explanations for this change
2. What additional data would help confirm the cause
3. Whether this change is concerning
4. Recommended next steps"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Report Generation

```python
class ReportGenerator:
    """Generate data analysis reports with GPT-4."""

    async def generate_executive_summary(
        self,
        analyses: list[dict],
        audience: str = "executives"
    ) -> str:
        """Generate executive summary from analyses."""

        import json
        analyses_str = json.dumps(analyses, indent=2, default=str)

        prompt = f"""Create an executive summary from these analyses.

Analyses:
{analyses_str}

Audience: {audience}

Structure:
1. Key Findings (3-5 bullet points)
2. Metrics Overview (table format)
3. Trends and Patterns
4. Concerns and Risks
5. Recommendations

Keep it concise and actionable. Use business language appropriate for {audience}."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def generate_data_story(
        self,
        data_journey: list[dict],
        narrative_style: str = "analytical"
    ) -> str:
        """Create a narrative data story."""

        import json
        journey_str = json.dumps(data_journey, indent=2, default=str)

        prompt = f"""Create a data story from this analysis journey.

Analysis Journey:
{journey_str}

Style: {narrative_style}

Create a compelling narrative that:
- Starts with the business question
- Walks through the discovery process
- Highlights key insights with data
- Builds to conclusions
- Ends with clear recommendations

Make it engaging while maintaining accuracy."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Complete Analysis Pipeline

```python
class DataAnalysisPipeline:
    """End-to-end data analysis with GPT-4."""

    def __init__(self, client):
        self.nl2sql = NL2SQLEngine(client, schema_provider)
        self.interpreter = DataInterpreter()
        self.code_gen = AnalysisCodeGenerator()
        self.anomaly = AnomalyAnalyzer()
        self.reporter = ReportGenerator()

    async def analyze(
        self,
        question: str,
        database: str
    ) -> dict:
        """Complete analysis from question to report."""

        # Step 1: Convert to SQL
        sql_result = await self.nl2sql.query(question, database)

        # Step 2: Execute query (using your DB connection)
        data = await self.execute_sql(sql_result["sql"])

        # Step 3: Interpret results
        interpretation = await self.interpreter.interpret_results(
            data, question
        )

        # Step 4: Check for anomalies
        anomalies = await self.anomaly.detect_anomalies(data)

        # Step 5: Generate report
        report = await self.reporter.generate_executive_summary([
            {"question": question, "findings": interpretation},
            {"anomalies": anomalies}
        ])

        return {
            "question": question,
            "sql": sql_result["sql"],
            "row_count": len(data),
            "interpretation": interpretation,
            "anomalies": anomalies,
            "report": report
        }
```

GPT-4 transforms data analysis from technical SQL writing to conversational exploration. The ability to interpret results and generate insights makes data accessible to everyone.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
