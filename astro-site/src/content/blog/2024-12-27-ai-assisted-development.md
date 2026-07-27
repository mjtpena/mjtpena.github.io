---
title: "AI-Assisted Development: How AI is Changing How We Build"
author: Michael John Peña
draft: false
date: 2024-12-27
tags:
  - AI
  - Development
  - GitHub Copilot
  - Productivity
  - Coding

---

I wrote "AI-Assisted Development: How AI is Changing How We Build" to share practical, production-minded guidance on this topic.

## The AI Development Stack

```
┌─────────────────────────────────────────────────────────────┐
│                   AI-Assisted Development                    │
├─────────────────────────────────────────────────────────────┤
│  Planning          │ AI helps design and architect           │
├────────────────────┼────────────────────────────────────────┤
│  Coding            │ Copilot, code completion, generation   │
├────────────────────┼────────────────────────────────────────┤
│  Testing           │ Test generation, coverage analysis      │
├────────────────────┼────────────────────────────────────────┤
│  Debugging         │ Error explanation, fix suggestions      │
├────────────────────┼────────────────────────────────────────┤
│  Documentation     │ Auto-generated docs, explanations       │
├────────────────────┼────────────────────────────────────────┤
│  Review            │ Code review assistance, suggestions     │
└─────────────────────────────────────────────────────────────┘
```

## AI Coding Assistants in Practice

### Code Generation

```python
# Prompt: Create a function to validate data quality in a pandas DataFrame

# AI generates:
def validate_data_quality(
    df: pd.DataFrame,
    required_columns: list,
    max_null_percentage: float = 0.05,
    unique_columns: list = None
) -> dict:
    """
    Validate data quality for a DataFrame.

    Args:
        df: Input DataFrame to validate
        required_columns: Columns that must exist
        max_null_percentage: Maximum allowed null percentage per column
        unique_columns: Columns that should have unique values

    Returns:
        Dictionary with validation results
    """
    results = {
        "passed": True,
        "issues": [],
        "metrics": {}
    }

    # Check required columns
    missing_columns = set(required_columns) - set(df.columns)
    if missing_columns:
        results["passed"] = False
        results["issues"].append(f"Missing columns: {missing_columns}")

    # Check null percentages
    for col in df.columns:
        null_pct = df[col].isnull().mean()
        results["metrics"][f"{col}_null_pct"] = null_pct

        if null_pct > max_null_percentage:
            results["passed"] = False
            results["issues"].append(
                f"Column {col} has {null_pct:.1%} nulls (max: {max_null_percentage:.1%})"
            )

    # Check uniqueness
    if unique_columns:
        for col in unique_columns:
            if col in df.columns:
                duplicate_count = df[col].duplicated().sum()
                if duplicate_count > 0:
                    results["passed"] = False
                    results["issues"].append(
                        f"Column {col} has {duplicate_count} duplicates"
                    )

    return results
```

### SQL Generation

```python
# Using AI to generate complex SQL from natural language

class AIQueryBuilder:
    """Generate SQL queries using AI."""

    def __init__(self, schema_context: str):
        self.schema = schema_context
        self.client = AIClient()

    async def generate_query(
        self,
        natural_language: str,
        dialect: str = "spark_sql"
    ) -> dict:
        """Generate SQL from natural language description."""

        prompt = f"""Generate a {dialect} query for this request.

Schema:
{self.schema}

Request: {natural_language}

Requirements:
- Use efficient patterns
- Include appropriate filters
- Add comments explaining logic
- Handle edge cases

Return only the SQL query."""

        response = await self.client.generate(prompt)

        # Validate generated SQL
        validation = await self.validate_sql(response, dialect)

        return {
            "query": response,
            "validation": validation,
            "estimated_cost": await self.estimate_cost(response)
        }

    async def explain_query(self, sql: str) -> str:
        """Explain what a SQL query does."""

        prompt = f"""Explain this SQL query in plain English:

{sql}

Include:
1. What the query does overall
2. Key operations (joins, aggregations, filters)
3. Any potential performance concerns
4. What the output will look like"""

        return await self.client.generate(prompt)

# Example usage
builder = AIQueryBuilder(schema_context)

result = await builder.generate_query(
    "Find customers who made purchases in the last 30 days "
    "but haven't purchased in the previous 60 days, "
    "grouped by their acquisition channel"
)

print(result["query"])
# Output: Well-formatted SQL with comments
```

### Test Generation

