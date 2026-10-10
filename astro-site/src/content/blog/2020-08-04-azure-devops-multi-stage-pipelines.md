---
title: "Multi-Stage YAML Pipelines in Azure DevOps: A Starting Skeleton"
description: "A practical multi-stage YAML pipeline for .NET Core 3.1 on Azure DevOps: build, test, environments, approvals, templates, and the traps to avoid."
author: Michael John Peña
draft: false
date: 2020-08-04
tags:
  - Azure DevOps
  - CI/CD
  - DevOps
  - YAML
---

Classic build and release pipelines live in a web UI, which is how you end up with a pipeline whose author has left, a build that "just works", and a release variable nobody can explain. Multi-stage YAML pipelines put the whole definition, build through production deployment, in a file next to the code. Since Microsoft [announced general availability of YAML CD features on 28 April 2020](https://devblogs.microsoft.com/devops/announcing-general-availability-of-azure-pipelines-yaml-cd/), I recommend them over the Classic editor for any new pipeline.

## What you actually get from YAML

The usual pitch is "pipelines as code", which undersells it. The concrete benefits are:

- **Pipeline changes go through pull requests.** A new deployment step gets reviewed like any other change, and branch policies apply to it.
- **The pipeline is versioned with the code it builds.** Check out a commit from six months ago and you get the pipeline that built it, not today's pipeline.
- **Stages, environments, and checks replace release definitions.** Build and deploy are one run with one artifact, so you stop wiring release triggers to build artifacts by hand.

### When to keep Classic Releases

What you give up is worth naming too. Classic Releases still suit some teams better: the release view shows which build sits in which environment at a glance, and operators can redeploy or override a variable from the UI without reading a file. Classic stages can also be set to deploy only when someone triggers them by hand; YAML has no manual stage trigger, so the usual workaround is an approval check on the environment. If a team's release process is run by people who never touch the repository, a hard cut-over can push them out of the loop. In that case I migrate the build first and leave the release in Classic until the team is comfortable.

## The build stage

The first stage restores, builds, tests, and publishes a single artifact. Everything downstream deploys that artifact and nothing else, which means production gets exactly the bits that passed the tests.

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main

pr:
  branches:
    include:
      - main

variables:
  buildConfiguration: 'Release'
  dotnetVersion: '3.1.x'

stages:
  - stage: Build
    displayName: 'Build and test'
    pool:
      vmImage: 'ubuntu-latest'
    jobs:
      - job: Build
        steps:
          - task: UseDotNet@2
            displayName: 'Use .NET Core SDK $(dotnetVersion)'
            inputs:
              packageType: 'sdk'
              version: '$(dotnetVersion)'

          - task: DotNetCoreCLI@2
            displayName: 'Restore'
            inputs:
              command: 'restore'
              projects: '**/*.csproj'

          - task: DotNetCoreCLI@2
            displayName: 'Build'
            inputs:
              command: 'build'
              projects: '**/*.csproj'
              arguments: '--configuration $(buildConfiguration) --no-restore'

          - task: DotNetCoreCLI@2
            displayName: 'Unit tests'
            inputs:
              command: 'test'
              projects: '**/*Tests.csproj'
              arguments: '--configuration $(buildConfiguration) --no-build --filter "Category!=Integration" --collect:"XPlat Code Coverage"'

          - task: PublishCodeCoverageResults@1
            displayName: 'Publish code coverage'
            inputs:
              codeCoverageTool: 'Cobertura'
              summaryFileLocation: '$(Agent.TempDirectory)/**/coverage.cobertura.xml'

          - task: DotNetCoreCLI@2
            displayName: 'Publish web project'
            inputs:
              command: 'publish'
              publishWebProjects: true
              arguments: '--configuration $(buildConfiguration) --output $(Build.ArtifactStagingDirectory)'
              zipAfterPublish: true

          - publish: '$(Build.ArtifactStagingDirectory)'
            displayName: 'Publish pipeline artifact'
            artifact: drop
```

The `pr:` block only applies to GitHub and Bitbucket Cloud repositories. For Azure Repos, [YAML PR triggers aren't supported](https://learn.microsoft.com/en-us/azure/devops/pipelines/repos/azure-repos-git); configure PR validation as a Build validation branch policy on `main` instead, and the same pipeline runs for every pull request.

A few choices in there are deliberate:

- **The `publish` step before the artifact upload matters.** A common mistake is uploading `$(Build.ArtifactStagingDirectory)` without anything putting files into it, which gives you an empty artifact and a confusing failure two stages later. `dotnet publish` with `zipAfterPublish: true` produces the zip that the web app deployment expects.
- **`publish:` uploads a pipeline artifact**, the shortcut for `PublishPipelineArtifact@1`. Pipeline artifacts are faster than the older build artifacts (`PublishBuildArtifacts@1`) and are what deployment jobs download by default, so I use them for anything new.
- **Integration tests are filtered out here** and run in their own stage, covered further down, so nothing runs twice.
- **Coverage needs a collector.** `--collect:"XPlat Code Coverage"` only works if the test projects reference the `coverlet.collector` NuGet package; the xUnit template in the .NET Core 3.x SDK already includes it. The `test` command publishes test results to the run automatically. `PublishCodeCoverageResults@1` publishes one Cobertura summary and doesn't merge files, so with more than one test project the glob matches several reports and the coverage shown is partial; merge them first (the ReportGenerator extension from the Marketplace does this) and point `summaryFileLocation` at the merged file.
- **`ubuntu-latest` is a moving target.** Today it points at Ubuntu 18.04. If a build depends on a specific OS version, pin it (`ubuntu-18.04`) rather than finding out when the alias moves.

On branch names: Azure Repos still creates `master` by default, and plenty of repositories use it. [Sprint 173](https://learn.microsoft.com/en-us/azure/devops/release-notes/2020/sprint-173-update) (rolling out now) adds a project-level setting to choose the initial branch name for new repositories, with an organisation-level setting promised for a later sprint. Until you change it, `master` is still the default and existing repositories don't change. I use `main` here; change the triggers and the production condition below to match your repository.

## Deployment stages with environments

Deployment stages use a **deployment job** rather than a regular job. The difference is the `environment` keyword: it records deployment history against a named environment and lets you attach approvals and checks that the stage must pass before it runs.

Dev and production deployments are identical apart from a few values, so I put the stage in a template rather than copying it:

```yaml
# templates/deploy-webapp.yml
parameters:
  - name: stageName
    type: string
  - name: environment
    type: string
  - name: appName
    type: string
  - name: serviceConnection
    type: string
  - name: variableGroup
    type: string
  - name: dependsOn
    type: object
  - name: condition
    type: string
    default: 'succeeded()'

stages:
  - stage: ${{ parameters.stageName }}
    displayName: 'Deploy to ${{ parameters.environment }}'
    dependsOn: ${{ parameters.dependsOn }}
    condition: ${{ parameters.condition }}
    variables:
      - group: ${{ parameters.variableGroup }}
    pool:
      vmImage: 'ubuntu-latest'
    jobs:
      - deployment: DeployWebApp
        displayName: 'Deploy web app'
        environment: '${{ parameters.environment }}'
        strategy:
          runOnce:
            deploy:
              steps:
                - download: current
                  artifact: drop

                - task: AzureWebApp@1
                  displayName: 'Deploy to ${{ parameters.appName }}'
                  inputs:
                    azureSubscription: '${{ parameters.serviceConnection }}'
                    appType: 'webApp' # use webAppLinux for a Linux App Service plan
                    appName: '${{ parameters.appName }}'
                    package: '$(Pipeline.Workspace)/drop/**/*.zip'
```

Then the main pipeline adds two stages after `Build`:

```yaml
# appended to the stages list in azure-pipelines.yml
  - template: templates/deploy-webapp.yml
    parameters:
      stageName: DeployDev
      environment: 'Development'
      appName: '<your-dev-app-name>'
      serviceConnection: '<your-service-connection>'
      variableGroup: '<your-dev-variable-group>'
      dependsOn: Build

  - template: templates/deploy-webapp.yml
    parameters:
      stageName: DeployProd
      environment: 'Production'
      appName: '<your-prod-app-name>'
      serviceConnection: '<your-service-connection>'
      variableGroup: '<your-prod-variable-group>'
      dependsOn: DeployDev
      condition: >-
        and(succeeded(),
            eq(variables['Build.SourceBranch'], 'refs/heads/main'),
            ne(variables['Build.Reason'], 'PullRequest'))
```

`dependsOn` is typed as `object` rather than `string` so the same parameter accepts a single stage name or a list such as `[Build, IntegrationTests]`. The `appType` of `webApp` targets a Windows App Service; use `webAppLinux` if your plan runs Linux.

Two behaviours of [deployment jobs](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs) catch people out. First, they **do not check out the repository** by default, because they are meant to deploy an artifact, not rebuild source. If a deployment needs a script from the repo, add `- checkout: self` explicitly, or better, package the script into the artifact. Second, the `runOnce` deploy hook downloads the current run's pipeline artifacts automatically; I keep the explicit `download: current` step anyway so the artifact name is visible to whoever reads the file next.

`runOnce` is the right strategy for App Service. The `rolling` and `canary` strategies exist, but rolling only supports virtual machine resources, and canary's traffic shifting is built around Kubernetes (the `KubernetesManifest` task), so neither buys you anything for App Service. Use deployment slots for that instead.

### When runOnce isn't enough

`runOnce` deploys straight into the live app, so a bad release is live until you redeploy the previous run. For production, I deploy to a `staging` slot instead: set `deployToSlotOrASE: true`, `resourceGroupName` and `slotName: 'staging'` on `AzureWebApp@1`, then swap with `AzureAppServiceManage@0` using the `Swap Slots` action. The app warms up in the slot before it takes traffic, and rollback is swapping back, which takes seconds rather than a rebuild. Slots need a Standard plan or higher and add a step to the stage, so I only bother where downtime or a slow rollback actually costs something; a dev environment doesn't need them.

### The production condition

The production stage only runs for builds of `main` that were not triggered by a pull request. The branch check already excludes PR builds, because their source branch is `refs/pull/<id>/merge`. I add the `Build.Reason` check as well so the intent is explicit and survives someone loosening the branch check later. Conditions are evaluated at runtime, so the stage still appears in the run as skipped, which is clear enough for reviewers.

## Approvals and checks live outside the YAML

This surprises people coming from Classic: production approvals are not in the YAML file. They are configured on the environment (and on other protected resources such as service connections and agent pools), under **Pipelines > Environments > Production > Approvals and checks**. The [approvals and checks documentation](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals) covers the options, including manual approvals, business hours, invoking an Azure Function or REST API, querying Azure Monitor alerts, and requiring that the pipeline extends an approved template.

I think this is the right design. If approvals were in the YAML, anyone with write access to the repository could remove them in a pull request. Keeping them on the resource means the people who own production own the gate, regardless of which pipeline wants to deploy there. The trade-off is discoverability: a new team member reading the YAML cannot see that production needs two approvers. I add a one-line comment above the production stage saying so.

## Secrets and variable groups

Non-secret configuration that differs per stage can be stage-level variables. Secrets belong in a variable group, ideally linked to Azure Key Vault so the secret has one source of truth:

```yaml
# fragment: variables for a single stage
variables:
  - group: '<your-prod-variable-group>'
  - name: buildConfiguration
    value: 'Release'
```

Reference a variable group at the stage level rather than the top of the pipeline, so the build stage and the dev stage never have production secrets in scope. That's what the `variableGroup` parameter in the deployment template does: each environment's stage pulls in only its own group. A pipeline also has to be authorised to use a variable group before its first run can read it, which stops a new pipeline quietly picking up production secrets. Secret variables are not exposed to scripts as environment variables automatically; map them explicitly with `env:` on the step that needs them.

## Running work in parallel

Within a stage, jobs run in parallel by default; you only need `dependsOn` to make them sequential. Stages are the opposite: each stage depends on the previous one unless you say otherwise, and `dependsOn: []` removes that dependency.

Integration tests are a good candidate. They're slow, and they don't need the artifact, so there's no reason to make them wait for `Build`. That holds for in-process integration tests (`WebApplicationFactory`, a database in a container on the agent); if your tests hit a deployed environment, make the stage depend on `DeployDev` and gate `DeployProd` on it instead:

```yaml
# fragment: append to the stages list in azure-pipelines.yml
  - stage: IntegrationTests
    displayName: 'Integration tests'
    dependsOn: []
    pool:
      vmImage: 'ubuntu-latest'
    jobs:
      - job: IntegrationTests
        steps:
          - task: UseDotNet@2
            displayName: 'Use .NET Core SDK $(dotnetVersion)'
            inputs:
              packageType: 'sdk'
              version: '$(dotnetVersion)'

          - task: DotNetCoreCLI@2
            displayName: 'Integration tests'
            inputs:
              command: 'test'
              projects: '**/*Tests.csproj'
              arguments: '--configuration $(buildConfiguration) --filter "Category=Integration"'
```

This stage replaces nothing in `Build`: the unit test step there filters out `Category=Integration`, and this stage runs only that category, so each test runs once. Each stage gets a fresh agent, which is why it selects the SDK again; `dotnet test` restores and builds implicitly because there's no `--no-build`. The stage starts alongside `Build`. Parallelism is bounded by the parallel jobs your organisation has, so on the free tier extra jobs queue rather than speed anything up. If a deployment stage should wait for both build and tests, give it a list: `dependsOn: [Build, IntegrationTests]`, which the `object` parameter in the template accepts.

## Where I'd draw the line

Start with one build stage, one artifact, and a deployment stage per environment, with approvals on the environment rather than in the file. Move duplication into templates as soon as you have two stages that differ only by values, and stop there; a pipeline split across five nested templates is as opaque as the Classic one it replaced. If your release process depends on people outside the repository, migrate the build to YAML first and the release second.

Multi-stage YAML pipelines are not the most exciting thing I work on, but every other improvement depends on them: tests that gate a release, environments with history, approvals owned by the people who own production. Get the deployment pipeline right early, because retrofitting environments and approvals into a pipeline that already deploys to production is the expensive way to learn this.
