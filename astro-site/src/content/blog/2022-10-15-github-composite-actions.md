---
title: "Building GitHub Composite Actions"
author: "Michael John Peña"
draft: false
date: 2022-10-15
tags: ["GitHub", "GitHub Actions", "Automation", "DevOps"]

---

I wrote "Building GitHub Composite Actions" to share practical, production-minded guidance on this topic.

## Creating Composite Actions

```yaml
# .github/actions/setup-dotnet-project/action.yml
name: 'Setup .NET Project'
description: 'Setup .NET environment with caching'

inputs:
  dotnet-version:
    description: '.NET version'
    required: false
    default: '7.0.x'
  project-path:
    description: 'Path to project'
    required: false
    default: '.'

outputs:
  cache-hit:
    description: 'Cache hit status'
    value: ${{ steps.cache.outputs.cache-hit }}

runs:
  using: 'composite'
  steps:
    - name: Setup .NET
      uses: actions/setup-dotnet@v3
      with:
        dotnet-version: ${{ inputs.dotnet-version }}

    - name: Cache NuGet packages
      id: cache
      uses: actions/cache@v3
      with:
        path: ~/.nuget/packages
        key: ${{ runner.os }}-nuget-${{ hashFiles('**/*.csproj') }}

    - name: Restore dependencies
      shell: bash
      working-directory: ${{ inputs.project-path }}
      run: dotnet restore
```

## Using Composite Actions

```yaml
name: Build

on: push

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup project
        uses: ./.github/actions/setup-dotnet-project
        with:
          dotnet-version: '7.0.x'

      - name: Build
        run: dotnet build --configuration Release
```

Composite actions bridge the gap between simple step sequences and full custom actions.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
