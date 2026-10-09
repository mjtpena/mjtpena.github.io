---
title: "Code Completion for Data Science Notebooks"
description: "Return only the docstring (including quotes).\"\"\" response = await self.client.chatcompletion( model=\"gpt-35-turbo\", messages=[{\"role\": \"user\", \"content\"…"
author: Michael John Pena
draft: false
date: 2023-04-17
tags:
  - AI
  - Code Completion
  - Notebooks
  - Data Science
  - Copilot
---

## Context-Aware Completion

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class NotebookContext:
    imports: list[str]
    defined_variables: dict
    dataframes: dict  # name -> column info
    recent_cells: list[str]
    current_line: str
    cursor_position: int

class NotebookCompleter:
    """Context-aware code completion for notebooks."""

    def __init__(self, client):
        self.client = client

    def build_context(self, notebook_state: dict) -> NotebookContext:
        """Build context from notebook state."""
        imports = []
        variables = {}
        dataframes = {}

        for cell in notebook_state.get("cells", []):
            code = cell.get("source", "")

            # Extract imports
            for line in code.split("\n"):
                if line.startswith("import ") or line.startswith("from "):
                    imports.append(line)

            # Track DataFrames
            if "= pd.read" in code or "= pd.DataFrame" in code:
                # Simple extraction
                var_name = code.split("=")[0].strip()
                dataframes[var_name] = {"columns": [], "shape": "unknown"}

        return NotebookContext(
            imports=imports,
            defined_variables=variables,
            dataframes=dataframes,
            recent_cells=notebook_state.get("cells", [])[-5:],
            current_line=notebook_state.get("current_line", ""),
            cursor_position=notebook_state.get("cursor_position", 0)
        )

    async def complete(
        self,
        context: NotebookContext,
        trigger: str = None
    ) -> list[str]:
        """Generate completions based on context."""

        imports_str = "\n".join(context.imports[:10])
        dfs_str = ", ".join(context.dataframes.keys()) if context.dataframes else "None"

        prompt = f"""Generate code completions for a Jupyter notebook.

Imports:
{imports_str}

DataFrames available: {dfs_str}
Current line: {context.current_line}

Provide 3 likely completions. Consider:
- What the user is likely trying to do
- Available variables and DataFrames
- Common patterns

Return as JSON array: ["completion1", "completion2", "completion3"]"""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return []

    async def complete_function_call(
        self,
        function_name: str,
        context: NotebookContext
    ) -> str:
        """Complete function call with appropriate arguments."""

        df_info = ""
        if context.dataframes:
            df_info = f"Available DataFrames: {list(context.dataframes.keys())}"

        prompt = f"""Complete this function call.

Function: {function_name}
{df_info}

Provide the complete function call with common arguments filled in.
Return only the code."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2
        )

        return response.content.strip()
```

## DataFrame-Aware Completion

```python
class DataFrameCompletion:
    """Completions that understand DataFrame structure."""

    def __init__(self, client):
        self.client = client
        self.df_registry = {}

    def register_dataframe(self, name: str, df):
        """Register a DataFrame for completion context."""
        self.df_registry[name] = {
            "columns": list(df.columns),
            "dtypes": df.dtypes.to_dict(),
            "shape": df.shape
        }

    async def complete_column_access(
        self,
        df_name: str,
        partial: str = ""
    ) -> list[str]:
        """Complete DataFrame column access."""
        if df_name not in self.df_registry:
            return []

        columns = self.df_registry[df_name]["columns"]

        if partial:
            # Filter columns matching partial
            matches = [c for c in columns if c.lower().startswith(partial.lower())]
        else:
            matches = columns

        return [f"{df_name}['{col}']" for col in matches[:10]]

    async def suggest_transformation(
        self,
        df_name: str,
        description: str
    ) -> str:
        """Suggest DataFrame transformation code."""
        if df_name not in self.df_registry:
            return ""

        df_info = self.df_registry[df_name]

        prompt = f"""Generate pandas code for this transformation.

DataFrame '{df_name}':
Columns: {df_info['columns']}
Types: {df_info['dtypes']}

Request: {description}

Return only the code."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )

        return response.content

    async def complete_groupby(
        self,
        df_name: str,
        partial_code: str
    ) -> list[str]:
        """Complete groupby operations."""
        if df_name not in self.df_registry:
            return []

        df_info = self.df_registry[df_name]

        # Identify categorical and numeric columns
        categorical = [c for c, t in df_info["dtypes"].items()
                      if "object" in str(t) or "category" in str(t)]
        numeric = [c for c, t in df_info["dtypes"].items()
                  if "int" in str(t) or "float" in str(t)]

        suggestions = []
        for cat in categorical[:3]:
            for num in numeric[:3]:
                suggestions.append(f"{df_name}.groupby('{cat}')['{num}'].mean()")

        return suggestions
```

## Intelligent Docstring Completion

```python
class DocstringCompleter:
    """Generate docstrings for notebook functions."""

    async def generate_docstring(
        self,
        function_code: str,
        style: str = "google"
    ) -> str:
        """Generate docstring for function."""
        prompt = f"""Generate a {style}-style docstring for this function.

```python
{function_code}
```

Return only the docstring (including quotes)."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )

        return response.content

    async def complete_inline_comment(
        self,
        code_line: str,
        surrounding_context: str
    ) -> str:
        """Generate inline comment for code."""
        prompt = f"""Generate a brief inline comment for this code.

Context:
{surrounding_context}

Line to comment:
{code_line}

Return only the comment (with #)."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2
        )

        return response.content.strip()
```

## Usage Pattern

```python
# In a notebook
completer = NotebookCompleter(client)
df_completer = DataFrameCompletion(client)

# Register DataFrames when created
df = pd.read_csv("data.csv")
df_completer.register_dataframe("df", df)

# Get completions
completions = await completer.complete(context)

# Get DataFrame-specific completions
column_completions = await df_completer.complete_column_access("df", "cust")

# Get transformation suggestions
transform_code = await df_completer.suggest_transformation(
    "df",
    "Calculate monthly averages by customer"
)
```

Intelligent code completion transforms notebooks from blank-page intimidation to guided data exploration. The AI understands both the language and your data context.
