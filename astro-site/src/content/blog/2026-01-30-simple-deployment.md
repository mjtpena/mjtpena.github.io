---
title: "The Day-One Pipeline: Push to Main, Ship to App Service"
description: "A minimal GitHub Actions to App Service container pipeline for small apps, and the specific signals that tell you when slots, canaries or flags are worth it."
author: Michael John Peña
draft: false
date: 2026-01-30
tags:
  - DevOps
  - GitHub Actions
  - App Service
  - CI/CD
  - Azure
---

I keep seeing teams spend months on multi-environment Kubernetes clusters, GitOps controllers, feature flag platforms, canary analysis and blue-green switching for an app with 100 users. None of that is wrong in itself. It is wrong as a starting point, because every one of those pieces has to be understood, patched and debugged by the same small team that is supposed to be shipping features.

For most new internal tools and early-stage products, the deployment process you need on day one fits in one workflow file: push to `main`, build an image, deploy it. The harder skill is knowing which pain signals justify adding the next layer.

## What "simple" has to mean

Simple doesn't mean careless. A day-one pipeline still has to meet four bars, and I'd refuse to cut any of them:

- **Repeatable.** Every production change goes through the same automated path, and nothing reaches `main` without passing a required CI check. Nobody deploys from a laptop.
- **Traceable.** You can tell which commit is running in production right now.
- **Reversible.** You can put the previous version back in minutes without a rebuild.
- **No long-lived secrets.** The pipeline shouldn't hold a password that can deploy to production if it leaks.

Everything else (staging environments, approvals, progressive delivery) is an optimisation you add when it pays for itself.

## The whole pipeline

This assumes an existing Linux web app on Azure App Service configured for a single custom container (not sidecar mode), and an Azure Container Registry in the same resource group. It uses OpenID Connect for the Azure login, ACR Tasks to build the image, and the `azure/webapps-deploy` action to point the app at the new tag. Apps created in sidecar mode set the main container image through the sitecontainers configuration instead, so the deploy and rollback commands here won't change their image.

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

concurrency:
  group: production
  cancel-in-progress: false

env:
  REGISTRY: <your-registry-name>
  IMAGE: myapp
  APP_NAME: <your-app-name>

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v6

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Build and push image with ACR Tasks
        run: |
          az acr build \
            --registry "$REGISTRY" \
            --image "$IMAGE:${{ github.sha }}" \
            .

      - name: Deploy to App Service
        uses: azure/webapps-deploy@v3
        with:
          app-name: ${{ env.APP_NAME }}
          images: ${{ env.REGISTRY }}.azurecr.io/${{ env.IMAGE }}:${{ github.sha }}
```

A few choices in there are deliberate.

**The image tag is the commit SHA, not `latest`.** With `latest`, you can't tell what is running, and "roll back" means rebuilding old code and hoping the build is reproducible. With the SHA, every image in the registry is an immutable record of a commit, and the app's container configuration tells you exactly which one is live. This covers the traceable and reversible bars in one move.

**`az acr build` instead of `docker build` and `docker push`.** The build runs in Azure Container Registry as an [ACR Tasks quick task](https://learn.microsoft.com/azure/container-registry/container-registry-quickstart-task-cli), and the push happens there too, so the runner never needs registry credentials or a `docker login` step. If you'd rather build on the runner (for layer caching, or because the build needs other tools), `az acr login --name <your-registry-name>` after the Azure login gives Docker a token without storing a registry password.

**OIDC instead of a stored service principal secret.** `azure/login@v2` exchanges a short-lived GitHub token for an Azure token through a [federated identity credential](https://learn.microsoft.com/entra/workload-id/workload-identity-federation-create-trust). The three values in GitHub secrets are identifiers, not credentials. I covered the setup in more depth in [OIDC for GitHub Actions](/blog/2022-02-13-oidc-github-actions/). Scope the identity tightly: Contributor on the one resource group that holds the app and registry is the simplest working assignment, and you can narrow it later.

**`concurrency` with `cancel-in-progress: false`.** Two quick merges shouldn't produce two deployments racing each other. This queues them instead of cancelling a deployment halfway through.

**The gate lives on the pull request, not in this file.** A push-to-`main` deploy is only as safe as what's allowed onto `main`. Branch protection on `main` with a required status check (your existing test workflow on pull requests) is part of the day-one bar, not an upgrade. Without it, "repeatable" just means you ship untested code the same way every time. If you have no tests yet, a required check that builds the image is still better than nothing, because it catches a broken Dockerfile before it reaches production.

**`environment: production`.** It costs nothing today, and it gives you somewhere to hang required reviewers or environment-scoped secrets later without restructuring the workflow.

## One-time setup the YAML doesn't show

The web app needs permission to pull from the registry. I'd use the app's managed identity rather than the registry admin account:

```bash
# Give the web app a system-assigned identity
principalId=$(az webapp identity assign \
  --resource-group <your-resource-group> \
  --name <your-app-name> \
  --query principalId --output tsv)

