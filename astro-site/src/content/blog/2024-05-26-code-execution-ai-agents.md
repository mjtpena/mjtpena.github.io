---
title: "Code Execution in AI Agents: Safe and Effective Patterns"
description: "Code execution is one of the most powerful capabilities for AI agents - and one of the most dangerous. Today I'm exploring how to implement it safely."
author: Michael John Peña
draft: false
date: 2024-05-26
tags:
  - AI Agents
  - Code Execution
  - Security
  - Sandboxing
  - Azure
---

Code execution is one of the most powerful capabilities for AI agents - and one of the most dangerous. Today I'm exploring how to implement it safely.

## Why Code Execution?

Agents with code execution can:
- Perform complex calculations
- Transform and analyze data
- Create visualizations
- Automate repetitive tasks
- Test hypotheses dynamically

## The Security Challenge

```
Risks of unrestricted code execution:
├── File system access
├── Network access
├── Resource exhaustion
├── Process manipulation
├── Credential exposure
└── System compromise
```

## Sandboxing Approaches

### 1. Docker Container Isolation

```python
import docker
import tempfile
import os

class DockerSandbox:
    """Execute code in isolated Docker containers."""

    def __init__(
        self,
        image: str = "python:3.11-slim",
        timeout: int = 30,
        memory_limit: str = "256m",
        cpu_limit: float = 0.5
    ):
        self.client = docker.from_env()
        self.image = image
        self.timeout = timeout
        self.memory_limit = memory_limit
        self.cpu_limit = cpu_limit

    async def execute(self, code: str, files: dict = None) -> dict:
        # Create temporary directory for code and files
        with tempfile.TemporaryDirectory() as tmpdir:
            # Write code
            code_path = os.path.join(tmpdir, "script.py")
            with open(code_path, "w") as f:
                f.write(code)

            # Write additional files
            if files:
                for name, content in files.items():
                    file_path = os.path.join(tmpdir, name)
                    with open(file_path, "wb" if isinstance(content, bytes) else "w") as f:
                        f.write(content)

            try:
                container = self.client.containers.run(
                    self.image,
                    command=["python", "/workspace/script.py"],
                    volumes={tmpdir: {"bind": "/workspace", "mode": "ro"}},
                    mem_limit=self.memory_limit,
                    cpu_period=100000,
                    cpu_quota=int(100000 * self.cpu_limit),
                    network_disabled=True,  # No network access
                    remove=True,
                    detach=False,
                    stdout=True,
                    stderr=True,
                    timeout=self.timeout
                )

                return {
                    "success": True,
                    "output": container.decode("utf-8"),
                    "error": None
                }

            except docker.errors.ContainerError as e:
                return {
                    "success": False,
                    "output": e.stderr.decode("utf-8") if e.stderr else "",
                    "error": str(e)
                }
            except Exception as e:
                return {
                    "success": False,
                    "output": "",
                    "error": str(e)
                }

# Usage
sandbox = DockerSandbox()
result = await sandbox.execute("""
import pandas as pd
data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
print(df.describe())
""")
```

### 2. WebAssembly Sandbox (Pyodide)

```python
from pyodide import create_runtime
import asyncio

class PyodideSandbox:
    """Execute Python in WebAssembly sandbox."""

    def __init__(self):
        self.runtime = None

    async def initialize(self):
        self.runtime = await create_runtime()
        # Pre-install common packages
        await self.runtime.loadPackagesFromImports([
            "numpy", "pandas", "matplotlib"
        ])

    async def execute(self, code: str) -> dict:
        if not self.runtime:
            await self.initialize()

        try:
            # Execute code in sandbox
            result = await self.runtime.runPythonAsync(code)

            return {
                "success": True,
                "output": str(result),
                "error": None
            }
        except Exception as e:
            return {
                "success": False,
                "output": "",
                "error": str(e)
            }
```

### 3. Restricted Python (RestrictedPython)

