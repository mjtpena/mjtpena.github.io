---
title: "Developer Productivity Tools and Practices for 2023"
author: Michael John Peña
draft: false
date: 2022-12-15
tags:
  - Developer Productivity
  - Tools
  - Best Practices
  - IDE
  - AI
---

## AI-Assisted Development

### GitHub Copilot
The game-changer for code generation:

```python
# With Copilot, you type comments and get code
# "Create a function that fetches data from an API with retry logic"

import aiohttp
import asyncio
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
async def fetch_with_retry(url: str, headers: dict = None) -> dict:
    """Fetch data from URL with automatic retry on failure."""
    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers) as response:
            response.raise_for_status()
            return await response.json()
```

### ChatGPT Integration
Beyond Copilot, ChatGPT helps with:
- Code explanation and review
- Documentation generation
- Debugging assistance
- Learning new concepts

## IDE Optimization

### VS Code Extensions
Essential productivity extensions:

```json
{
  "recommendations": [
    "GitHub.copilot",
    "ms-dotnettools.csharp",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "eamodio.gitlens",
    "ms-azuretools.vscode-docker",
    "hashicorp.terraform",
    "redhat.vscode-yaml",
    "streetsidesoftware.code-spell-checker",
    "usernamehw.errorlens",
    "christian-kohler.path-intellisense",
    "formulahendry.auto-rename-tag",
    "ms-vscode.live-server"
  ]
}
```

### Keybindings for Speed

```json
{
  "key": "ctrl+shift+t",
  "command": "workbench.action.terminal.toggleTerminal"
},
{
  "key": "ctrl+shift+g",
  "command": "workbench.view.scm"
},
{
  "key": "ctrl+shift+e",
  "command": "workbench.view.explorer"
},
{
  "key": "ctrl+shift+f",
  "command": "workbench.action.findInFiles"
},
{
  "key": "ctrl+shift+p",
  "command": "workbench.action.showCommands"
},
{
  "key": "ctrl+`",
  "command": "workbench.action.terminal.focus"
},
{
  "key": "ctrl+shift+`",
  "command": "workbench.action.terminal.new"
}
```

## Workflow Automation

### Git Hooks

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running pre-commit checks..."

# Format code
dotnet format --verify-no-changes
if [ $? -ne 0 ]; then
    echo "Code formatting issues found. Run 'dotnet format' to fix."
    exit 1
fi

# Run linter
dotnet build --no-restore -warnaserror
if [ $? -ne 0 ]; then
    echo "Build warnings found."
    exit 1
fi

# Run tests
dotnet test --no-build --filter "Category!=Integration"
if [ $? -ne 0 ]; then
    echo "Tests failed."
    exit 1
fi

echo "Pre-commit checks passed!"
```

### Task Automation

```json
// .vscode/tasks.json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Build and Test",
      "type": "shell",
      "command": "dotnet build && dotnet test",
      "group": {
        "kind": "build",
        "isDefault": true
      },
      "problemMatcher": "$msCompile"
    },
    {
      "label": "Start Docker Compose",
      "type": "shell",
      "command": "docker-compose up -d",
      "problemMatcher": []
    },
    {
      "label": "Run with Watch",
      "type": "shell",
      "command": "dotnet watch run",
      "isBackground": true,
      "problemMatcher": []
    },
    {
      "label": "Generate API Client",
      "type": "shell",
      "command": "openapi-generator-cli generate -i ./openapi.yaml -g typescript-axios -o ./src/api",
      "problemMatcher": []
    }
  ]
}
```

## CLI Power Tools

### Modern CLI Alternatives

```bash
# Install modern CLI tools
# Instead of ls -> use exa
brew install exa
alias ls='exa --icons'
alias ll='exa -la --icons'
alias tree='exa --tree'

# Instead of cat -> use bat
brew install bat
alias cat='bat'

# Instead of find -> use fd
brew install fd
# fd pattern

# Instead of grep -> use ripgrep
brew install ripgrep
# rg pattern

# Better git log
git config --global alias.lg "log --color --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit"

# fzf for fuzzy finding
brew install fzf
# ctrl+r for history search
# ctrl+t for file search
```

### Shell Functions