# Allow that identity to pull images
registryId=$(az acr show --name <your-registry-name> --query id --output tsv)
az role assignment create \
  --assignee-object-id "$principalId" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPull \
  --scope "$registryId"

# Tell App Service to use the identity for registry pulls
az webapp config set \
  --resource-group <your-resource-group> \
  --name <your-app-name> \
  --generic-configurations '{"acrUseManagedIdentityCreds": true}'
```

This is the approach in Microsoft's [custom container configuration guide](https://learn.microsoft.com/azure/app-service/configure-custom-container), and it means there's no registry password anywhere, in GitHub or in app settings.

Turn on [health check](https://learn.microsoft.com/azure/app-service/monitor-instances-health-check) with a lightweight endpoint while you're there. It's a few minutes of work and it lets App Service take unhealthy instances out of rotation once you run more than one.

## Rolling back

Because every image is tagged by commit, rollback is a configuration change, not a build:

```bash
az webapp config container set \
  --resource-group <your-resource-group> \
  --name <your-app-name> \
  --container-image-name <your-registry-name>.azurecr.io/myapp:<previous-commit-sha>
```

Then revert the bad commit on `main` so the next push doesn't redeploy it. Write this command down somewhere the on-call person can find it before you need it.

## What this deliberately leaves out

This pipeline has real gaps, and you should know them going in:

- **There is a short restart on every deploy.** Swapping the image on the production slot restarts the container. For an internal tool used during business hours, deploying at lunch is an acceptable mitigation. For a public app with steady traffic, it isn't.
- **There's no pre-production environment.** Required checks catch what your tests cover, but nothing validates the built image running in Azure before users see it.
- **Database migrations aren't handled.** If your schema changes, you need a decision about whether migrations run at app start-up or as a separate step, and they must be backward compatible with the previous image if you want rollback to stay a one-liner.

## When to add the next layer

My rule: add complexity in response to a pain you can name, not one you can imagine. These are the signals I look for, and the smallest addition that answers each one.

| Signal | Smallest fix |
|---|---|
| Deploy restarts are visible to users | A staging deployment slot, then swap into production |
| Several developers merge daily and break each other | A merge queue on `main`, so checks run against the combined changes |
| A bad release reached users before anyone noticed | Swap with preview, or a smoke test against the slot before swapping |
| You need to release a feature to some users first | Feature flags, via Azure App Configuration |
| Rollback must be automatic, not manual | Canary releases with metric-based promotion, which usually means a different hosting model |
| An auditor needs evidence of approvals | Required reviewers on the GitHub `production` environment |

The first row is usually the first one you hit, and [deployment slots](https://learn.microsoft.com/azure/app-service/deploy-staging-slots) are the cheapest answer on App Service. They need the Standard, Premium or Isolated tier (Standard allows five slots), slots cost nothing extra on top of the plan, and a swap warms up the new version on the staging slot before switching traffic, so production stays online. In the workflow, that's one extra `slot-name: staging` input and an `az webapp deployment slot swap` step. One caveat: auto swap isn't supported for Linux apps or Web App for Containers, so the swap has to be an explicit step in the pipeline.

Notice what's last in that table. Canary releases with automated rollback are worth having, but they need meaningful traffic to produce a signal, metrics you trust, and someone who understands the tooling when it misbehaves. With 100 users, a 5% canary is five people, and the statistics won't tell you anything you couldn't learn from an error log. If you get to that point, the trade-offs between rolling, blue-green and canary are covered in [deployment strategies on AKS](/blog/2020-08-06-aks-deployment-strategies/).

## When this isn't the right starting point

I wouldn't use this pipeline as-is when the app is already customer-facing with paying users (start with a staging slot from day one), when regulation requires a documented approval for every production change, or when you're deploying several services that must be released together. In those cases you need more from the first commit. And if your organisation has standardised on Azure Pipelines, the same principles apply; the [Azure DevOps vs GitHub comparison](/blog/2026-01-26-ado-vs-github/) covers that platform choice.

## The test I'd apply

Before adding any deployment machinery, ask three questions. What specific problem does it solve? Have we actually had that problem? What is the smallest change that solves it? If you can't answer the first one in a sentence, you don't need it yet.

Your deployment process should match your team size and your user base, and grow with them. A pipeline the whole team understands, that tags every release by commit and can roll back in one command, beats a sophisticated one that only its author can debug.
