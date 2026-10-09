---
title: "Prompt Engineering Fundamentals for Azure OpenAI"
description: "Prompt engineering in January 2023 was the skill that separated AI features that worked in demos from AI features that worked in production. The gap: a demo…"
author: Michael John Peña
draft: false
date: 2023-01-12
tags:
  - Azure
  - OpenAI
  - Prompt Engineering
  - AI
  - NLP
---

Prompt engineering in January 2023 was the skill that separated AI features that worked in demos from AI features that worked in production. The gap: a demo prompt is crafted by someone who understands the model's behaviour and can iterate until the output looks right; a production prompt needs to work for a distribution of real user inputs, including the ambiguous, the adversarial, and the malformed. The fundamentals that I've found compound in practice: instruction clarity (state exactly what you want, not what you don't want—negative instructions are less reliable than positive ones); output format specification (telling the model the exact format of the expected output—JSON schema, numbered list, specific sentence structure—reduces format variation dramatically); context ordering (models attend more strongly to the beginning and end of prompts; put the most critical instructions at the start and the most important formatting instructions at the end); and role assignment (a system prompt that establishes a specific role—"You are a senior Azure architect reviewing infrastructure designs..."—narrows the distribution of responses to the domain where the model performs best). These four principles cover 80% of prompt engineering scenarios; chain-of-thought, self-consistency, and tool use patterns address the remaining 20%.

## The Anatomy of a Good Prompt

A well-structured prompt typically contains:

1. **Context**: Background information
2. **Instruction**: What you want the model to do
3. **Input Data**: The content to process
4. **Output Format**: How you want the response structured

```python
def create_structured_prompt(
    context: str,
    instruction: str,
    input_data: str,
    output_format: str
) -> str:
    """Create a well-structured prompt."""
    return f"""{context}

{instruction}

Input:
{input_data}

{output_format}"""

# Example
prompt = create_structured_prompt(
    context="You are a data analyst specializing in Azure services.",
    instruction="Analyze the following error log and identify the root cause.",
    input_data="""
2023-01-12 10:15:32 ERROR: Connection refused to Azure SQL Database
2023-01-12 10:15:33 WARN: Retry attempt 1 of 3
2023-01-12 10:15:35 ERROR: Connection refused to Azure SQL Database
2023-01-12 10:15:36 ERROR: Max retries exceeded
""",
    output_format="Provide your analysis in the following format:\n- Root Cause:\n- Impact:\n- Recommended Fix:"
)

print(prompt)
```

## Prompt Templates

Create reusable templates for common tasks:

```python
from string import Template
from typing import Dict, Any
from dataclasses import dataclass

@dataclass
class PromptTemplate:
    """Reusable prompt template."""
    name: str
    template: str
    description: str
    required_vars: list

    def format(self, **kwargs) -> str:
        """Format template with variables."""
        missing = set(self.required_vars) - set(kwargs.keys())
        if missing:
            raise ValueError(f"Missing required variables: {missing}")

        return Template(self.template).safe_substitute(**kwargs)

# Template library
TEMPLATES = {
    "summarize": PromptTemplate(
        name="summarize",
        template="""Summarize the following text in $length.

Text:
$text

Summary:""",
        description="Summarize text to specified length",
        required_vars=["text", "length"]
    ),

    "extract_entities": PromptTemplate(
        name="extract_entities",
        template="""Extract all $entity_types from the following text.
Return as a JSON array.

Text:
$text

JSON:""",
        description="Extract named entities from text",
        required_vars=["text", "entity_types"]
    ),

    "code_review": PromptTemplate(
        name="code_review",
        template="""Review the following $language code for:
- Bugs and errors
- Security vulnerabilities
- Performance issues
- Code style problems

Code:
```$language
$code
```

Provide specific line-by-line feedback.""",
        description="Review code for issues",
        required_vars=["language", "code"]
    ),

    "sql_generation": PromptTemplate(
        name="sql_generation",
        template="""Given the following database schema:
$schema

Write a SQL query to: $question

Only return the SQL query, no explanation.""",
        description="Generate SQL from natural language",
        required_vars=["schema", "question"]
    ),

    "classification": PromptTemplate(
        name="classification",
        template="""Classify the following text into one of these categories: $categories

Text: $text

Category:""",
        description="Classify text into predefined categories",
        required_vars=["text", "categories"]
    )
}

class PromptLibrary:
    """Library of prompt templates."""

    def __init__(self):
        self.templates = TEMPLATES.copy()

    def get(self, name: str) -> PromptTemplate:
        """Get a template by name."""
        if name not in self.templates:
            raise ValueError(f"Unknown template: {name}")
        return self.templates[name]

    def create_prompt(self, template_name: str, **kwargs) -> str:
        """Create a prompt from a template."""
        template = self.get(template_name)
        return template.format(**kwargs)

    def add_template(self, template: PromptTemplate):
        """Add a custom template."""
        self.templates[template.name] = template

    def list_templates(self) -> list:
        """List available templates."""
        return [
            {"name": t.name, "description": t.description}
            for t in self.templates.values()
        ]

## Usage
library = PromptLibrary()

## Generate a summary prompt
summary_prompt = library.create_prompt(
    "summarize",
    text="Azure OpenAI Service provides REST API access to OpenAI's powerful language models...",
    length="2-3 sentences"
)

## Generate a SQL query prompt
sql_prompt = library.create_prompt(
    "sql_generation",
    schema="""
    CREATE TABLE orders (id INT, customer_id INT, amount DECIMAL, order_date DATE);
    CREATE TABLE customers (id INT, name VARCHAR, email VARCHAR);
    """,
    question="Find customers who spent more than $1000 in total"
)
```

## Clear Instructions

Be explicit about what you want:

```python
# Bad: Vague instruction
bad_prompt = "Tell me about Azure"

# Good: Specific instruction
good_prompt = """Explain Azure App Service in 3 paragraphs:
1. What it is and its main purpose
2. Key features and capabilities
3. Common use cases and when to use it

Target audience: Software developers new to cloud computing."""

# Bad: Ambiguous output format
bad_prompt = "List the Azure services"

# Good: Explicit output format
good_prompt = """List the top 5 Azure compute services.
For each service, provide:
- Name
- One-sentence description
- Best use case

Format as a numbered list."""
```

## Role-Based Prompting

Assign a role to guide behavior:

```python
class RolePrompts:
    """Role-based prompt patterns."""

    ROLES = {
        "technical_writer": """You are a technical writer specializing in cloud documentation.
Your writing is clear, concise, and accessible to developers of all skill levels.
You use concrete examples and avoid jargon unless necessary.""",

        "security_expert": """You are a cloud security expert with 15 years of experience.
You think about threats, vulnerabilities, and compliance requirements.
You always consider the principle of least privilege.""",

        "architect": """You are a solutions architect specializing in Azure.
You think about scalability, reliability, cost optimization, and operational excellence.
You follow the Azure Well-Architected Framework.""",

        "code_reviewer": """You are a senior software engineer conducting code reviews.
You focus on correctness, maintainability, and performance.
You provide constructive feedback with specific suggestions.""",

        "data_scientist": """You are a data scientist experienced in machine learning and AI.
You understand statistics, model evaluation, and ML best practices.
You consider bias, fairness, and interpretability."""
    }

    @classmethod
    def create_prompt(cls, role: str, task: str, context: str = "") -> str:
        """Create a role-based prompt."""
        role_prompt = cls.ROLES.get(role, "You are a helpful assistant.")

        prompt = f"""{role_prompt}

Task: {task}"""

        if context:
            prompt += f"\n\nContext:\n{context}"

        return prompt

# Usage
prompt = RolePrompts.create_prompt(
    role="architect",
    task="Design a high-availability architecture for an e-commerce platform",
    context="Expected traffic: 10,000 concurrent users. Budget: $5,000/month."
)
```

## Delimiter Strategies

Use delimiters to clearly separate content:

```python
def create_delimited_prompt(
    instruction: str,
    content: str,
    delimiter_style: str = "triple_quotes"
) -> str:
    """Create prompt with clear delimiters."""

    delimiters = {
        "triple_quotes": ('"""', '"""'),
        "xml": ('<content>', '</content>'),
        "markdown": ('```', '```'),
        "brackets": ('[[', ']]'),
        "dashes": ('---', '---')
    }

    start, end = delimiters.get(delimiter_style, ('"""', '"""'))

    return f"""{instruction}

{start}
{content}
{end}"""

# Example with XML-style delimiters
prompt = create_delimited_prompt(
    instruction="Translate the text between the tags to French.",
    content="Azure OpenAI Service enables powerful AI capabilities.",
    delimiter_style="xml"
)
# Output:
# Translate the text between the tags to French.
#
# <content>
# Azure OpenAI Service enables powerful AI capabilities.
# </content>
```

## Output Formatting

Control output format explicitly:

```python
import json
from typing import List, Dict

class OutputFormatter:
    """Format specifications for prompts."""

    @staticmethod
    def json_format(schema: Dict) -> str:
        """Specify JSON output format."""
        schema_str = json.dumps(schema, indent=2)
        return f"""Return your response as valid JSON matching this schema:
{schema_str}

Only return the JSON, no other text."""

    @staticmethod
    def markdown_format(sections: List[str]) -> str:
        """Specify Markdown output format."""
        section_list = "\n".join([f"## {s}" for s in sections])
        return f"""Format your response as Markdown with these sections:
{section_list}"""

    @staticmethod
    def table_format(columns: List[str]) -> str:
        """Specify table output format."""
        header = " | ".join(columns)
        separator = " | ".join(["---"] * len(columns))
        return f"""Format your response as a Markdown table with these columns:
| {header} |
| {separator} |"""

    @staticmethod
    def list_format(style: str = "numbered") -> str:
        """Specify list output format."""
        if style == "numbered":
            return "Format your response as a numbered list (1., 2., 3., etc.)"
        elif style == "bulleted":
            return "Format your response as a bulleted list (- item)"
        else:
            return f"Format your response as a {style} list"

# Usage
# JSON output
json_instruction = OutputFormatter.json_format({
    "summary": "string",
    "key_points": ["string"],
    "sentiment": "positive|negative|neutral",
    "confidence": "number between 0 and 1"
})

# Table output
table_instruction = OutputFormatter.table_format([
    "Service Name", "Description", "Pricing Tier", "Use Case"
])

# Complete prompt
prompt = f"""Analyze the following Azure services for a startup.

Services: App Service, Functions, Container Apps, AKS

{table_instruction}"""
```

## Iterative Prompting

Refine prompts through iteration:

```python
class PromptIterator:
    """Track prompt iterations and improvements."""

    def __init__(self):
        self.iterations: List[Dict] = []

    def add_iteration(
        self,
        prompt: str,
        response: str,
        issues: List[str],
        improvements: List[str]
    ):
        """Record a prompt iteration."""
        self.iterations.append({
            "version": len(self.iterations) + 1,
            "prompt": prompt,
            "response": response,
            "issues": issues,
            "improvements": improvements
        })

    def get_latest(self) -> Dict:
        """Get the latest iteration."""
        return self.iterations[-1] if self.iterations else None

    def generate_report(self) -> str:
        """Generate iteration report."""
        report = "# Prompt Engineering Report\n\n"

        for iteration in self.iterations:
            report += f"## Version {iteration['version']}\n\n"
            report += f"**Prompt:**\n```\n{iteration['prompt'][:200]}...\n```\n\n"
            report += f"**Issues:**\n"
            for issue in iteration['issues']:
                report += f"- {issue}\n"
            report += f"\n**Improvements Made:**\n"
            for imp in iteration['improvements']:
                report += f"- {imp}\n"
            report += "\n---\n\n"

        return report

# Example iteration process
iterator = PromptIterator()

# Version 1: Too vague
iterator.add_iteration(
    prompt="Explain Azure",
    response="Azure is Microsoft's cloud...",
    issues=["Response too general", "No specific details"],
    improvements=["Add specific topic", "Define target audience"]
)

# Version 2: Better but still issues
iterator.add_iteration(
    prompt="Explain Azure App Service to a developer",
    response="Azure App Service is a PaaS...",
    issues=["Missing practical examples", "No code samples"],
    improvements=["Request code examples", "Add use case context"]
)

# Version 3: Good
iterator.add_iteration(
    prompt="""Explain Azure App Service to a .NET developer.
Include:
1. What it is (2-3 sentences)
2. A simple deployment example using Azure CLI
3. When to use it vs Azure Functions

Keep technical but accessible.""",
    response="...",
    issues=[],
    improvements=["This version works well"]
)

print(iterator.generate_report())
```

## Common Pitfalls

Avoid these prompt engineering mistakes:

```python
PROMPT_PITFALLS = {
    "too_vague": {
        "bad": "Tell me about databases",
        "good": "Compare Azure SQL Database and Cosmos DB for a read-heavy e-commerce workload with 1TB of data",
        "issue": "Vague prompts get vague responses"
    },
    "too_complex": {
        "bad": "Explain databases, then write code to connect, then optimize queries, then set up monitoring",
        "good": "Explain how to connect to Azure SQL Database from Python. Include error handling.",
        "issue": "Complex prompts confuse the model - break into steps"
    },
    "missing_context": {
        "bad": "Fix this error",
        "good": "Fix this Python Azure SDK error. I'm using azure-storage-blob 12.14.1 on Python 3.10:\n[error message]",
        "issue": "Without context, the model can't help effectively"
    },
    "ambiguous_output": {
        "bad": "List some Azure services",
        "good": "List exactly 5 Azure database services. For each, provide the name and a one-sentence description.",
        "issue": "Ambiguous requests get inconsistent outputs"
    }
}

def analyze_prompt(prompt: str) -> List[str]:
    """Analyze a prompt for common issues."""
    issues = []

    # Check length
    if len(prompt) < 20:
        issues.append("Prompt may be too short/vague")

    # Check for specificity
    vague_words = ["some", "things", "stuff", "etc", "whatever"]
    if any(word in prompt.lower() for word in vague_words):
        issues.append("Contains vague language")

    # Check for output format
    format_keywords = ["format", "list", "json", "table", "provide", "include"]
    if not any(word in prompt.lower() for word in format_keywords):
        issues.append("No output format specified")

    # Check for context
    if len(prompt.split()) < 15 and "?" in prompt:
        issues.append("Question may lack sufficient context")

    return issues
```

## Best Practices Summary

1. **Be specific**: Clear instructions get better results
2. **Provide context**: Help the model understand the situation
3. **Specify format**: Tell the model exactly how to respond
4. **Use delimiters**: Clearly separate instructions from content
5. **Iterate**: Refine prompts based on results
6. **Use roles**: Assign personas for consistent behavior
7. **Test edge cases**: Ensure prompts handle unexpected inputs

## Resources

- [Azure OpenAI Prompt Engineering](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/prompt-engineering)
- [OpenAI Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [Prompt Engineering Patterns](https://www.promptingguide.ai/)
