---
title: "GitHub Actions Caching Strategies"
author: "Michael John Peña"
draft: false
date: 2022-10-17
tags: ["GitHub", "GitHub Actions", "Performance", "Caching"]

---

I wrote "GitHub Actions Caching Strategies" to share practical, production-minded guidance on this topic.

## Caching Fundamentals

```yaml
name: Build with Caching

on: push

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      # NPM caching
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      # Manual cache for custom paths
      - uses: actions/cache@v3
        with:
          path: |
            ~/.cache/custom
            .build-cache
          key: ${{ runner.os }}-custom-${{ hashFiles('**/config.json') }}
          restore-keys: |
            ${{ runner.os }}-custom-

      # Gradle caching
      - uses: actions/cache@v3
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: ${{ runner.os }}-gradle-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}

      # Docker layer caching
      - uses: docker/setup-buildx-action@v2
      - uses: docker/build-push-action@v4
        with:
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - run: npm ci
      - run: npm run build
```

## Language-Specific Caching

```yaml
# Python with pip
- uses: actions/cache@v3
  with:
    path: ~/.cache/pip
    key: ${{ runner.os }}-pip-${{ hashFiles('**/requirements.txt') }}

# Ruby with Bundler
- uses: actions/cache@v3
  with:
    path: vendor/bundle
    key: ${{ runner.os }}-gems-${{ hashFiles('**/Gemfile.lock') }}

# Go modules
- uses: actions/cache@v3
  with:
    path: ~/go/pkg/mod
    key: ${{ runner.os }}-go-${{ hashFiles('**/go.sum') }}
```

Proper caching can reduce build times by 50-80% for dependency-heavy projects.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
