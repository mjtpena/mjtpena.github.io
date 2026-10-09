---
title: "GitHub Code Scanning: Finding Vulnerabilities Before They Ship"
description: "Code scanning uses CodeQL, a semantic code analysis engine, to find security vulnerabilities, bugs, and other errors in your codebase."
author: Michael John Peña
draft: false
date: 2022-01-13
url: /blog/github-code-scanning/
tags:
  - GitHub
  - Security
  - codeql
  - devsecops
---

## Understanding Code Scanning

Code scanning uses CodeQL, a semantic code analysis engine, to find security vulnerabilities, bugs, and other errors in your codebase.

## Basic Setup

Enable code scanning with a simple workflow:

```yaml
# .github/workflows/codeql.yml
name: "CodeQL Analysis"

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '0 8 * * 1'  # Every Monday at 8 AM

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
        language: [ 'csharp', 'javascript' ]

    steps:
    - name: Checkout repository
      uses: actions/checkout@v3

    - name: Initialize CodeQL
      uses: github/codeql-action/init@v2
      with:
        languages: ${{ matrix.language }}

    - name: Autobuild
      uses: github/codeql-action/autobuild@v2

    - name: Perform CodeQL Analysis
      uses: github/codeql-action/analyze@v2
```

## Advanced Configuration

Configure CodeQL with a custom config file:

```yaml
# .github/codeql/codeql-config.yml
name: "Security and Quality"

queries:
  - uses: security-extended
  - uses: security-and-quality
  - uses: ./custom-queries  # Local custom queries

paths:
  - src
  - lib

paths-ignore:
  - test
  - '**/*.test.js'
  - node_modules

query-filters:
  - exclude:
      id: js/unused-local-variable
  - exclude:
      tags contain: /maintainability/
```

Reference it in your workflow:

```yaml
- name: Initialize CodeQL
  uses: github/codeql-action/init@v2
  with:
    languages: ${{ matrix.language }}
    config-file: ./.github/codeql/codeql-config.yml
```

## Writing Custom CodeQL Queries

Create queries for your specific security needs:

```ql
// queries/hardcoded-credentials.ql
/**
 * @name Hardcoded credentials
 * @description Hardcoded passwords or API keys in source code
 * @kind problem
 * @problem.severity error
 * @security-severity 8.5
 * @precision high
 * @id custom/hardcoded-credentials
 * @tags security
 *       external/cwe/cwe-798
 */

import javascript

class HardcodedCredential extends DataFlow::Node {
  HardcodedCredential() {
    exists(StringLiteral s |
      this.asExpr() = s and
      s.getValue().regexpMatch("(?i).*(password|api.?key|secret|token).*=.*['\"][^'\"]{8,}['\"].*")
    )
  }
}

from HardcodedCredential cred
select cred, "Potential hardcoded credential found"
```

## Integrating with Third-Party Tools

Run additional scanners alongside CodeQL:

```yaml
name: Security Scan

on: [push, pull_request]

jobs:
  codeql:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: github/codeql-action/init@v2
      - uses: github/codeql-action/analyze@v2

  semgrep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Semgrep
        uses: returntocorp/semgrep-action@v1
        with:
          config: >-
            p/security-audit
            p/secrets
            p/owasp-top-ten

  trivy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          format: 'sarif'
          output: 'trivy-results.sarif'

      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'
```

## Handling Alerts

```python
import requests

def get_code_scanning_alerts(owner, repo, token):
    url = f"https://api.github.com/repos/{owner}/{repo}/code-scanning/alerts"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json"
    }

    response = requests.get(url, headers=headers, params={"state": "open"})
    alerts = response.json()

    critical_alerts = [a for a in alerts if a['rule']['security_severity_level'] == 'critical']

    print(f"Total open alerts: {len(alerts)}")
    print(f"Critical alerts: {len(critical_alerts)}")

    for alert in critical_alerts:
        print(f"\nRule: {alert['rule']['description']}")
        print(f"File: {alert['most_recent_instance']['location']['path']}")
        print(f"Line: {alert['most_recent_instance']['location']['start_line']}")

    return alerts
```

## Branch Protection Rules

Require code scanning to pass:

```yaml
# Use GitHub API or UI to set branch protection
name: Enforce Scanning
on:
  pull_request:
    branches: [main]

jobs:
  check-alerts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v6
        with:
          script: |
            const alerts = await github.rest.codeScanning.listAlertsForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              ref: context.payload.pull_request.head.ref,
              state: 'open'
            });

            const critical = alerts.data.filter(
              a => a.rule.security_severity_level === 'critical'
            );

            if (critical.length > 0) {
              core.setFailed(`PR has ${critical.length} critical vulnerabilities`);
            }
```

Code scanning is essential for modern secure development practices.
