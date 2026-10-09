---
title: "Codex Models: AI-Powered Code Generation for Developers"
description: "response = openai.Completion.create( engine=\"code-davinci-002\", prompt=prompt, maxtokens=300, temperature=0.3 )"
author: Michael John Peña
draft: false
date: 2022-03-03
tags:
  - Azure
  - OpenAI
  - Codex
  - AI
  - Development
---

## Understanding Codex

Codex is trained on billions of lines of public code. It understands:
- Multiple programming languages
- Common patterns and idioms
- Documentation and comments
- API conventions

The key models:
- `code-davinci-002`: Most capable, handles complex tasks
- `code-cushman-001`: Faster, suitable for simpler completions

## Basic Code Generation

Generate code from natural language:

```python
import openai

def generate_code(description, language="python"):
    prompt = f"""# {language.capitalize()}
# {description}

"""

    response = openai.Completion.create(
        engine="code-davinci-002",
        prompt=prompt,
        max_tokens=500,
        temperature=0,
        stop=["#", "'''", '"""']
    )

    return response.choices[0].text.strip()

# Example usage
code = generate_code(
    "Function that calculates the Fibonacci sequence up to n terms",
    "python"
)
print(code)
```

Output:
```python
def fibonacci(n):
    if n <= 0:
        return []
    elif n == 1:
        return [0]
    elif n == 2:
        return [0, 1]

    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[i-1] + fib[i-2])
    return fib
```

## Language Translation

Convert code between languages:

```python
def translate_code(source_code, source_lang, target_lang):
    prompt = f"""# Convert the following {source_lang} code to {target_lang}

# {source_lang}:
{source_code}

# {target_lang}:
"""

    response = openai.Completion.create(
        engine="code-davinci-002",
        prompt=prompt,
        max_tokens=len(source_code) * 2,
        temperature=0
    )

    return response.choices[0].text.strip()

# Example: Python to JavaScript
python_code = """
def greet(name):
    return f"Hello, {name}!"

def main():
    print(greet("World"))
"""

js_code = translate_code(python_code, "Python", "JavaScript")
print(js_code)
```

## Code Explanation

Get explanations for complex code:

```python
def explain_code(code, language):
    prompt = f"""Explain what the following {language} code does in plain English:

```{language}
{code}
```

Explanation:"""

    response = openai.Completion.create(
        engine="code-davinci-002",
        prompt=prompt,
        max_tokens=300,
        temperature=0.3
    )

    return response.choices[0].text.strip()
```

## SQL Generation

Generate SQL from natural language:

```python
def natural_language_to_sql(question, schema):
    prompt = f"""### Database Schema:
{schema}

### Question: {question}

### SQL Query:
SELECT"""

    response = openai.Completion.create(
        engine="code-davinci-002",
        prompt=prompt,
        max_tokens=200,
        temperature=0,
        stop=[";", "--"]
    )

    return "SELECT" + response.choices[0].text + ";"

# Example
schema = """
Tables:
- customers (id, name, email, created_at)
- orders (id, customer_id, total, status, created_at)
- products (id, name, price, category)
- order_items (id, order_id, product_id, quantity)
"""

sql = natural_language_to_sql(
    "Find all customers who have placed more than 5 orders this month",
    schema
)
print(sql)
```

## Unit Test Generation

Automatically generate tests:

```python
def generate_tests(function_code, language="python"):
    prompt = f"""Write unit tests for the following {language} function:

```{language}
{function_code}
```

Unit tests using pytest:
```{language}
import pytest
"""

    response = openai.Completion.create(
        engine="code-davinci-002",
        prompt=prompt,
        max_tokens=500,
        temperature=0.2
    )

    return "import pytest\n" + response.choices[0].text

# Example
func = """
def calculate_discount(price, discount_percent):
    if discount_percent < 0 or discount_percent > 100:
        raise ValueError("Discount must be between 0 and 100")
    return price * (1 - discount_percent / 100)
"""

tests = generate_tests(func)
print(tests)
```

## Code Review Assistant

Get automated code review suggestions:

```python
def review_code(code, language):
    prompt = f"""Review the following {language} code for:
1. Bugs or potential issues
2. Performance improvements
3. Security concerns
4. Best practice violations

Code:
```{language}
{code}
```