```bash
# ~/.zshrc or ~/.bashrc

# Quick project navigation
function proj() {
    cd ~/projects/$1
}

# Create and enter directory
function mkcd() {
    mkdir -p "$1" && cd "$1"
}

# Git shortcuts
function gco() {
    git checkout "$1"
}

function gp() {
    git pull origin $(git branch --show-current)
}

function gpu() {
    git push origin $(git branch --show-current)
}

# Docker cleanup
function docker-clean() {
    docker system prune -af
    docker volume prune -f
}

# Azure login with subscription selection
function azlogin() {
    az login
    az account list --output table
    echo "Enter subscription name:"
    read sub
    az account set --subscription "$sub"
}

# Quick HTTP server
function serve() {
    python3 -m http.server ${1:-8000}
}
```

## Documentation as Code

### ADR (Architecture Decision Records)

```markdown
# ADR 001: Use Azure Cosmos DB for Order Storage

## Status
Accepted

## Context
We need a database for storing order data. Requirements:
- Global distribution (customers worldwide)
- Sub-10ms reads
- Handle 10,000 orders/minute at peak
- JSON document flexibility

## Decision
Use Azure Cosmos DB with SQL API.

## Consequences
### Positive
- Built-in global distribution
- Guaranteed <10ms reads at P99
- Automatic indexing
- Serverless option for dev/test

### Negative
- Higher cost than SQL for simple queries
- Different query syntax than SQL Server
- Team needs training

## Alternatives Considered
- Azure SQL: Good for transactional, but global distribution is complex
- MongoDB Atlas: Similar capabilities, but less Azure integration
```

### Living Documentation

```yaml
# docs/runbook.yaml
service: order-service
version: 2.1.0

alerts:
  high_error_rate:
    description: Error rate exceeds 1%
    severity: P2
    runbook: |
      1. Check recent deployments: `kubectl rollout history deployment/order-service`
      2. Check logs: `kubectl logs -l app=order-service --tail=100`
      3. Check dependencies: CosmosDB, ServiceBus
      4. If recent deployment, rollback: `kubectl rollout undo deployment/order-service`
      5. Escalate to on-call if not resolved in 15 minutes

  high_latency:
    description: P95 latency exceeds 500ms
    severity: P3
    runbook: |
      1. Check current load: Grafana dashboard
      2. Check database query times
      3. Scale if needed: `kubectl scale deployment/order-service --replicas=5`
      4. Check for slow queries in Cosmos DB

dependencies:
  - name: cosmos-db
    type: database
    health_check: https://order-service/health/cosmos
    contact: data-team@company.com

  - name: service-bus
    type: messaging
    health_check: https://order-service/health/servicebus
    contact: platform-team@company.com
```

## Time Management

### Focus Blocks

```python
# Schedule template for deep work
daily_schedule = {
    "09:00-12:00": {
        "type": "deep_work",
        "rules": ["No meetings", "Notifications off", "Complex coding tasks"]
    },
    "12:00-13:00": {
        "type": "break",
        "rules": ["Lunch", "Walk", "No screens"]
    },
    "13:00-14:00": {
        "type": "collaboration",
        "rules": ["Code reviews", "Quick syncs", "Slack catchup"]
    },
    "14:00-16:00": {
        "type": "deep_work",
        "rules": ["Feature development", "Writing"]
    },
    "16:00-17:00": {
        "type": "admin",
        "rules": ["Email", "Planning", "Documentation"]
    }
}
```

## Measuring Productivity

```python
productivity_metrics = {
    "output_quality": {
        "bugs_per_feature": "Track defects introduced",
        "code_review_iterations": "Fewer is better",
        "test_coverage": "Maintain threshold"
    },
    "velocity": {
        "cycle_time": "Time from start to production",
        "deployment_frequency": "How often you ship",
        "pr_merge_time": "Time to review and merge"
    },
    "wellbeing": {
        "focus_time_percentage": "Time in deep work",
        "meeting_hours": "Keep under 20%",
        "after_hours_work": "Minimize"
    }
}
```

## Conclusion

Developer productivity in 2023 will be defined by effective use of AI tools, automation of repetitive tasks, and intentional time management. The best developers aren't just fast coders - they're systems thinkers who optimize their entire workflow.

## Resources

- [GitHub Copilot](https://github.com/features/copilot)
- [VS Code Tips and Tricks](https://code.visualstudio.com/docs/getstarted/tips-and-tricks)
- [The Pragmatic Programmer](https://pragprog.com/titles/tpp20/)
- [Deep Work by Cal Newport](https://www.calnewport.com/books/deep-work/)
