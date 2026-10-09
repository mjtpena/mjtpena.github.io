---
title: "OIDC Tokens in GitHub Actions"
description: "OIDC eliminates the need for long-lived cloud credentials, improving security posture."
author: "Michael John Peña"
draft: false
date: 2022-10-19
tags: ["GitHub", "GitHub Actions", "Security", "OIDC"]
---

## OIDC with Azure

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

      - uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - run: az webapp deploy --name myapp --src-path ./dist
```

## OIDC with AWS

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v2
        with:
          role-to-assume: arn:aws:iam::123456789:role/github-actions
          aws-region: us-east-1

      - run: aws s3 sync ./dist s3://my-bucket
```

## OIDC with GCP

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: google-github-actions/auth@v1
        with:
          workload_identity_provider: projects/123/locations/global/workloadIdentityPools/github/providers/github
          service_account: github-actions@project.iam.gserviceaccount.com

      - run: gcloud run deploy myservice --source .
```

OIDC eliminates the need for long-lived cloud credentials, improving security posture.
