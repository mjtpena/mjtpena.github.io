---
title: "GitHub Actions Improvements - October 2022"
description: "GitHub now offers larger hosted runners for more demanding workloads. Enforce workflows across all repositories in an organization."
author: "Michael John Peña"
draft: false
date: 2022-10-11
tags: ["GitHub", "GitHub Actions", "CI/CD", "DevOps"]
---

## Larger Runners

GitHub now offers larger hosted runners for more demanding workloads.

```yaml
name: Build with Larger Runners

on: [push]

jobs:
  build-large:
    # Use larger runner for intensive builds
    runs-on: ubuntu-latest-8-cores
    steps:
      - uses: actions/checkout@v3

      - name: Setup .NET
        uses: actions/setup-dotnet@v3
        with:
          dotnet-version: '7.0.x'

      - name: Build large solution
        run: dotnet build --configuration Release

      - name: Run parallel tests
        run: dotnet test --configuration Release --parallel

  build-xlarge:
    # Extra large runner for very intensive workloads
    runs-on: ubuntu-latest-16-cores
    steps:
      - uses: actions/checkout@v3

      - name: Complex build process
        run: |
          # This build benefits from 16 cores
          make -j16 all
```

### Runner Specifications

```yaml
# Available larger runners
runners:
  # Linux runners
  ubuntu-latest-4-cores:
    cpu: 4
    memory: 16GB
    storage: 150GB

  ubuntu-latest-8-cores:
    cpu: 8
    memory: 32GB
    storage: 300GB

  ubuntu-latest-16-cores:
    cpu: 16
    memory: 64GB
    storage: 600GB

  # Windows runners
  windows-latest-8-cores:
    cpu: 8
    memory: 32GB
    storage: 300GB

  # macOS runners
  macos-latest-xlarge:
    cpu: 12
    memory: 30GB
    storage: 14GB
```

## Required Workflows

Enforce workflows across all repositories in an organization.

```yaml
# .github/workflows/required-security-scan.yml
# This workflow is required for all repos

name: Required Security Scan

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Run security scan
        uses: github/codeql-action/analyze@v2

      - name: Check for vulnerabilities
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

      - name: License compliance
        run: |
          npx license-checker --onlyAllow 'MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause'
```

### Configuring Required Workflows

```yaml
# Organization-level configuration
# Settings > Actions > Required workflows

required_workflows:
  - path: .github/workflows/security-scan.yml
    repository: org/security-workflows
    ref: main
    targets:
      - all  # Apply to all repos
      # Or specific repos:
      # - repo1
      # - repo2

  - path: .github/workflows/code-quality.yml
    repository: org/quality-workflows
    ref: v1.0.0
    targets:
      - team-a/*
      - team-b/*
```

## Reusable Workflows

```yaml
# .github/workflows/reusable-deploy.yml
name: Reusable Deploy Workflow

on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      artifact-name:
        required: true
        type: string
    secrets:
      deploy-token:
        required: true
    outputs:
      deploy-url:
        description: "The deployment URL"
        value: ${{ jobs.deploy.outputs.url }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    outputs:
      url: ${{ steps.deploy.outputs.url }}
    steps:
      - name: Download artifact
        uses: actions/download-artifact@v3
        with:
          name: ${{ inputs.artifact-name }}

      - name: Deploy
        id: deploy
        run: |
          # Deploy logic here
          echo "url=https://${{ inputs.environment }}.example.com" >> $GITHUB_OUTPUT
        env:
          DEPLOY_TOKEN: ${{ secrets.deploy-token }}
```

```yaml
# Calling workflow
name: CI/CD Pipeline

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci && npm run build
      - uses: actions/upload-artifact@v3
        with:
          name: dist
          path: dist/

  deploy-staging:
    needs: build
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: staging
      artifact-name: dist
    secrets:
      deploy-token: ${{ secrets.STAGING_DEPLOY_TOKEN }}

  deploy-production:
    needs: deploy-staging
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: production
      artifact-name: dist
    secrets:
      deploy-token: ${{ secrets.PROD_DEPLOY_TOKEN }}
```

## Enhanced Caching

```yaml
name: Build with Enhanced Caching

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      # Improved cache with better key management
      - name: Cache dependencies
        uses: actions/cache@v3
        id: cache
        with:
          path: |
            ~/.npm
            node_modules
            ~/.cache/Cypress
          key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-node-
          # New: Save cache even on failure
          save-always: true

      - name: Install dependencies
        if: steps.cache.outputs.cache-hit != 'true'
        run: npm ci

      # Build caching
      - name: Cache build output
        uses: actions/cache@v3
        with:
          path: .next/cache
          key: ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}-${{ hashFiles('**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx') }}
          restore-keys: |
            ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}-

      - name: Build
        run: npm run build
```

## Composite Actions

```yaml
# .github/actions/setup-project/action.yml
name: 'Setup Project'
description: 'Setup project with all dependencies'

inputs:
  node-version:
    description: 'Node.js version'
    required: false
    default: '18'
  install-cypress:
    description: 'Install Cypress dependencies'
    required: false
    default: 'false'

outputs:
  cache-hit:
    description: 'Whether cache was hit'
    value: ${{ steps.cache.outputs.cache-hit }}

runs:
  using: 'composite'
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: ${{ inputs.node-version }}

    - name: Cache dependencies
      id: cache
      uses: actions/cache@v3
      with:
        path: |
          ~/.npm
          node_modules
        key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}

    - name: Install dependencies
      if: steps.cache.outputs.cache-hit != 'true'
      shell: bash
      run: npm ci

    - name: Install Cypress
      if: inputs.install-cypress == 'true'
      shell: bash
      run: npx cypress install
```

```yaml
# Using the composite action
name: CI

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup project
        uses: ./.github/actions/setup-project
        with:
          node-version: '18'
          install-cypress: 'true'

      - name: Run tests
        run: npm test
```

## OIDC Token Authentication

```yaml
name: Deploy to Azure with OIDC

on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login with OIDC
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy to Azure
        run: |
          az webapp deploy --name myapp --resource-group myRG --src-path ./dist
```

## Best Practices

1. **Use caching aggressively** - Reduce build times significantly
2. **Leverage reusable workflows** - Maintain consistency across repos
3. **Implement required workflows** - Enforce security and quality
4. **Right-size runners** - Balance cost and performance
5. **Use OIDC** - Avoid long-lived credentials

GitHub Actions improvements make CI/CD more efficient, secure, and maintainable.
