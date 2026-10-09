---
title: "AI Assistants in Jupyter and Databricks Notebooks"
description: "Error: {type(error).name}: {str(error)} response = openai.ChatCompletion.create( engine=\"gpt-4\", messages=[{\"role\": \"user\", \"content\": prompt}] ) return…"
author: Michael John Pena
draft: false
date: 2023-04-16
tags:
  - AI
  - Jupyter
  - Databricks
  - Notebooks
  - Python
---

## Notebook AI Integration

```python
# Cell magic for AI assistance
from IPython.core.magic import register_cell_magic
import openai

@register_cell_magic
def ai(line, cell):
    """AI assistant magic command."""
    response = openai.ChatCompletion.create(
        engine="gpt-4",
        messages=[
            {"role": "system", "content": "You are a helpful data science assistant."},
            {"role": "user", "content": cell}
        ]
    )
    return response.choices[0].message.content

# Usage:
# %%ai
# Explain how to handle missing values in pandas
```

## Code Generation Magic

```python
@register_cell_magic
def generate_code(line, cell):
    """Generate code from natural language description."""
    prompt = f"""Generate Python code for: {cell}

Requirements:
- Use pandas for data manipulation
- Include comments
- Handle errors appropriately
- Print results if applicable"""

    response = openai.ChatCompletion.create(
        engine="gpt-4",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2
    )

    code = response.choices[0].message.content
    # Clean code block markers
    if "```python" in code:
        code = code.split("```python")[1].split("```")[0]

    # Execute the generated code
    exec(code)
    return code

# Usage:
# %%generate_code
# Load the iris dataset and create a scatter plot of sepal length vs width
```

## DataFrame Assistant

```python
class DataFrameAssistant:
    """AI assistant for DataFrame operations."""

    def __init__(self, df, name="df"):
        self.df = df
        self.name = name
        self._context = self._build_context()

    def _build_context(self):
        return f"""DataFrame '{self.name}':
Columns: {list(self.df.columns)}
Shape: {self.df.shape}
Types: {self.df.dtypes.to_dict()}
Sample: {self.df.head(3).to_dict()}"""

    def ask(self, question: str) -> str:
        """Ask a question about the DataFrame."""
        prompt = f"""{self._context}

Question: {question}

Provide a clear answer. Include code if helpful."""

        response = openai.ChatCompletion.create(
            engine="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content

    def transform(self, description: str):
        """Transform DataFrame based on description."""
        prompt = f"""{self._context}

Transform the DataFrame: {description}

Return only executable Python code that modifies 'df' in place or returns a new DataFrame."""

        response = openai.ChatCompletion.create(
            engine="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        code = response.choices[0].message.content
        if "```" in code:
            code = code.split("```")[1].replace("python", "").strip()

        # Execute and return result
        local_vars = {"df": self.df}
        exec(code, globals(), local_vars)
        if "result" in local_vars:
            return local_vars["result"]
        return local_vars.get("df", self.df)

# Usage:
# assistant = DataFrameAssistant(df)
# assistant.ask("What's the average value by category?")
# df_cleaned = assistant.transform("Remove rows with missing values and standardize column names")
```

## Error Explanation

```python
def explain_error(error: Exception, code: str) -> str:
    """Explain an error and suggest fixes."""
    prompt = f"""Explain this Python error and suggest fixes.

Code:
```python
{code}
```

Error:
{type(error).__name__}: {str(error)}

Provide:
1. What caused the error
2. How to fix it
3. Corrected code"""

    response = openai.ChatCompletion.create(
        engine="gpt-4",
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content

## Wrapper for automatic error explanation
def run_with_help(code: str):
    """Run code with AI error assistance."""
    try:
        exec(code)
    except Exception as e:
        print("Error occurred. Getting AI assistance...")
        explanation = explain_error(e, code)
        print(explanation)
```

## Visualization Assistant

```python
class VizAssistant:
    """AI assistant for creating visualizations."""

    def __init__(self, df):
        self.df = df
        self.columns = list(df.columns)
        self.dtypes = df.dtypes.to_dict()

    def suggest(self, goal: str) -> str:
        """Suggest visualization for a goal."""
        prompt = f"""Suggest a visualization.

Data columns: {self.columns}
Column types: {self.dtypes}
Goal: {goal}

Recommend chart type and provide matplotlib/seaborn code."""

        response = openai.ChatCompletion.create(
            engine="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content

    def create(self, description: str):
        """Create visualization from description."""
        prompt = f"""Create a visualization.

DataFrame 'df' columns: {self.columns}
Request: {description}

Generate complete matplotlib/seaborn code. Include proper labels and styling."""

        response = openai.ChatCompletion.create(
            engine="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )

        code = response.choices[0].message.content
        if "```" in code:
            code = code.split("```")[1].replace("python", "").strip()

        # Execute visualization code
        exec(code, {"df": self.df, "plt": __import__("matplotlib.pyplot"), "sns": __import__("seaborn")})

# Usage:
# viz = VizAssistant(df)
# viz.create("Show the distribution of sales by region as a bar chart")
```

## Notebook Documentation Generator

```python
class NotebookDocumenter:
    """Generate documentation for notebooks."""

    def document_cell(self, code: str) -> str:
        """Generate documentation for a code cell."""
        prompt = f"""Generate a markdown cell to document this code.

Code:
```python
{code}
```

Include:
- What the code does
- Key parameters/variables
- Expected output"""

        response = openai.ChatCompletion.create(
            engine="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content

    def generate_readme(self, cells: list[str]) -> str:
        """Generate README from notebook cells."""
        cells_str = "\n---\n".join(cells[:20])

        prompt = f"""Generate a README for this notebook.

Notebook cells:
{cells_str}

Include:
- Title and description
- Requirements
- How to run
- Expected outputs"""

        response = openai.ChatCompletion.create(
            engine="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content
```

AI-powered notebooks transform data exploration from writing code to having conversations about data. The interactive environment makes the feedback loop immediate and productive.
```