```python
from RestrictedPython import compile_restricted, safe_globals
from RestrictedPython.Eval import default_guarded_getattr
from RestrictedPython.Guards import guarded_iter_unpack_sequence, safer_getattr
import io
import sys

class RestrictedSandbox:
    """Execute Python with restricted builtins."""

    def __init__(self, allowed_modules: list = None):
        self.allowed_modules = allowed_modules or ["math", "json", "datetime"]

    def execute(self, code: str) -> dict:
        # Compile with restrictions
        try:
            byte_code = compile_restricted(code, '<inline>', 'exec')
        except SyntaxError as e:
            return {"success": False, "output": "", "error": f"Syntax error: {e}"}

        # Create restricted globals
        restricted_globals = safe_globals.copy()
        restricted_globals['_getattr_'] = safer_getattr
        restricted_globals['_getiter_'] = iter
        restricted_globals['_getitem_'] = lambda obj, key: obj[key]
        restricted_globals['__builtins__'] = self._get_safe_builtins()

        # Capture output
        output_buffer = io.StringIO()
        restricted_globals['print'] = lambda *args: print(*args, file=output_buffer)

        # Execute
        try:
            exec(byte_code, restricted_globals)
            return {
                "success": True,
                "output": output_buffer.getvalue(),
                "error": None
            }
        except Exception as e:
            return {
                "success": False,
                "output": output_buffer.getvalue(),
                "error": str(e)
            }

    def _get_safe_builtins(self) -> dict:
        safe = {
            'abs': abs,
            'all': all,
            'any': any,
            'bool': bool,
            'dict': dict,
            'enumerate': enumerate,
            'filter': filter,
            'float': float,
            'int': int,
            'len': len,
            'list': list,
            'map': map,
            'max': max,
            'min': min,
            'range': range,
            'round': round,
            'set': set,
            'sorted': sorted,
            'str': str,
            'sum': sum,
            'tuple': tuple,
            'zip': zip,
        }

        # Add allowed modules
        for module in self.allowed_modules:
            safe[module] = __import__(module)

        return safe
```

## Azure Container Apps for Serverless Execution

```python
import httpx
import os

class AzureContainerSandbox:
    """Execute code using Azure Container Apps."""

    def __init__(self, endpoint: str, api_key: str):
        self.endpoint = endpoint
        self.api_key = api_key

    async def execute(
        self,
        code: str,
        language: str = "python",
        timeout: int = 30
    ) -> dict:
        async with httpx.AsyncClient(timeout=timeout + 5) as client:
            response = await client.post(
                f"{self.endpoint}/execute",
                headers={"X-API-Key": self.api_key},
                json={
                    "code": code,
                    "language": language,
                    "timeout": timeout
                }
            )

            if response.status_code == 200:
                return response.json()
            else:
                return {
                    "success": False,
                    "output": "",
                    "error": f"HTTP {response.status_code}: {response.text}"
                }

# Container App code (runs in Azure)
# app.py
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import subprocess
import tempfile
import os

app = FastAPI()

class ExecuteRequest(BaseModel):
    code: str
    language: str = "python"
    timeout: int = 30

@app.post("/execute")
async def execute_code(
    request: ExecuteRequest,
    x_api_key: str = Header(...)
):
    if x_api_key != os.environ["API_KEY"]:
        raise HTTPException(401, "Invalid API key")

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".py" if request.language == "python" else ".js",
        delete=False
    ) as f:
        f.write(request.code)
        script_path = f.name

    try:
        result = subprocess.run(
            ["python", script_path],
            capture_output=True,
            text=True,
            timeout=request.timeout
        )

        return {
            "success": result.returncode == 0,
            "output": result.stdout,
            "error": result.stderr if result.returncode != 0 else None
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "output": "",
            "error": "Execution timed out"
        }
    finally:
        os.unlink(script_path)
```

## Code Validation

