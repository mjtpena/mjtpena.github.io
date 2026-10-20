---
title: "ACR Tasks: Build and Patch Container Images Inside the Registry"
description: "How ACR Tasks builds images inside Azure Container Registry, rebuilds them when base images change, and when a CI runner is still the better fit."
author: Michael John Peña
draft: false
date: 2020-08-22
tags:
  - Azure
  - ACR
  - Containers
  - Docker
  - DevOps
---

Most teams treat Azure Container Registry as a place to `docker push` to and nothing more. The image gets built on a CI agent, pushed once, and then sits there while the base image underneath it collects CVEs. The registry already has a feature that fixes the second half of that problem: ACR Tasks, which builds images inside the registry and can rebuild them automatically when their base image is patched.

ACR Tasks is the most under-used part of ACR. I'd turn it on for base image rebuilds even if you never move a single build out of CI.

## What ACR Tasks actually is

ACR Tasks is a build service attached to the registry. You hand it a build context (a local folder, a Git repository, or nothing at all for command-only tasks) and it runs the build on Microsoft-hosted compute, then pushes the result into the same registry. There's no Docker daemon on your machine, no build agent to maintain, and the push travels a very short distance.

It comes in three shapes, all described in the [ACR Tasks overview](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-tasks-overview):

| Shape | Started by | Good for |
|---|---|---|
| Quick task (`az acr build`) | You, on demand | Building from a laptop that has no Docker, or a one-off build |
| Triggered task (`az acr task create`) | Source commits, base image updates, or a schedule | Keeping images current without a pipeline |
| Multi-step task (YAML file) | Any of the above | Build, test and push sequences, or running containers as steps |

The triggered tasks are where the value is. Quick tasks are convenient, but a CI runner can do the same job. Nothing in a typical CI setup reacts to a base image changing, and that's exactly what triggered tasks do.

## A quick build first

The quick task is the fastest way to see how it works. From a folder with a Dockerfile:

```bash
az acr build \
    --registry <your-registry-name> \
    --image myapp:v1 \
    --file Dockerfile \
    .
```

The CLI uploads the context (respecting `.dockerignore`), streams the build log back to your terminal, and pushes `<your-registry-name>.azurecr.io/myapp:v1` when it finishes. Every registry tier (Basic, Standard and Premium) can run tasks, and you pay for the build time rather than for an agent sitting idle.

## Base image updates: the part worth adopting

When a Dockerfile's `FROM` image lives somewhere ACR Tasks can track, the task records that dependency and queues a rebuild when the base image is updated. Per the [base image update documentation](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-tasks-base-images), tracked locations are the same registry, another Azure container registry, public Docker Hub repositories, and public Microsoft Container Registry repositories. The trigger is on by default for tasks created with `az acr task create`.

There are three rules that catch people out:

1. **Only the runtime image is tracked.** In a multi-stage Dockerfile, the final `FROM` is watched, and the build stage isn't. If the SDK image gets a patch, nothing rebuilds.
2. **The tag has to be stable.** `aspnet:3.1` gets updated in place when Microsoft ships a patch, so the trigger fires. A pinned patch version that never moves never triggers anything.
3. **The task has to run once before it knows its dependencies.** Create it, then run it manually.

Here is a typical multi-stage .NET Core 3.1 Dockerfile to make the first rule concrete:

```dockerfile
FROM mcr.microsoft.com/dotnet/core/sdk:3.1 AS build
WORKDIR /src
COPY *.csproj ./
RUN dotnet restore
COPY . ./
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/core/aspnet:3.1 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 80
ENTRYPOINT ["dotnet", "MyApp.dll"]
```

The task tracks `aspnet:3.1`. That's the image that ships to production, so it's also the one you care about most. Just don't assume an SDK update will flow through.

Creating the task against a GitHub repository looks like this. `--git-access-token` is a GitHub personal access token that ACR uses to register the commit webhook, so it needs `repo` scope (or `repo:status` and `admin:repo_hook` for a public repository). Both triggers are on by default; I set `--base-image-trigger-enabled` anyway so the intent is visible in the script. Read it from a secret store instead of pasting it:

```bash
az acr task create \
    --registry <your-registry-name> \
    --name build-myapp \
    --image "myapp:{{.Run.ID}}" \
    --image "myapp:latest" \
    --context https://github.com/<your-org>/<your-repo>.git \
    --file Dockerfile \
    --base-image-trigger-enabled true \
    --git-access-token "$GITHUB_PAT"

# Run once so the task learns its base image dependency
az acr task run --registry <your-registry-name> --name build-myapp

# Check what triggered each run
az acr task list-runs --registry <your-registry-name> --output table
```

`list-runs` shows the trigger for each run, so you can confirm that a base image update really caused a rebuild instead of taking it on trust.

### Own your base images

Updates to Docker Hub and MCR base images aren't detected instantly, because ACR has to notice the change in a registry it doesn't control: it checks public base images at a random interval of between 10 and 60 minutes. Updates inside your own registry trigger straight away. That's why I prefer a two-tier layout. One task builds a thin "base" image from the public one (adding certificates, a non-root user, whatever your organisation standardises on) and pushes it to `baseimages/aspnet:3.1` in your registry. Application Dockerfiles then use `FROM <your-registry-name>.azurecr.io/baseimages/aspnet:3.1`.

You get one place to control what every app inherits, a clear audit point when a patch lands, and immediate fan-out once the base task finishes. It also means a Docker Hub outage doesn't block your application builds. The base task itself still pulls from Docker Hub or MCR, so the 10 to 60 minute polling delay applies once, at the first tier, and then everything below it rebuilds immediately.

