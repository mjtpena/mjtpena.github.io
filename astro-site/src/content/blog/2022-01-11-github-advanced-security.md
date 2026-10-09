---
title: "GitHub Advanced Security: Enterprise-Grade Security for Your Code"
description: "GitHub Advanced Security transforms security from a gate to a continuous process integrated into your development workflow."
author: Michael John Peña
draft: false
date: 2022-01-11
url: /blog/github-advanced-security/
tags:
  - GitHub
  - Security
  - DevOps
  - devsecops
---

## What is GitHub Advanced Security?

GHAS includes three main features:
- Code scanning (find vulnerabilities in your code)
- Secret scanning (detect exposed credentials)
- Dependency review (security advisories for dependencies)

## Enabling Advanced Security

```yaml
# In your repository settings or via API
name: Enable GHAS
on:
  repository_dispatch:
    types: [enable-ghas]

jobs:
  enable:
    runs-on: ubuntu-latest
    steps:
      - name: Enable Advanced Security
        uses: actions/github-script@v6
        with:
          github-token: ${{ secrets.ADMIN_TOKEN }}
          script: |
            await github.rest.repos.update({
              owner: context.repo.owner,
              repo: context.repo.repo,
              security_and_analysis: {
                advanced_security: { status: 'enabled' },
                secret_scanning: { status: 'enabled' },
                secret_scanning_push_protection: { status: 'enabled' }
              }
            });
```

## Code Scanning with CodeQL

Create a comprehensive code scanning workflow:

```yaml
# .github/workflows/codeql-analysis.yml
name: "CodeQL"

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '30 1 * * 1'  # Weekly scan

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write

    strategy:
      fail-fast: false
      matrix:
        language: [ 'csharp', 'javascript', 'python' ]

    steps:
      - name: Checkout repository
        uses: actions/checkout@v3

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v2
        with:
          languages: ${{ matrix.language }}
          queries: +security-extended,security-and-quality

      - name: Setup .NET
        if: matrix.language == 'csharp'
        uses: actions/setup-dotnet@v2
        with:
          dotnet-version: '6.0.x'

      - name: Build C#
        if: matrix.language == 'csharp'
        run: dotnet build --configuration Release

      - name: Autobuild
        if: matrix.language != 'csharp'
        uses: github/codeql-action/autobuild@v2

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v2
        with:
          category: "/language:${{ matrix.language }}"
```

## Custom CodeQL Queries

Create custom security queries:

```ql
// queries/sql-injection.ql
/**
 * @name SQL injection vulnerability
 * @description User input in SQL queries without sanitization
 * @kind path-problem
 * @problem.severity error
 * @security-severity 9.8
 * @precision high
 * @id cs/sql-injection
 * @tags security
 *       external/cwe/cwe-089
 */

import csharp
import semmle.code.csharp.security.dataflow.SqlInjection::SqlInjection
import DataFlow::PathGraph

from SqlInjectionConfig config, DataFlow::PathNode source, DataFlow::PathNode sink
where config.hasFlowPath(source, sink)
select sink.getNode(), source, sink, "SQL injection from $@.", source.getNode(), "user input"
```

## Secret Scanning Configuration

Configure custom secret patterns:

```yaml
# .github/secret_scanning.yml
paths-ignore:
  - "test/**"
  - "**/*_test.go"

# Define custom patterns in organization settings
```

## Secret Scanning Alerts API

```python
import requests

def get_secret_alerts(owner, repo, token):
    url = f"https://api.github.com/repos/{owner}/{repo}/secret-scanning/alerts"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json"
    }

    response = requests.get(url, headers=headers)
    alerts = response.json()

    for alert in alerts:
        print(f"Secret Type: {alert['secret_type']}")
        print(f"State: {alert['state']}")
        print(f"Location: {alert['locations_url']}")
        print("---")

    return alerts

# Resolve an alert
def resolve_alert(owner, repo, alert_number, token, resolution):
    url = f"https://api.github.com/repos/{owner}/{repo}/secret-scanning/alerts/{alert_number}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json"
    }
    data = {
        "state": "resolved",
        "resolution": resolution  # "false_positive", "wont_fix", "revoked", "used_in_tests"
    }

    response = requests.patch(url, headers=headers, json=data)
    return response.json()
```

## Branch Protection with Security Checks

```yaml
# Require code scanning to pass before merge
name: Enforce Security
on:
  pull_request:
    branches: [main]

jobs:
  security-gate:
    runs-on: ubuntu-latest
    steps:
      - name: Check for critical vulnerabilities
        uses: actions/github-script@v6
        with:
          script: |
            const { data: alerts } = await github.rest.codeScanning.listAlertsForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'open',
              severity: 'critical'
            });

            if (alerts.length > 0) {
              core.setFailed(`Found ${alerts.length} critical vulnerabilities`);
            }
```

GitHub Advanced Security transforms security from a gate to a continuous process integrated into your development workflow.
