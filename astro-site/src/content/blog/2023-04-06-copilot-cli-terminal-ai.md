---
title: "Copilot CLI: AI in Your Terminal"
description: "Copilot for the CLI—part of the GitHub Copilot X announcement—brought the natural language to shell command pattern into the terminal, addressing the…"
author: Michael John Pena
draft: false
date: 2023-04-06
tags:
  - GitHub
  - AI
  - Copilot
  - CLI
  - Terminal
---

Copilot for the CLI—part of the GitHub Copilot X announcement—brought the natural language to shell command pattern into the terminal, addressing the cognitive load of CLI tool interfaces where the command syntax for a non-trivial operation (finding files modified in the last 7 days, filtering process output, composing git commands) often requires consulting documentation even for experienced users. The three capabilities: `??` (GitHub Copilot CLI shell command explanation—explain what a given shell command does); `git?` (natural language to git command—"undo my last commit and keep the changes staged"); and `gh?` (natural language to GitHub CLI command—"list all open PRs in my repos that have been open for more than 30 days"). The practical use: Copilot CLI is most useful for the infrequent operations where the correct flag combination isn't in muscle memory—not for `git status` or `ls`, but for the specific `find`, `grep`, `awk`, or `jq` invocations that require looking up syntax. The safety consideration: natural language to shell command has the same risk profile as AI-generated code—the generated command should be reviewed before execution, particularly for commands with destructive effects (file deletion, force push, process termination); Copilot CLI in the preview shows the generated command and asks for confirmation before execution. The GitHub CLI dependency: Copilot CLI was implemented as a GitHub CLI extension (`gh copilot`), requiring the GitHub CLI to be installed and authenticated before use.

## Core Features

1. **gh copilot suggest** - Natural language to shell command
2. **gh copilot explain** - Explain what a command does
3. **Error assistance** - Help with command failures

## Natural Language to Commands

```bash
# Instead of remembering complex syntax:
$ gh copilot suggest "find all Python files modified in the last 7 days"

# Copilot suggests:
# find . -name "*.py" -mtime -7

# With explanation and safety warnings
```

## Building CLI Copilot Features

```python
import os
import subprocess
from dataclasses import dataclass
from enum import Enum

class Shell(Enum):
    BASH = "bash"
    ZSH = "zsh"
    POWERSHELL = "powershell"
    CMD = "cmd"

@dataclass
class CommandSuggestion:
    command: str
    explanation: str
    warnings: list[str]
    confidence: float

class CLICopilot:
    """AI-powered CLI assistant."""

    def __init__(self, client):
        self.client = client
        self.shell = self._detect_shell()
        self.os_type = self._detect_os()

    async def suggest_command(
        self,
        natural_language: str,
        cwd: str = None
    ) -> CommandSuggestion:
        """Convert natural language to shell command."""

        context = self._get_context(cwd)

        prompt = f"""Convert this request to a shell command.

System: {self.os_type}
Shell: {self.shell.value}
Current directory: {context['cwd']}

Request: {natural_language}

Provide:
1. The exact command to run
2. Brief explanation of what it does
3. Any warnings about potential risks
4. Confidence level (0-1)

Format as JSON:
{{"command": "...", "explanation": "...", "warnings": [...], "confidence": 0.9}}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a CLI expert. Provide safe, accurate commands."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1
        )

        import json
        try:
            result = json.loads(response.content)
            return CommandSuggestion(**result)
        except:
            return CommandSuggestion(
                command="",
                explanation="Could not parse response",
                warnings=["Parse error"],
                confidence=0
            )

    async def explain_command(
        self,
        command: str
    ) -> str:
        """Explain what a command does."""

        prompt = f"""Explain this shell command in detail.

Command: {command}

Provide:
1. Overall purpose
2. Each component/flag explained
3. What output to expect
4. Any risks or side effects
5. Common variations

Be thorough but clear."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def troubleshoot_error(
        self,
        command: str,
        error_output: str,
        exit_code: int = None
    ) -> dict:
        """Help troubleshoot command error."""

        prompt = f"""Help troubleshoot this command error.

Command: {command}
Exit code: {exit_code or 'unknown'}
Error output:
{error_output}

System: {self.os_type}

Provide:
1. What the error means
2. Most likely causes
3. Steps to fix
4. Corrected command if applicable
5. How to prevent in future"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return {
            "diagnosis": response.content,
            "original_command": command
        }

    def _detect_shell(self) -> Shell:
        """Detect current shell."""
        shell = os.environ.get("SHELL", "")
        if "zsh" in shell:
            return Shell.ZSH
        elif "bash" in shell:
            return Shell.BASH
        elif os.name == "nt":
            return Shell.POWERSHELL
        return Shell.BASH

    def _detect_os(self) -> str:
        """Detect operating system."""
        import platform
        return f"{platform.system()} {platform.release()}"

    def _get_context(self, cwd: str = None) -> dict:
        """Get current context."""
        return {
            "cwd": cwd or os.getcwd(),
            "user": os.environ.get("USER", "unknown")
        }
```

## Command Categories

