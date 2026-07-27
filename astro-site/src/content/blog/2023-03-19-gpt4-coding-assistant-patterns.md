---
title: "Building GPT-4 Powered Coding Assistants"
author: Michael John Pena
draft: false
date: 2023-03-19
tags:
  - OpenAI
  - AI
  - GPT-4
  - Coding
  - Developer Tools

---

I wrote "Building GPT-4 Powered Coding Assistants" to share practical, production-minded guidance on this topic.

## Code Context Management

The key to useful code assistance is providing relevant context:

```python
from dataclasses import dataclass
from typing import Optional
import ast
import os

@dataclass
class CodeContext:
    current_file: str
    current_code: str
    cursor_position: tuple[int, int]  # line, column
    imports: list[str]
    class_context: Optional[str]
    function_context: Optional[str]
    related_files: list[str]

class ContextBuilder:
    """Build context for code assistance."""

    def __init__(self, project_root: str):
        self.project_root = project_root

    def build_context(
        self,
        file_path: str,
        code: str,
        cursor_line: int
    ) -> CodeContext:
        """Build comprehensive context for assistance."""

        # Parse the code
        try:
            tree = ast.parse(code)
        except SyntaxError:
            tree = None

        # Extract imports
        imports = self._extract_imports(tree) if tree else []

        # Find enclosing class/function
        class_ctx, func_ctx = self._find_enclosing_scope(tree, cursor_line) if tree else (None, None)

        # Find related files
        related = self._find_related_files(file_path, imports)

        return CodeContext(
            current_file=file_path,
            current_code=code,
            cursor_position=(cursor_line, 0),
            imports=imports,
            class_context=class_ctx,
            function_context=func_ctx,
            related_files=related
        )

    def _extract_imports(self, tree: ast.AST) -> list[str]:
        """Extract import statements."""
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imports.append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                for alias in node.names:
                    imports.append(f"{module}.{alias.name}")
        return imports

    def _find_enclosing_scope(
        self,
        tree: ast.AST,
        line: int
    ) -> tuple[Optional[str], Optional[str]]:
        """Find enclosing class and function."""
        class_name = None
        func_name = None

        for node in ast.walk(tree):
            if hasattr(node, 'lineno') and hasattr(node, 'end_lineno'):
                if node.lineno <= line <= (node.end_lineno or node.lineno):
                    if isinstance(node, ast.ClassDef):
                        class_name = node.name
                    elif isinstance(node, ast.FunctionDef):
                        func_name = node.name

        return class_name, func_name

    def _find_related_files(
        self,
        file_path: str,
        imports: list[str]
    ) -> list[str]:
        """Find related project files."""
        related = []

        for imp in imports:
            # Convert import to potential file path
            parts = imp.split('.')
            potential_path = os.path.join(self.project_root, *parts) + ".py"
            if os.path.exists(potential_path):
                related.append(potential_path)

        return related[:5]  # Limit to 5 files
```

## Code Completion Engine

```python
class GPT4CodeCompletion:
    """GPT-4 powered code completion."""

    def __init__(self, client):
        self.client = client
        self.context_builder = ContextBuilder(".")

    async def complete(
        self,
        file_path: str,
        code: str,
        cursor_line: int,
        cursor_col: int
    ) -> list[str]:
        """Generate code completions."""

        context = self.context_builder.build_context(file_path, code, cursor_line)

        # Get code before and after cursor
        lines = code.split('\n')
        before = '\n'.join(lines[:cursor_line])
        current_line = lines[cursor_line] if cursor_line < len(lines) else ""
        prefix = current_line[:cursor_col]

        prompt = f"""Complete the code at the cursor position.

File: {file_path}
Imports: {', '.join(context.imports[:10])}
{f'Class: {context.class_context}' if context.class_context else ''}
{f'Function: {context.function_context}' if context.function_context else ''}

Code before cursor:
```python
{before[-2000:]}
{prefix}
```

Provide 3 possible completions. Return ONLY the code to insert, no explanation.
Format as JSON: ["completion1", "completion2", "completion3"]"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a code completion engine. Return only valid Python code."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return [response.content]

    async def complete_function(
        self,
        signature: str,
        docstring: str = None,
        context: str = None
    ) -> str:
        """Generate complete function implementation."""

        prompt = f"""Implement this function.

Signature: {signature}
{f'Docstring: {docstring}' if docstring else ''}
{f'Context: {context}' if context else ''}

Requirements:
- Follow Python best practices
- Include type hints
- Handle edge cases
- Add inline comments for complex logic

Return only the function implementation."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2
        )

        return response.content
```

## Code Explanation and Documentation

```python
class CodeExplainer:
    """Explain code using GPT-4."""

    async def explain_code(
        self,
        code: str,
        detail_level: str = "moderate"
    ) -> str:
        """Explain what code does."""

        detail_prompts = {
            "brief": "Explain in 2-3 sentences what this code does.",
            "moderate": "Explain this code, covering the main logic and any notable patterns.",
            "detailed": "Provide a detailed explanation including: purpose, algorithm, complexity, and potential improvements."
        }

        prompt = f"""{detail_prompts.get(detail_level, detail_prompts['moderate'])}

```python
{code}
```"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def generate_docstring(
        self,
        function_code: str,
        style: str = "google"
    ) -> str:
        """Generate docstring for function."""

        style_examples = {
            "google": '''"""Short description.

    Args:
        param1: Description.
        param2: Description.

    Returns:
        Description of return value.

    Raises:
        ExceptionType: When this happens.
    """''',
            "numpy": '''"""Short description.

    Parameters
    -------\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