Code Review:"""

    response = openai.Completion.create(
        engine="code-davinci-002",
        prompt=prompt,
        max_tokens=500,
        temperature=0.3
    )

    return response.choices[0].text.strip()
```

## Building a CLI Tool

Create a command-line code assistant:

```python
#!/usr/bin/env python3
import argparse
import openai
import sys
import os

openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]
openai.api_version = "2022-03-01-preview"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

def main():
    parser = argparse.ArgumentParser(description="AI Code Assistant")
    parser.add_argument("action", choices=["generate", "explain", "test", "review"])
    parser.add_argument("--language", "-l", default="python")
    parser.add_argument("--file", "-f", help="Input file")
    parser.add_argument("--prompt", "-p", help="Natural language prompt")

    args = parser.parse_args()

    if args.file:
        with open(args.file, 'r') as f:
            code = f.read()
    else:
        code = sys.stdin.read() if not sys.stdin.isatty() else None

    if args.action == "generate":
        if not args.prompt:
            print("Error: --prompt required for generate")
            sys.exit(1)
        result = generate_code(args.prompt, args.language)
    elif args.action == "explain":
        if not code:
            print("Error: Provide code via --file or stdin")
            sys.exit(1)
        result = explain_code(code, args.language)
    elif args.action == "test":
        if not code:
            print("Error: Provide code via --file or stdin")
            sys.exit(1)
        result = generate_tests(code, args.language)
    elif args.action == "review":
        if not code:
            print("Error: Provide code via --file or stdin")
            sys.exit(1)
        result = review_code(code, args.language)

    print(result)

if __name__ == "__main__":
    main()
```

Usage:
```bash
# Generate code
./code_assistant.py generate -l python -p "REST API client for weather data"

# Explain code
cat my_script.py | ./code_assistant.py explain -l python

# Generate tests
./code_assistant.py test -f my_module.py

# Review code
./code_assistant.py review -f suspicious_code.py
```

## Integration with VS Code

Create a VS Code extension that uses Codex:

```typescript
// extension.ts
import * as vscode from 'vscode';
import axios from 'axios';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand(
        'codex-assistant.generateCode',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const prompt = await vscode.window.showInputBox({
                prompt: 'Describe what code you want to generate'
            });

            if (!prompt) return;

            const language = editor.document.languageId;

            try {
                const response = await axios.post(
                    `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/code-davinci-002/completions`,
                    {
                        prompt: `# ${language}\n# ${prompt}\n\n`,
                        max_tokens: 500,
                        temperature: 0
                    },
                    {
                        headers: {
                            'api-key': process.env.AZURE_OPENAI_KEY,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const generatedCode = response.data.choices[0].text;
                editor.edit(editBuilder => {
                    editBuilder.insert(editor.selection.active, generatedCode);
                });
            } catch (error) {
                vscode.window.showErrorMessage('Failed to generate code');
            }
        }
    );

    context.subscriptions.push(disposable);
}
```

## Best Practices

### 1. Validate Generated Code

Never execute generated code without review:

```python
def safe_execute(generated_code, allowed_modules=None):
    # Parse the AST to check for dangerous operations
    import ast

    tree = ast.parse(generated_code)

    for node in ast.walk(tree):
        # Check for imports
        if isinstance(node, ast.Import):
            for alias in node.names:
                if allowed_modules and alias.name not in allowed_modules:
                    raise SecurityError(f"Disallowed import: {alias.name}")

        # Check for dangerous calls
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in ['eval', 'exec', 'compile', '__import__']:
                    raise SecurityError(f"Dangerous function: {node.func.id}")

    # If validation passes, consider execution
    return True
```

### 2. Use Stop Sequences

Prevent runaway generation:

```python
response = openai.Completion.create(
    engine="code-davinci-002",
    prompt=prompt,
    max_tokens=500,
    stop=[
        "\n\n\n",  # Multiple blank lines
        "# End",    # Custom end marker
        "```",      # Markdown code block end
        "if __name__"  # Module entry point
    ]
)
```

### 3. Temperature for Different Tasks

| Task | Temperature | Rationale |
|------|-------------|-----------|
| SQL generation | 0 | Deterministic, exact |
| Bug fixes | 0-0.1 | Precise corrections |
| Code completion | 0.2 | Some flexibility |
| Test generation | 0.3 | Varied test cases |
| Creative coding | 0.5-0.7 | Novel approaches |

## Limitations

Codex isn't perfect:

1. **Outdated knowledge**: Training data has a cutoff date
2. **Hallucinated APIs**: May invent non-existent functions
3. **Security blind spots**: Generated code may have vulnerabilities
4. **Context limits**: Can't understand your entire codebase
5. **License concerns**: Output may resemble training data

Always review, test, and validate generated code.

## Conclusion

Codex models are productivity multipliers, not replacements for developers. Use them to:
- Accelerate boilerplate code creation
- Get starting points for complex algorithms
- Learn new languages and frameworks
- Generate test cases
- Document existing code

The key is treating Codex as a capable but fallible assistant that still requires human oversight.

## Resources

- [OpenAI Codex Documentation](https://platform.openai.com/docs/guides/code)
- [GitHub Copilot](https://github.com/features/copilot) (powered by Codex)
- [Azure OpenAI Codex Models](https://docs.microsoft.com/en-us/azure/cognitive-services/openai/concepts/models)
