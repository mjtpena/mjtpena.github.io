---
title: "Prompt Engineering Fundamentals for Azure OpenAI"
author: Michael John Pena
draft: false
date: 2023-03-02
tags:
  - Azure
  - OpenAI
  - AI
  - Prompt Engineering
  - GPT

---

I wrote "Prompt Engineering Fundamentals for Azure OpenAI" to share practical, production-minded guidance on this topic.

## The Anatomy of a Good Prompt

Effective prompts have clear structure:

```python
import openai

def create_structured_prompt():
    """Example of a well-structured prompt."""
    system_message = """You are a senior data engineer specializing in Azure.
You provide concise, accurate technical guidance.
When uncertain, you say so rather than guessing.
Format code examples with proper syntax highlighting."""

    user_message = """Task: Write a Python script to load CSV files from Azure Blob Storage into Azure SQL Database.

Requirements:
- Use Azure SDK for Python
- Handle files up to 1GB
- Include error handling
- Log progress

Constraints:
- Python 3.9+
- No external orchestration tools"""

    response = openai.ChatCompletion.create(
        engine="gpt-35-turbo",
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message}
        ],
        temperature=0.3,
        max_tokens=2000
    )

    return response.choices[0].message.content
```

## Key Prompting Techniques

### 1. Few-Shot Learning

Provide examples of desired input/output:

```python
few_shot_prompt = """Convert natural language to SQL.

Example 1:
Input: Show me all customers from Sydney
Output: SELECT * FROM customers WHERE city = 'Sydney';

Example 2:
Input: Count orders by product category
Output: SELECT category, COUNT(*) as order_count FROM orders o JOIN products p ON o.product_id = p.id GROUP BY category;

Example 3:
Input: Find the top 5 customers by total spend last month
Output: SELECT c.name, SUM(o.amount) as total_spend
FROM customers c
JOIN orders o ON c.id = o.customer_id
WHERE o.order_date >= DATEADD(month, -1, GETDATE())
GROUP BY c.name
ORDER BY total_spend DESC
LIMIT 5;

Now convert:
Input: {user_query}
Output:"""

def text_to_sql(user_query: str) -> str:
    response = openai.Completion.create(
        engine="gpt-35-turbo-instruct",
        prompt=few_shot_prompt.format(user_query=user_query),
        temperature=0,
        max_tokens=500,
        stop=["\n\n"]
    )
    return response.choices[0].text.strip()
```

### 2. Chain of Thought

Ask the model to reason step by step:

```python
cot_prompt = """Analyze this data pipeline issue and recommend a solution.

Pipeline: Sales data flows from Salesforce -> Azure Data Factory -> ADLS -> Databricks -> Synapse -> Power BI

Problem: Reports show yesterday's data is missing, but no pipeline failures logged.

Think through this step by step:
1. First, identify possible failure points
2. Then, consider silent failure scenarios
3. Next, suggest diagnostic queries
4. Finally, recommend a solution

Analysis:"""

def analyze_pipeline_issue(problem_description: str) -> str:
    response = openai.ChatCompletion.create(
        engine="gpt-35-turbo",
        messages=[
            {"role": "system", "content": "You are a data engineer debugging pipelines."},
            {"role": "user", "content": cot_prompt}
        ],
        temperature=0.2
    )
    return response.choices[0].message.content
```

### 3. Role Assignment

Define a specific persona:

```python
personas = {
    "security_reviewer": """You are a cloud security architect reviewing Azure configurations.
Focus on: identity, network isolation, encryption, compliance.
Flag issues by severity: CRITICAL, HIGH, MEDIUM, LOW.
Provide specific remediation steps.""",

    "cost_optimizer": """You are an Azure cost optimization specialist.
Analyze resource usage patterns.
Identify right-sizing opportunities.
Suggest reserved instance purchases.
Calculate potential savings with specific numbers.""",

    "data_modeler": """You are a senior data architect designing dimensional models.
Apply Kimball methodology.
Consider query patterns and performance.
Document business keys and relationships.
Suggest indexing strategies."""
}

def get_expert_analysis(content: str, persona: str) -> str:
    response = openai.ChatCompletion.create(
        engine="gpt-35-turbo",
        messages=[
            {"role": "system", "content": personas[persona]},
            {"role": "user", "content": content}
        ],
        temperature=0.3
    )
    return response.choices[0].message.content
```