Budget for the volume this creates. Every patch to a public base image fans out into a rebuild, a new tag and a webhook call for every task that depends on it, and the .NET images on MCR are updated at least monthly for .NET servicing releases, plus again whenever the underlying Debian image is patched. Builds are billed per second, so compute is the small cost; the noise is the real one. Twenty application tasks on one base image means twenty rebuilds and twenty releases to triage per patch. The two-tier layout is also the throttle. Because applications only rebuild when your base task pushes, you can control the cadence there (for example, by running the base task on a weekly timer instead of the public base image trigger) and let urgent patches through with a manual run.

If you don't need a custom base layer at all, `az acr import` is the lighter option: it copies a public image such as `mcr.microsoft.com/dotnet/core/aspnet:3.1` into your registry without a Dockerfile or a Docker daemon. The trade-off is that an import is a one-off copy. Nothing re-imports it when Microsoft patches the source, so you'd need a scheduled pipeline job to repeat it. (`az acr import` isn't an ACR Tasks command, so doing it from a timer task means running the `azure-cli` image under a managed identity that has rights on the registry.) At that point a base image build task is barely more work.

## Patching is only half the loop

A rebuilt image in the registry doesn't patch anything in production. With the tagging above, each run produces a new unique `{{.Run.ID}}` tag and moves `latest`. If your Kubernetes manifests pin `myapp:cf12` (as they should), the cluster keeps running the old image until something deploys the new tag.

So decide up front how a base image rebuild reaches production:

- **A registry webhook** on `push` that calls your release pipeline, so the new tag goes through the same gates as a code change. This is my default.
- **Scheduled redeploys** that pick up the newest tag on a cadence, if your release process can't take event-driven deployments.
- **Floating tags with `imagePullPolicy: Always`**, which I'd avoid. A pod restart then silently changes what's running, and rollbacks get murky. My [post on AKS deployment strategies](/blog/2020-08-06-aks-deployment-strategies/) covers why you want deliberate rollouts.

Pair this with scanning. Azure Security Center's [vulnerability assessment for ACR images](https://learn.microsoft.com/en-us/azure/security-center/defender-for-container-registries-introduction) became generally available in early 2020 on the Security Center standard tier. It scans each Linux image when it's pushed to the registry, using a Qualys scanner, and raises a Security Center recommendation for images with known vulnerabilities. It needs the registry to be reachable from the public internet: registries locked down with a firewall, service endpoints or private endpoints can't be scanned yet. The scan tells you which images are affected, and the base image trigger is what fixes them.

## Multi-step tasks and housekeeping

A YAML task file lets one task build, run tests in containers, and push only if the earlier steps succeed:

```yaml
version: v1.1.0
steps:
  - id: build
    build: -t {{.Run.Registry}}/myapp:{{.Run.ID}} -f Dockerfile .
  - id: test
    cmd: "{{.Run.Registry}}/myapp:{{.Run.ID}} --self-test"
  - id: push
    push:
      - "{{.Run.Registry}}/myapp:{{.Run.ID}}"
```

In a `cmd` step, everything after the image reference is passed as arguments to the image's `ENTRYPOINT`, so this runs `dotnet MyApp.dll --self-test`, a stand-in for whatever smoke check your app exposes. Steps run in order and the task stops at the first failure, so the push never happens if the test fails; no explicit `when` dependencies are needed. Point a task at this file with `--file acr-task.yaml` instead of a Dockerfile.

Automatic rebuilds also mean tags pile up. The `acr purge` command, still in preview, deletes tags older than a given age that match a repository and tag filter. It runs as a container inside a task, so a timer trigger turns it into a nightly job. The [auto-purge documentation](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-auto-purge) has the full options:

```bash
az acr task create \
    --registry <your-registry-name> \
    --name purge-myapp \
    --cmd "acr purge --filter 'myapp:.*' --ago 30d --untagged" \
    --schedule "0 1 * * *" \
    --context /dev/null
```

Timer schedules are cron expressions evaluated in UTC, so 01:00 UTC is late morning in Sydney. Purging is irreversible. Note that `--untagged` removes all untagged manifests in the filtered repositories, not just those older than `--ago`. Treat it as an opt-in, and leave it off if anything pulls images by digest, because those manifests may have no tag and still be in use.

## When I'd keep builds in CI instead

ACR Tasks isn't a CI system, and I wouldn't force it into being one.

- **You already have a mature pipeline.** If Azure Pipelines or GitHub Actions already builds, tests, scans and signs your images, moving the build step to ACR only adds a second place to debug. Use ACR Tasks just for base image rebuilds of the images you already publish.
- **Your build needs private network access.** Task agents run on Microsoft-hosted compute outside your virtual network, unless you use the [dedicated agent pools](https://learn.microsoft.com/en-us/azure/container-registry/tasks-agent-pools), a Premium-tier preview that appeared this week in East US, East US 2, South Central US and West US 2, which can run in your virtual network. The default agents can't reach a package feed that's only available privately, and they can't reach a registry locked down with firewall rules or private endpoints. If that's your setup, keep the build in a self-hosted CI agent inside the network.
- **Your tests need real infrastructure.** Multi-step tasks can run containers, but integration tests against databases and queues belong in a pipeline with proper environments.
- **You need approvals and audit trails around releases.** Tasks produce images, not releases. Keep deployment gates in your release tooling.

## My take

If you run containers on Azure and don't use ACR Tasks at all, start with one thing: a base image trigger on the images you ship to production, with a webhook that sends each rebuild through your normal release process. That closes the gap between "Microsoft patched the base image" and "we're running the patched image", and that gap is where I see images drift months behind their base. Quick builds, multi-step YAML and scheduled purges are useful extras, but automatic rebuilds are the reason to switch it on.
