---
title: "Hosting My Hugo Blog on Azure Static Web Apps While It's in Preview"
description: "Why I picked Azure Static Web Apps (Preview) for a Hugo blog, how the CLI and GitHub Actions setup works, and the preview limits to weigh before you follow."
author: Michael John Peña
draft: false
date: 2020-08-27
tags:
  - Azure
  - Static Web Apps
  - GitHub Actions
  - Web Development
---

Yesterday I committed to [writing again](/blog/2020-08-26-writing-again/), and the first thing a commitment like that exposes is the plumbing. If publishing a post takes more than a `git push`, I will find a reason not to do it. I want the blog on infrastructure I own and understand, with no server to patch and no deployment ritual standing between a finished draft and a live page.

I chose Azure Static Web Apps, which Microsoft announced as a preview at Microsoft Build on 19 May 2020 (the [official Static Web Apps repository](https://github.com/Azure/static-web-apps/blob/1c7ccff3e5cf8aec92b4b9d8ae476b5b6a18fb69/README.md) went up for the launch, describing it as "a streamlined preview hosting option"). It is still in preview as I write this, so this post covers both the setup and the questions I'd ask before putting anything that matters on a preview service.

## What Static Web Apps actually gives you

Static Web Apps combines things you would normally wire together yourself: global hosting for static content, a build and deploy pipeline that runs in GitHub Actions, optional serverless APIs backed by Azure Functions, and built-in authentication. For a blog, the parts I care about are:

- **Git-driven deployment.** Creating the resource commits a GitHub Actions workflow into your repository. Every push to the production branch builds the site and publishes it.
- **Pull request environments.** Open a pull request and the workflow deploys that branch to its own temporary URL, then removes it when the PR is closed. For a blog, that means I can read a post on a real URL before it goes live.
- **Free TLS on custom domains.** Point a CNAME at the app, and the certificate is issued and renewed for you.
- **Routing without a server.** A `routes.json` file handles fallbacks, custom error pages and, combined with the preconfigured sign-in providers, role-based route protection (more on that below).

The service is free while it is in preview. There is no paid tier yet, and Microsoft hasn't published GA pricing.

## Why not the options that are already GA?

This is the question that matters, because each alternative works fine for a static blog.

| Option | Status (Aug 2020) | What you assemble yourself |
|---|---|---|
| Azure Static Web Apps | Preview | Almost nothing for a static site |
| [Blob Storage static website](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-static-website) + Azure CDN | GA | CI/CD pipeline, CDN rules, HTTPS on the custom domain, PR previews |
| Azure App Service | GA | A server you don't need for static files; custom domains with TLS need a paid plan |
| GitHub Pages | GA | Builds limited to what Pages supports unless you add your own Action; no PR previews |

Blob Storage with a CDN in front is the safe Azure answer, and I'd still pick it for a corporate marketing site today. But it's a kit, not a product: you write the pipeline, configure the CDN, set up HTTPS for the custom domain, and you get no pull request previews unless you build them. App Service is the wrong tool for files that never change between requests. GitHub Pages is the closest competitor, but Static Web Apps gives me PR environments and a path to an API without leaving the same resource.

For a personal blog, a preview service is an acceptable risk. If it breaks, I lose a few hours, not revenue. That calculation changes completely for a client-facing site, which I cover below.

## Creating the app from the CLI

You can create the app in the Azure portal, which walks you through authorising GitHub and picking a repository. I prefer the CLI because it is repeatable. The `az staticwebapp` command group arrived in [Azure CLI 2.8.0](https://github.com/Azure/azure-cli/blob/dev/src/azure-cli/HISTORY.rst) and is itself flagged as preview. You need a GitHub personal access token so the CLI can commit the workflow file and store the deployment secret in your repository. I read the token from an environment variable rather than typing it into the command, so the secret doesn't end up in my shell history or in a script I might commit.

```bash
# Requires Azure CLI 2.8.0 or later and a GitHub personal access token that can push to the
# repository and update workflow files (the repo and workflow scopes)
# Prompt for the token without echoing it, so it never lands in shell history
read -s -p "GitHub PAT: " GITHUB_PAT && export GITHUB_PAT

az group create --name <your-resource-group> --location eastus2

az staticwebapp create \
    --name <your-app-name> \
    --resource-group <your-resource-group> \
    --location eastus2 \
    --source https://github.com/<your-github-user>/<your-repo> \
    --branch main \
    --token "$GITHUB_PAT" \
    --app-location "/" \
    --api-location "api" \
    --app-artifact-location "public"
```

Two parameters do the real work. `--app-location` is where your source lives (the repository root for a typical Hugo site). `--app-artifact-location` is the build output folder relative to that, which is `public` for Hugo. I also set `--api-location "api"` explicitly. The CLI's default is `.`, which points at the repository root, and I'd rather name a dedicated folder so that a missing `api` folder simply means no API. Check `az staticwebapp create --help` on your installed CLI version, because parameter names can change while the command group is in preview.

The region only affects where the resource and any Functions API live. Static content is served from globally distributed points of presence, and during preview only a handful of regions are offered.

## The workflow it generates

The command commits a workflow file under `.github/workflows/`. The interesting part is the deploy step. This is a fragment of the generated file, not the whole thing:

```yaml
    steps:
      - uses: actions/checkout@v2
        with:
          submodules: true
      - name: Build And Deploy
        id: builddeploy
        uses: Azure/static-web-apps-deploy@v0.0.1-preview
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_<GENERATED_SUFFIX> }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/"
          api_location: "api"
          app_artifact_location: "public"
        # Optional: pin the Hugo version Oryx uses
        env:
          HUGO_VERSION: <your-hugo-version>
```

There are two details worth understanding rather than accepting blindly. First, `submodules: true` matters for Hugo, because most Hugo themes are added as Git submodules. Without it, the build succeeds but the site renders with no theme. Second, the action builds your site with Microsoft's Oryx build engine inside a container, which detects Hugo and runs it for you. That is convenient, but Oryx picks a default Hugo version unless you pin one with a `HUGO_VERSION` environment variable on the deploy step, as in the optional `env` block above. Check the version printed in the first build log against what your theme needs, especially if it relies on a recent Hugo feature. The [Hugo tutorial on Microsoft Learn](https://learn.microsoft.com/en-us/azure/static-web-apps/publish-hugo) walks through the same flow from the portal.

`api_location` points at a folder that doesn't exist in my repo. That is fine: no folder, no API. I'll add Functions when the blog needs something dynamic, such as a contact form.

## Routing and a proper 404 page

During the preview, routing is configured with a `routes.json` file in the build output. Hugo copies anything in `static/` into `public/`, so `static/routes.json` ends up in the right place. The rule I care about first is serving Hugo's generated 404 page instead of the platform default:

```json
{
  "routes": [],
  "platformErrorOverrides": [
    { "errorType": "NotFound", "serve": "/404.html" }
  ]
}
```

The same file can restrict routes to authenticated roles, which is how you'd protect drafts or an admin area without writing any auth code. I don't need that for a public blog. It's the feature I'd show a team building an internal documentation site, though.

## Custom domains: subdomains only for now

Adding a domain is two steps: create a CNAME record at your DNS provider pointing at the app's generated `azurestaticapps.net` hostname, then register it with the app. The CLI asks the service to validate the CNAME before it adds the hostname.

```bash
az staticwebapp hostname set \
    --name <your-app-name> \
    --hostname www.<your-domain>
```

The catch is the apex domain. In the current preview, custom domains are validated through a CNAME, and DNS doesn't allow a CNAME on a root domain like `example.com`. The CLI help for this command explicitly says it sets a *sub-domain*. If you want visitors on the bare domain, the only workaround in the preview is a DNS provider or registrar that redirects the apex to `www`; the root domain itself can't be added to the app yet. Plan for this before you move a domain whose links already point at the root. The [custom domain documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain) is the page to watch, because this is an obvious gap to close before GA.

## What the preview costs you

The whole setup took me about 15 minutes, and the pull request environments are a nice touch for a service this young. But "it was easy" is not the same as "it's ready for anything".

- **GitHub only.** The preview builds from GitHub repositories through GitHub Actions. If your source lives in Azure DevOps, GitLab or Bitbucket, this isn't an option yet.
- **No SLA.** Preview services come with no availability commitment. If the site is down, you wait.
- **Things will change.** Parameter names, the action version and the routing file format are all preview artefacts. Expect to update your workflow and configuration at least once before GA.
- **Limited regions.** Fine for static content, which is globally distributed anyway, but it matters if you add an API and care where data is processed.
- **Unknown pricing.** Free today doesn't tell you what it will cost later. For a personal site that's a curiosity. For a business, it's a budgeting problem.
- **Apex domains.** As above, root domains can't be added; a redirect to `www` is the only workaround.

## When I'd use it, and when I wouldn't

My rule of thumb: put things on a preview service when you can tolerate an outage and a migration. A personal blog, a conference demo, a side project, or documentation for a small team all qualify. You get a better developer experience than the GA alternatives, and the cost of being wrong is small.

I would not put a client's production site, anything with a contractual uptime requirement, or a site that must live on an apex domain on it yet. For those, Blob Storage static websites with Azure CDN in front remain the right Azure choice until Static Web Apps reaches general availability and publishes an SLA and pricing.

For this blog, the plumbing is done. The workflow deploys on every push, drafts get their own preview URL, and I'm out of excuses. Time to write.