### 4. Output Formatting

Be explicit about expected format:

```python
structured_output_prompt = """Analyze the following error log and return your analysis as JSON.

Error Log:
{error_log}

Return JSON with this exact structure:
{{
    "error_type": "string - category of error",
    "root_cause": "string - likely cause",
    "affected_components": ["list", "of", "components"],
    "severity": "CRITICAL|HIGH|MEDIUM|LOW",
    "recommended_actions": [
        {{"action": "string", "priority": 1}},
        {{"action": "string", "priority": 2}}
    ],
    "requires_immediate_attention": true/false
}}

JSON Output:"""

import json

def analyze_error(error_log: str) -> dict:
    response = openai.ChatCompletion.create(
        engine="gpt-35-turbo",
        messages=[
            {"role": "user", "content": structured_output_prompt.format(error_log=error_log)}
        ],
        temperature=0
    )

    # Parse and validate JSON
    try:
        return json.loads(response.choices[0].message.content)
    except json.JSONDecodeError:
        return {"error": "Failed to parse response"}
```

## Temperature and Parameters

Understanding model parameters:

```python
# Temperature: Controls randomness (0-2)
# Lower = more deterministic, Higher = more creative

use_cases = {
    "code_generation": {"temperature": 0, "top_p": 1},        # Deterministic
    "creative_writing": {"temperature": 0.9, "top_p": 0.95},  # Creative
    "data_analysis": {"temperature": 0.2, "top_p": 1},        # Mostly deterministic
    "brainstorming": {"temperature": 0.7, "top_p": 0.9},      # Balanced
}

def generate_with_params(prompt: str, use_case: str) -> str:
    params = use_cases.get(use_case, {"temperature": 0.5, "top_p": 1})

    response = openai.ChatCompletion.create(
        engine="gpt-35-turbo",
        messages=[{"role": "user", "content": prompt}],
        **params,
        max_tokens=1000
    )
    return response.choices[0].message.content
```

## Prompt Templates

Build reusable templates:

```python
from string import Template

class PromptTemplate:
    def __init__(self, template: str, required_vars: list[str]):
        self.template = Template(template)
        self.required_vars = required_vars

    def format(self, **kwargs) -> str:
        missing = set(self.required_vars) - set(kwargs.keys())
        if missing:
            raise ValueError(f"Missing required variables: {missing}")
        return self.template.substitute(**kwargs)

# Define templates
SQL_REVIEW_TEMPLATE = PromptTemplate(
    template="""Review this SQL query for:
- Performance issues
- Security vulnerabilities
- Best practice violations

Database: $database_type
Query:
```sql
$query
```

Provide specific line-by-line feedback.""",
    required_vars=["database_type", "query"]
)

# Use template
prompt = SQL_REVIEW_TEMPLATE.format(
    database_type="Azure SQL Database",
    query="SELECT * FROM users WHERE name = '" + user_input + "'"
)
```

## Testing Prompts

Validate prompt reliability:

```python
def test_prompt_consistency(prompt: str, test_cases: list[dict], expected_format: callable) -> dict:
    """Test a prompt across multiple inputs."""
    results = {
        "total": len(test_cases),
        "passed": 0,
        "failed": 0,
        "failures": []
    }

    for case in test_cases:
        formatted_prompt = prompt.format(**case["input"])

        response = openai.ChatCompletion.create(
            engine="gpt-35-turbo",
            messages=[{"role": "user", "content": formatted_prompt}],
            temperature=0
        )

        output = response.choices[0].message.content

        if expected_format(output, case.get("expected")):
            results["passed"] += 1
        else:
            results["failed"] += 1
            results["failures"].append({
                "input": case["input"],
                "output": output,
                "expected": case.get("expected")
            })

    return results
```

## Best Practices Summary

1. **Be specific**: Vague prompts get vague results
2. **Provide context**: Include relevant background information
3. **Show examples**: Few-shot learning improves consistency
4. **Constrain output**: Specify format, length, style
5. **Iterate**: Test and refine prompts based on results
6. **Version control**: Track prompt changes like code

Prompt engineering is a skill that improves with practice. Start with these fundamentals and iterate based on your specific use cases.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
