---
title: "Dependabot Without the PR Flood: Config, Auto-Merge and Triage"
description: "How to configure Dependabot so update PRs stay reviewable: schedules, PR limits, ignore rules, safe auto-merge with GitHub Actions, and alert triage."
author: Michael John Peña
draft: false
date: 2022-01-15
url: /blog/dependabot-dependency-management/
tags:
  - GitHub
  - Security
  - DevOps
  - GitHub Actions
  - Automation
---

Turning Dependabot on takes thirty seconds. Living with it is the hard part: a busy repository with npm, NuGet, Docker and Actions dependencies can produce dozens of pull requests a week, and once developers start closing them unread you have a security control that exists only on paper. The goal isn't "Dependabot enabled", it's "dependency updates merged within days, with humans only looking at the ones that deserve it".

This is the companion to my [GitHub Advanced Security rollout post](/blog/2022-01-11-github-advanced-security/). As I noted there, Dependabot alerts and Dependabot security updates are free on every repository, so there is no licence conversation to have before you start.

## Three features that share one name

Dependabot is really three things, and mixing them up leads to bad configuration.

| Feature | What it does | Configured in |
|---|---|---|
| Dependabot alerts | Flags dependencies in your manifests that match a GitHub Advisory Database entry | Repository or organisation security settings |
| Dependabot security updates | Opens a PR to move a vulnerable dependency to the minimum patched version | Repository or organisation security settings |
| Dependabot version updates | Opens PRs to keep dependencies current, vulnerable or not | `.github/dependabot.yml` |

The practical consequence: security updates work without any `dependabot.yml` at all. If you do have one, most of its options (labels, reviewers, and `ignore` rules by name or version) apply to security PRs too. The exception is `update-types`: ignoring semver-major for a package still lets a security PR through when a major version is the only fix. That's what you want, and it's another reason to ignore by update type rather than by name or version.

My rule of thumb is to enable alerts and security updates everywhere on day one, then add version updates repository by repository once a team has CI they trust. Version updates without decent tests is just automated risk.

## A dependabot.yml built for review capacity

Here's a configuration for a typical .NET API with a React front end, a Dockerfile, and GitHub Actions workflows.

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "nuget"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Australia/Sydney"
    open-pull-requests-limit: 5
    reviewers:
      - "<your-org>/<your-team>"
    labels:
      - "dependencies"
      - "nuget"
    commit-message:
      prefix: "deps"
    ignore:
      # Framework majors are planned upgrades, not Monday-morning PRs
      - dependency-name: "Microsoft.EntityFrameworkCore"
        update-types: ["version-update:semver-major"]

  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule:
      interval: "weekly"
      day: "monday"
      timezone: "Australia/Sydney"
    open-pull-requests-limit: 5
    labels:
      - "dependencies"
      - "npm"
    versioning-strategy: "increase"

  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
    labels:
      - "dependencies"
      - "docker"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "monthly"
    labels:
      - "dependencies"
      - "github-actions"
```

The choices that matter, and why:

- **Weekly, on a fixed day.** Daily schedules feel more secure but they aren't: security updates arrive as soon as an advisory lands regardless of your schedule. Version updates are hygiene, and a predictable Monday batch is easier to staff than a constant trickle.
- **`open-pull-requests-limit` as a throttle.** Per the [configuration options for dependency updates](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference), the default for version updates is five open PRs per ecosystem. I keep it there or lower. If PRs are piling up against the limit, the fix is merging faster, not raising the ceiling. The limit doesn't apply to security updates.
- **Ignore rules by update type, not by version pin.** Since [May 2021 you can ignore major, minor or patch releases](https://github.blog/changelog/2021-05-21-dependabot-version-updates-can-now-ignore-major-minor-patch-releases/) for a dependency. That's far better than the old pattern of pinning `versions: ["6.x"]`, which you forget about and which silently goes stale. Ignoring majors for a framework says "we'll plan this upgrade" while still taking every patch.
- **Teams as reviewers.** Use the `org/team-name` form. A team that owns the service should own its dependency PRs; routing everything to a central security team is how PRs go unread.
- **Monthly for Actions.** Action updates are low risk and low urgency. I'd rather batch them.

One thing you can't do today is group several dependencies into a single PR. Each update is its own pull request, which is exactly why the limit, schedule and auto-merge below matter so much.

## Auto-merge only what tests can vouch for

The single biggest reduction in noise comes from letting low-risk updates merge themselves. Two changes in 2021 made this workable with GitHub Actions. From March 2021, [workflows triggered by Dependabot run with a read-only `GITHUB_TOKEN`](https://github.blog/changelog/2021-02-19-github-actions-workflows-triggered-by-dependabot-prs-will-run-with-read-only-permissions/); then from [October 2021 those workflows respect the `permissions` key](https://github.blog/changelog/2021-10-06-github-actions-workflows-triggered-by-dependabot-prs-will-respect-permissions-key-in-workflows/), so you can grant exactly the write scopes a merge needs.

The [`dependabot/fetch-metadata`](https://github.com/dependabot/fetch-metadata) action reads the PR and tells you the dependency names, the dependency type, and the semver level of the update.

```yaml
# .github/workflows/dependabot-auto-merge.yml
name: Dependabot auto-merge

