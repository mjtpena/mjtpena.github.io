---
title: "GitHub Reusable Workflows Patterns"
author: "Michael John Peña"
draft: false
date: 2022-10-14
tags: ["GitHub", "GitHub Actions", "CI/CD", "Best Practices"]

---

I wrote "GitHub Reusable Workflows Patterns" to share practical, production-minded guidance on this topic.

## Creating Reusable Workflows

```yaml
# .github/workflows/reusable-build.yml
name: Reusable Build

on:
  workflow_call:
    inputs:
      node-version:
        type: string
        default: '18'
      build-command:
        type: string
        default: 'npm run build'
      artifact-name:
        type: string
        required: true
    secrets:
      npm-token:
        required: false
    outputs:
      artifact-path:
        value: ${{ jobs.build.outputs.path }}

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      path: ${{ steps.upload.outputs.artifact-path }}
    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: ${{ inputs.node-version }}
          cache: 'npm'

      - run: npm ci
        env:
          NPM_TOKEN: ${{ secrets.npm-token }}

      - run: ${{ inputs.build-command }}

      - id: upload
        uses: actions/upload-artifact@v3
        with:
          name: ${{ inputs.artifact-name }}
          path: dist/
```

```yaml
# Calling the reusable workflow
name: CI/CD

on: push

jobs:
  build:
    uses: ./.github/workflows/reusable-build.yml
    with:
      node-version: '18'
      artifact-name: app-build
    secrets:
      npm-token: ${{ secrets.NPM_TOKEN }}

  deploy:
    needs: build
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: production
      artifact-name: app-build
```

## Advanced Patterns

```yaml
# Matrix with reusable workflows
name: Multi-Platform Build

on:
  workflow_call:
    inputs:
      platforms:
        type: string
        default: '["ubuntu-latest", "windows-latest", "macos-latest"]'

jobs:
  build:
    strategy:
      matrix:
        os: ${{ fromJson(inputs.platforms) }}
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v3
      - run: npm ci && npm run build
```

Reusable workflows reduce duplication and improve maintainability across repositories.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
