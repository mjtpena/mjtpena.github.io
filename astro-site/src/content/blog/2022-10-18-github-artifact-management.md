---
title: "GitHub Actions Artifact Management"
author: "Michael John Peña"
draft: false
date: 2022-10-18
tags: ["GitHub", "GitHub Actions", "Artifacts", "DevOps"]

---

I wrote "GitHub Actions Artifact Management" to share practical, production-minded guidance on this topic.

## Working with Artifacts

```yaml
name: Build and Test Pipeline

on: push

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci && npm run build

      - uses: actions/upload-artifact@v3
        with:
          name: build-output
          path: dist/
          retention-days: 7
          if-no-files-found: error

  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: actions/download-artifact@v3
        with:
          name: build-output
          path: dist/

      - run: npm test

      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: test-results
          path: |
            coverage/
            test-results/

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v3
        with:
          name: build-output

      - run: echo "Deploying..."
```

## Multi-Platform Artifacts

```yaml
jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v3
      - run: npm ci && npm run build

      - uses: actions/upload-artifact@v3
        with:
          name: build-${{ matrix.os }}
          path: dist/

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v3
        with:
          path: artifacts/
```

Proper artifact management enables efficient multi-job pipelines and deployment workflows.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