```python
import ast
from typing import Set

class CodeValidator:
    """Validate code before execution."""

    DANGEROUS_CALLS = {
        "eval", "exec", "compile", "__import__",
        "open", "file", "input",
        "os.system", "subprocess", "popen"
    }

    DANGEROUS_MODULES = {
        "os", "sys", "subprocess", "shutil",
        "socket", "requests", "urllib"
    }

    def validate(self, code: str) -> dict:
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return {"valid": False, "error": f"Syntax error: {e}"}

        issues = []

        for node in ast.walk(tree):
            # Check for dangerous function calls
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    if node.func.id in self.DANGEROUS_CALLS:
                        issues.append(f"Dangerous call: {node.func.id}")

            # Check for dangerous imports
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.split('.')[0] in self.DANGEROUS_MODULES:
                        issues.append(f"Dangerous import: {alias.name}")

            if isinstance(node, ast.ImportFrom):
                if node.module and node.module.split('.')[0] in self.DANGEROUS_MODULES:
                    issues.append(f"Dangerous import: {node.module}")

        return {
            "valid": len(issues) == 0,
            "issues": issues
        }

# Usage
validator = CodeValidator()
result = validator.validate("import os; os.system('rm -rf /')")
# {'valid': False, 'issues': ['Dangerous import: os']}
```

## Integration with AI Agent

```python
class CodeExecutionAgent:
    """Agent with safe code execution capabilities."""

    def __init__(self, client, sandbox):
        self.client = client
        self.sandbox = sandbox
        self.validator = CodeValidator()

    async def solve_with_code(self, problem: str) -> dict:
        messages = [
            {
                "role": "system",
                "content": """You can write and execute Python code to solve problems.
When you need to run code, output it in a code block marked with ```python
Only use standard library and: numpy, pandas, matplotlib
Do not use: os, sys, subprocess, file operations"""
            },
            {"role": "user", "content": problem}
        ]

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )

        content = response.choices[0].message.content

        # Extract code blocks
        code_blocks = self._extract_code_blocks(content)

        results = []
        for code in code_blocks:
            # Validate
            validation = self.validator.validate(code)
            if not validation["valid"]:
                results.append({
                    "code": code,
                    "validation_error": validation["issues"]
                })
                continue

            # Execute
            execution = await self.sandbox.execute(code)
            results.append({
                "code": code,
                "output": execution["output"],
                "success": execution["success"],
                "error": execution.get("error")
            })

        return {
            "response": content,
            "code_executions": results
        }

    def _extract_code_blocks(self, text: str) -> list:
        import re
        pattern = r'```python\n(.*?)```'
        return re.findall(pattern, text, re.DOTALL)
```

## Monitoring and Auditing

```python
from datetime import datetime
import hashlib

class CodeExecutionAudit:
    """Audit all code executions."""

    def __init__(self, storage):
        self.storage = storage

    async def log_execution(
        self,
        code: str,
        result: dict,
        user_id: str,
        agent_id: str
    ):
        audit_record = {
            "id": hashlib.sha256(f"{code}{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16],
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": user_id,
            "agent_id": agent_id,
            "code_hash": hashlib.sha256(code.encode()).hexdigest(),
            "code_preview": code[:500],
            "success": result["success"],
            "output_preview": result.get("output", "")[:500],
            "error": result.get("error")
        }

        await self.storage.insert("code_executions", audit_record)

        # Alert on failures or suspicious patterns
        if not result["success"] or self._is_suspicious(code):
            await self._alert(audit_record)

    def _is_suspicious(self, code: str) -> bool:
        suspicious_patterns = [
            "base64", "decode", "encode",
            "exec", "eval", "compile",
            "socket", "connect", "bind"
        ]
        return any(p in code.lower() for p in suspicious_patterns)
```

## Best Practices

1. **Always sandbox** - Never execute untrusted code directly
2. **Validate first** - Check code before execution
3. **Limit resources** - CPU, memory, time
4. **No network** - Disable network access in sandbox
5. **Audit everything** - Log all executions

## What's Next

Tomorrow I'll cover file handling in AI agents.

## Resources

- [Docker SDK for Python](https://docker-py.readthedocs.io/)
- [RestrictedPython](https://restrictedpython.readthedocs.io/)
- [Azure Container Apps](https://learn.microsoft.com/azure/container-apps/)