```python
class AITestGenerator:
    """Generate tests using AI assistance."""

    async def generate_tests(
        self,
        function_code: str,
        test_framework: str = "pytest"
    ) -> str:
        """Generate test cases for a function."""

        prompt = f"""Generate comprehensive {test_framework} tests for this function:

{function_code}

Include:
1. Happy path tests
2. Edge cases
3. Error handling tests
4. Parameterized tests where appropriate
5. Clear test names that describe the scenario

Use mocking where appropriate for external dependencies."""

        return await self.client.generate(prompt)

    async def generate_data_quality_tests(
        self,
        table_schema: dict,
        business_rules: list
    ) -> str:
        """Generate data quality tests."""

        prompt = f"""Generate data quality tests for this table:

Schema: {table_schema}
Business Rules: {business_rules}

Use Great Expectations framework.
Cover: completeness, uniqueness, validity, consistency"""

        return await self.client.generate(prompt)

# Example
tests = await generator.generate_tests("""
def calculate_customer_lifetime_value(
    transactions: pd.DataFrame,
    customer_id: str,
    as_of_date: datetime
) -> float:
    customer_txns = transactions[
        (transactions['customer_id'] == customer_id) &
        (transactions['date'] <= as_of_date)
    ]
    return customer_txns['amount'].sum()
""")

# AI generates comprehensive test suite
```

### Documentation Generation

```python
class AIDocGenerator:
    """Generate documentation using AI."""

    async def generate_docstring(self, function_code: str) -> str:
        """Generate docstring for a function."""

        prompt = f"""Generate a comprehensive docstring for this function:

{function_code}

Use Google-style docstrings.
Include: description, args, returns, raises, examples."""

        return await self.client.generate(prompt)

    async def generate_readme(self, project_structure: str) -> str:
        """Generate README for a project."""

        prompt = f"""Generate a README.md for this project:

{project_structure}

Include:
- Project description
- Installation instructions
- Usage examples
- Configuration
- Contributing guidelines"""

        return await self.client.generate(prompt)

    async def explain_code(self, code: str, audience: str = "junior") -> str:
        """Explain code for different audiences."""

        prompt = f"""Explain this code for a {audience} developer:

{code}

Adjust complexity of explanation to the audience level."""

        return await self.client.generate(prompt)
```

## Productivity Impact

```python
ai_development_impact = {
    "code_completion": {
        "acceptance_rate": "30-40%",
        "time_saved": "20-30% on typing",
        "best_for": "Boilerplate, patterns, syntax"
    },

    "code_generation": {
        "quality": "70-80% production-ready",
        "review_needed": "Always",
        "best_for": "First drafts, exploration"
    },

    "test_generation": {
        "coverage_increase": "20-40%",
        "quality": "Good starting point",
        "best_for": "Increasing coverage quickly"
    },

    "documentation": {
        "time_saved": "50-70%",
        "quality": "Good first draft",
        "best_for": "Consistent, comprehensive docs"
    },

    "debugging": {
        "resolution_time": "30-50% faster",
        "best_for": "Error explanation, fix suggestions"
    }
}

# Overall impact
overall_impact = {
    "productivity_increase": "25-50%",
    "quality_impact": "Neutral to positive (with review)",
    "learning_curve": "Minimal for basic usage"
}
```

## Best Practices

```python
ai_development_best_practices = {
    "do": [
        "Review all AI-generated code carefully",
        "Use AI for first drafts and iteration",
        "Provide clear context and requirements",
        "Use AI to explain unfamiliar code",
        "Generate tests alongside code",
        "Keep AI suggestions as starting points"
    ],

    "dont": [
        "Blindly accept generated code",
        "Skip code review for AI code",
        "Expect perfect output first time",
        "Use for security-critical code without review",
        "Share sensitive data in prompts",
        "Over-rely on AI for architecture decisions"
    ],

    "optimize_for": [
        "Clear, specific prompts",
        "Iterative refinement",
        "Context provision",
        "Review and validation",
        "Learning from suggestions"
    ]
}
```

## The Future of AI-Assisted Development

```python
future_capabilities = {
    "2024": [
        "Code completion",
        "Simple generation",
        "Documentation",
        "Test generation"
    ],

    "2025_predictions": [
        "Multi-file refactoring",
        "Architecture suggestions",
        "Automated code review",
        "Natural language programming",
        "AI pair programming"
    ],

    "further_future": [
        "AI software engineering",
        "Self-improving code",
        "Automated optimization",
        "Intent-based development"
    ]
}
```

AI-assisted development is here to stay. Learn to use these tools effectively while maintaining code quality and understanding.

## Resources

- [GitHub Copilot](https://github.com/features/copilot)
- [Claude for Coding](https://www.anthropic.com/claude)
- [AI Coding Best Practices](https://docs.github.com/en/copilot)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
