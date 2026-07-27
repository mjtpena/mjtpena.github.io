---
title: "GitHub Required Workflows for Enterprise"
author: "Michael John Peña"
draft: false
date: 2022-10-13
tags: ["GitHub", "GitHub Actions", "Enterprise", "Security"]

---

I wrote "GitHub Required Workflows for Enterprise" to share practical, production-minded guidance on this topic.

## Setting Up Required Workflows

### Organization-Level Configuration

```yaml
# Required workflow stored in central repository
# org/.github-workflows/security-scan.yml

name: Required Security Scan

on:
  workflow_call:

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Run SAST scan
        uses: github/codeql-action/analyze@v2

      - name: Dependency check
        uses: dependency-check/dependency-check-action@main

      - name: Secret scan
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: ${{ github.event.repository.default_branch }}
```

### Implementing Required Workflows

```yaml
# Central compliance workflow
name: Compliance Check

on:
  workflow_call:
    inputs:
      severity-threshold:
        type: string
        default: 'high'

jobs:
  license-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Check licenses
        uses: licensefinder/license_finder@main
        with:
          decisions_file: doc/dependency_decisions.yml

  vulnerability-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Scan for vulnerabilities
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          severity: ${{ inputs.severity-threshold }}
          exit-code: '1'

  code-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: SonarQube scan
        uses: sonarsource/sonarqube-scan-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
```

### Repository Using Required Workflow

```yaml
# Individual repo workflow
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm test
      - run: npm run build

  # Required workflow is automatically enforced
  # No need to explicitly call it - it runs automatically
```

## Best Practices

1. **Start with audit mode** - Monitor before enforcing
2. **Provide clear documentation** - Help teams understand requirements
3. **Allow exceptions** - Have process for legitimate bypasses
4. **Version workflows** - Use tags for stability
5. **Monitor compliance** - Track enforcement across repos

Required workflows ensure consistent security and quality standards across the enterprise.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