```python
class CommandCategorizer:
    """Categorize and validate commands."""

    DANGEROUS_PATTERNS = [
        r"rm\s+-rf\s+/",
        r"rm\s+-rf\s+\*",
        r"mkfs",
        r"dd\s+if=",
        r">\s*/dev/sd",
        r"chmod\s+-R\s+777",
        r"curl.*\|\s*(ba)?sh",
    ]

    CATEGORIES = {
        "file_operations": ["ls", "cd", "cp", "mv", "rm", "mkdir", "touch", "cat", "find"],
        "text_processing": ["grep", "sed", "awk", "sort", "uniq", "cut", "tr", "wc"],
        "network": ["curl", "wget", "ssh", "scp", "ping", "netstat", "nc"],
        "process": ["ps", "kill", "top", "htop", "bg", "fg", "nohup"],
        "package": ["apt", "yum", "brew", "pip", "npm", "cargo"],
        "git": ["git"],
        "docker": ["docker", "docker-compose"],
        "kubernetes": ["kubectl", "helm"]
    }

    def analyze_command(self, command: str) -> dict:
        """Analyze a command for safety and category."""
        import re

        # Check for dangerous patterns
        dangers = []
        for pattern in self.DANGEROUS_PATTERNS:
            if re.search(pattern, command):
                dangers.append(pattern)

        # Determine category
        first_word = command.split()[0] if command else ""
        category = "other"
        for cat, commands in self.CATEGORIES.items():
            if first_word in commands:
                category = cat
                break

        return {
            "command": command,
            "category": category,
            "is_dangerous": len(dangers) > 0,
            "danger_patterns": dangers,
            "requires_confirmation": len(dangers) > 0 or "sudo" in command
        }
```

## Interactive CLI Session

```python
class InteractiveCLICopilot:
    """Interactive CLI session with AI assistance."""

    def __init__(self, copilot: CLICopilot):
        self.copilot = copilot
        self.history = []

    async def run_session(self):
        """Run interactive session."""
        print("CLI Copilot - Type 'help' for commands, 'exit' to quit")

        while True:
            try:
                user_input = input("\n> ").strip()

                if user_input.lower() == "exit":
                    break
                elif user_input.lower() == "help":
                    self._print_help()
                elif user_input.startswith("?"):
                    # Natural language query
                    query = user_input[1:].strip()
                    await self._handle_query(query)
                elif user_input.startswith("!"):
                    # Explain command
                    command = user_input[1:].strip()
                    await self._explain_command(command)
                else:
                    # Execute command
                    await self._execute_and_assist(user_input)

            except KeyboardInterrupt:
                print("\nUse 'exit' to quit")

    async def _handle_query(self, query: str):
        """Handle natural language query."""
        print("Thinking...")

        suggestion = await self.copilot.suggest_command(query)

        print(f"\nSuggested command: {suggestion.command}")
        print(f"Explanation: {suggestion.explanation}")

        if suggestion.warnings:
            print(f"Warnings: {', '.join(suggestion.warnings)}")

        confirm = input("\nExecute? [y/N]: ").strip().lower()
        if confirm == "y":
            await self._execute_and_assist(suggestion.command)

    async def _explain_command(self, command: str):
        """Explain a command."""
        print("Analyzing command...")
        explanation = await self.copilot.explain_command(command)
        print(f"\n{explanation}")

    async def _execute_and_assist(self, command: str):
        """Execute command and assist with errors."""
        import subprocess

        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.stdout:
                print(result.stdout)

            if result.returncode != 0:
                print(f"Command failed with exit code {result.returncode}")
                if result.stderr:
                    print(result.stderr)

                help_prompt = input("Get help troubleshooting? [y/N]: ").strip().lower()
                if help_prompt == "y":
                    diagnosis = await self.copilot.troubleshoot_error(
                        command,
                        result.stderr or result.stdout,
                        result.returncode
                    )
                    print(f"\n{diagnosis['diagnosis']}")

            self.history.append({
                "command": command,
                "success": result.returncode == 0
            })

        except subprocess.TimeoutExpired:
            print("Command timed out after 30 seconds")

    def _print_help(self):
        """Print help message."""
        print("""
CLI Copilot Commands:
  ? <request>   - Convert natural language to command
  ! <command>   - Explain what a command does
  <command>     - Execute command with error assistance
  help          - Show this help
  exit          - Exit CLI Copilot

Examples:
  ? find all log files larger than 100MB
  ! tar -czvf archive.tar.gz /path/to/dir
  ls -la
""")
```

## Integration with zsh/bash

```bash
# Add to .zshrc or .bashrc for quick access

# Copilot suggest shortcut
copilot_suggest() {
    local query="$*"
    gh copilot suggest "$query"
}
alias '??'='copilot_suggest'

# Copilot explain shortcut
copilot_explain() {
    local cmd="$*"
    gh copilot explain "$cmd"
}
alias '?!'='copilot_explain'

# Usage:
# ?? "find all files modified today"
# ?! "tar -czvf archive.tar.gz ."
```

Copilot CLI removes the friction of command-line work. Whether you're learning new tools or working with unfamiliar systems, AI assistance is just a keystroke away.
