---
title: "Keeping Deployments Simple"
description: "For an app with 100 users. Push to main. App deploys. Done. Don't add any of this on day one."
author: Michael John Peña
draft: false
date: 2026-01-30
tags:
  - DevOps
  - Deployment
  - Engineering
  - Simplicity
---

## The Over-Engineered Pipeline

I've seen teams spend months building:
- Multi-environment Kubernetes clusters
- Complex GitOps workflows
- Feature flag systems
- Canary deployments
- Blue-green switching

For an app with 100 users.

## What Actually Mattered

For most projects, this is enough:

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build
        run: |
          docker build -t myapp .
      
      - name: Push to registry
        run: |
          docker push ${{ secrets.REGISTRY }}/myapp:latest
      
      - name: Deploy
        run: |
          az webapp update \
            --resource-group myrg \
            --name myapp \
            --docker-image ${{ secrets.REGISTRY }}/myapp:latest
```

Push to main. App deploys. Done.

## When to Add Complexity

Add staging when:
- You have multiple developers
- Breaking production hurts

Add canary when:
- You have significant traffic
- Rollback needs automation

Add feature flags when:
- You need gradual rollouts
- You want to separate deploy from release

Don't add any of this on day one.

## The Principle

Start simple. Add complexity when pain points emerge.

Your deployment process should match your team size and user base.

## Questions to Ask

**Do we need this?** Probably not yet.

**What problem does this solve?** If you can't articulate it, you don't need it.

**What's the simplest solution?** Start there.

## The Reality

Most apps don't need sophisticated deployment pipelines.

They need reliable, repeatable deployments that the team understands.

Simple beats sophisticated. Every time.
