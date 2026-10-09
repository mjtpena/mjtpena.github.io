---
title: "GitHub Actions Larger Runners Deep Dive"
description: "Larger runners can dramatically reduce build times when used effectively with parallelizable workloads."
author: "Michael John Peña"
draft: false
date: 2022-10-12
tags: ["GitHub", "GitHub Actions", "CI/CD", "Performance"]
---

## Understanding Larger Runners

### Available Runner Sizes

```yaml
# Runner specifications comparison
runners:
  standard:
    name: ubuntu-latest
    cpu: 2 cores
    memory: 7 GB
    storage: 14 GB
    cost: included

  4-core:
    name: ubuntu-latest-4-cores
    cpu: 4 cores
    memory: 16 GB
    storage: 150 GB
    cost: 2x standard

  8-core:
    name: ubuntu-latest-8-cores
    cpu: 8 cores
    memory: 32 GB
    storage: 300 GB
    cost: 4x standard

  16-core:
    name: ubuntu-latest-16-cores
    cpu: 16 cores
    memory: 64 GB
    storage: 600 GB
    cost: 8x standard

  32-core:
    name: ubuntu-latest-32-cores
    cpu: 32 cores
    memory: 128 GB
    storage: 600 GB
    cost: 16x standard

  64-core:
    name: ubuntu-latest-64-cores
    cpu: 64 cores
    memory: 256 GB
    storage: 600 GB
    cost: 32x standard
```

### When to Use Larger Runners

```yaml
name: Optimized Build Pipeline

on:
  push:
    branches: [main]

jobs:
  # Standard runner for simple tasks
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm run lint

  # Larger runner for parallel tests
  test:
    runs-on: ubuntu-latest-8-cores
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      - run: npm ci
      - run: npm test -- --maxWorkers=8

  # Extra large for build-intensive tasks
  build:
    runs-on: ubuntu-latest-16-cores
    steps:
      - uses: actions/checkout@v3

      - name: Setup build environment
        run: |
          sudo apt-get update
          sudo apt-get install -y build-essential

      - name: Parallel compilation
        run: make -j16

      - uses: actions/upload-artifact@v3
        with:
          name: build-output
          path: dist/

  # Large runner for Docker builds
  docker:
    runs-on: ubuntu-latest-8-cores
    steps:
      - uses: actions/checkout@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

      - name: Build image with parallel layers
        uses: docker/build-push-action@v4
        with:
          context: .
          push: false
          tags: myapp:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            PARALLELISM=8
```

### .NET Build Optimization

```yaml
name: .NET Build with Larger Runners

on: [push]

jobs:
  build-and-test:
    runs-on: ubuntu-latest-8-cores
    steps:
      - uses: actions/checkout@v3

      - name: Setup .NET
        uses: actions/setup-dotnet@v3
        with:
          dotnet-version: '7.0.x'

      - name: Restore with parallel downloads
        run: dotnet restore --verbosity minimal /p:RestoreUseParallelPackages=true

      - name: Build with max parallelism
        run: dotnet build --configuration Release --no-restore /p:BuildInParallel=true /maxcpucount:8

      - name: Test with parallel execution
        run: dotnet test --configuration Release --no-build --parallel /p:ParallelizeTestCollections=true
```

### Node.js/npm Optimization

```yaml
name: Node.js Build Optimization

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest-4-cores
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install with network concurrency
        run: npm ci --prefer-offline

      - name: Build with parallel processing
        run: npm run build
        env:
          # Webpack/Vite parallelism
          PARALLEL_WEBPACK: true
          NODE_OPTIONS: --max-old-space-size=8192

      - name: Run Jest with workers
        run: npm test -- --maxWorkers=4 --coverage
```

### Android Build Optimization

```yaml
name: Android Build

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest-16-cores
    steps:
      - uses: actions/checkout@v3

      - name: Set up JDK
        uses: actions/setup-java@v3
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Setup Gradle
        uses: gradle/gradle-build-action@v2
        with:
          gradle-home-cache-cleanup: true

      - name: Build with Gradle
        run: ./gradlew assembleRelease
        env:
          GRADLE_OPTS: -Dorg.gradle.parallel=true -Dorg.gradle.workers.max=16 -Xmx8g

      - name: Run tests
        run: ./gradlew test
        env:
          GRADLE_OPTS: -Dorg.gradle.parallel=true -Dorg.gradle.workers.max=16
```

### Cost Optimization Strategies

```yaml
name: Cost-Optimized Pipeline

on:
  push:
    branches: [main]
  pull_request:

jobs:
  # Quick checks on standard runner
  quick-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm run lint
      - run: npm run typecheck

  # Full build only on main or manual trigger
  full-build:
    if: github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'
    needs: quick-checks
    runs-on: ubuntu-latest-16-cores
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run build:production

  # PR builds use smaller runner
  pr-build:
    if: github.event_name == 'pull_request'
    needs: quick-checks
    runs-on: ubuntu-latest-4-cores
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run build
```

### Monitoring Runner Performance

```yaml
name: Build with Performance Metrics

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest-8-cores
    steps:
      - uses: actions/checkout@v3

      - name: Start timing
        id: timing
        run: echo "start=$(date +%s)" >> $GITHUB_OUTPUT

      - name: System info
        run: |
          echo "CPU Info:"
          nproc
          lscpu | grep "Model name"
          echo "Memory Info:"
          free -h
          echo "Disk Info:"
          df -h

      - name: Build
        run: npm ci && npm run build

      - name: Report timing
        run: |
          end=$(date +%s)
          duration=$((end - ${{ steps.timing.outputs.start }}))
          echo "Build duration: ${duration} seconds"
          echo "### Build Performance" >> $GITHUB_STEP_SUMMARY
          echo "- Duration: ${duration}s" >> $GITHUB_STEP_SUMMARY
          echo "- Runner: ubuntu-latest-8-cores" >> $GITHUB_STEP_SUMMARY
```

## Best Practices

1. **Profile first** - Measure before choosing runner size
2. **Use caching** - Reduce repeated work regardless of runner
3. **Parallelize effectively** - Ensure code can use multiple cores
4. **Right-size for task** - Match runner to workload
5. **Monitor costs** - Track usage and optimize

Larger runners can dramatically reduce build times when used effectively with parallelizable workloads.