on:
  pull_request:

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.event.pull_request.user.login == 'dependabot[bot]'
    steps:
      - name: Fetch Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@v1.1.1
        with:
          github-token: "${{ secrets.GITHUB_TOKEN }}"

      - name: Approve and enable auto-merge for patch updates
        if: steps.metadata.outputs.update-type == 'version-update:semver-patch'
        run: |
          gh pr review --approve "$PR_URL"
          gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Approve and enable auto-merge for minor dev dependencies
        if: >-
          steps.metadata.outputs.update-type == 'version-update:semver-minor' &&
          steps.metadata.outputs.dependency-type == 'direct:development'
        run: |
          gh pr review --approve "$PR_URL"
          gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

A few details that are easy to get wrong:

- **`--auto` is not "merge now".** It enables GitHub's auto-merge, which waits for branch protection to be satisfied. You need "Allow auto-merge" turned on in the repository settings and, critically, required status checks on the target branch. Auto-merge only works when branch protection is blocking the merge. With no required checks the step either errors or, if a check is merely pending, merges without your tests gating it. Make the CI job a required status check.
- **Check the PR author, not `github.actor`.** `github.actor` is whoever triggered the run, which changes if someone re-runs the job. The PR's `user.login` is stable.
- **Don't use `pull_request_target` to get around permissions.** It runs with a write token in the context of the base branch, and checking out PR code inside it is a well-known way to hand a malicious dependency your secrets.
- **The approval step** only matters if your branch protection requires a review. If it does, be honest with yourself that a bot approval means the review rule no longer applies to these PRs, and decide whether that's acceptable for your risk profile.

Non-semver updates, such as Docker tag bumps and some Actions refs, produce no `update-type` at all, so they never match either condition and this workflow leaves them for review. That's the safe default.

What I won't auto-merge: majors (by definition they can break you), minor updates to production dependencies in anything customer-facing, and Docker base image bumps for services where the image is the deployment artefact. Those get a human, and the PR description Dependabot writes, with release notes and commits, makes that review quick.

## Enabling security updates at scale

For a handful of repositories, the Security & analysis settings page is fine. For an organisation, you can turn on alerts and security updates for all repositories (and all new ones by default) from the organisation's security settings, which is what I'd do.

If you need to script it per repository, for example to roll out in waves, the REST API has an endpoint for each. Alerts must be on before security updates can be enabled.

```bash
# Requires admin rights on the repository
OWNER="<your-org>"
REPO="<your-repo>"

gh api -X PUT "repos/$OWNER/$REPO/vulnerability-alerts" \
  -H "Accept: application/vnd.github.dorian-preview+json"

gh api -X PUT "repos/$OWNER/$REPO/automated-security-fixes" \
  -H "Accept: application/vnd.github.london-preview+json"
```

The API still calls security updates "automated security fixes", which is the feature's original beta name.

## Triage is a process, not a dashboard

Alerts are only useful if someone owns them. The repository's Security tab lists open Dependabot alerts with severity, the manifest they came from, and whether a security update PR exists. My approach:

1. **Critical and high with a fix available:** the security update PR is the work item. Merge it this week, or record why not.
2. **No patched version yet:** decide whether the vulnerable code path is reachable. If it isn't, dismiss the alert with the reason "Vulnerable code is not actually used" so the decision is recorded. If it is, that's a real risk item, not a Dependabot chore.
3. **Dev-only or test-only dependencies:** still fix them, but they rarely justify interrupting a sprint.

Dismissing with a reason matters more than people think. An alert list with fifty items, half of them already assessed but never closed, trains everyone to ignore the list.

## When Dependabot isn't the answer

Dependabot is the right default for repositories on GitHub, but it isn't always the best tool:

- **Azure Repos:** native Dependabot only runs on GitHub. Teams on Azure DevOps either run the open-source Dependabot core in a pipeline or use another bot such as Renovate.
- **Heavy monorepos:** one PR per dependency per directory becomes unmanageable when the same package appears in thirty `package.json` files. Renovate's grouping is the reason many monorepos choose it.
- **No CI:** if a repository has no tests, version updates just move the risk around. Start with alerts and security updates only, and invest in a test suite before turning on routine updates.

## The short version

Enable alerts and security updates everywhere, because they're free and they cost almost nothing to live with. Add version updates with a weekly schedule, a low PR limit and ignore rules for planned majors. Auto-merge patches and dev-dependency minors behind required status checks, and send everything else to the owning team. The measure of success is how quickly updates get merged, not how many PRs Dependabot opens.
