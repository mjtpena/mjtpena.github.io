---
title: "GitHub Advanced Security: What You Get and How to Roll It Out"
description: "What GitHub Advanced Security includes in early 2022, how its active-committer licensing works, and a staged plan for enabling CodeQL and secret scanning."
author: Michael John Peña
draft: false
date: 2022-01-11
url: /blog/github-advanced-security/
tags:
  - GitHub
  - Security
  - DevOps
  - GitHub Actions
---

Most organisations buy GitHub Advanced Security (GHAS) the same way they buy any security tool: a licence, a big-bang "enable everything" switch, and a flood of alerts nobody owns. A month later the Security tab is a graveyard of open findings and developers have learned to ignore it. GHAS is worth the money, but only if you treat it as a change to how teams work rather than a scanner you bolt on.

The order you switch the features on matters more than which ones you buy. I go deeper on [secret scanning](/blog/2022-01-14-github-secret-scanning/) and [Dependabot](/blog/2022-01-15-dependabot-dependency-management/) in separate posts.

## What's in the box

GHAS is an add-on for GitHub Enterprise Cloud and GitHub Enterprise Server. On GitHub Enterprise Server, GHAS needs version 3.0 or later, and GitHub Actions must be enabled to run the CodeQL workflow. Code scanning is free on public repositories, and GitHub already scans public repositories for partner tokens and notifies the provider; you pay for GHAS to run code scanning and get secret scanning alerts on private and internal repositories. The [GitHub docs on GHAS](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security) list three features:

| Feature | What it does | Status (Jan 2022) |
|---|---|---|
| Code scanning | Runs static analysis (CodeQL or a third-party tool that emits SARIF) and raises alerts on the repo and in pull requests | GA |
| Secret scanning | Finds credentials committed to the repo, including the full history, using partner patterns plus your own custom patterns | [GA for private repos since March 2021](https://github.blog/changelog/2021-03-31-secret-scanning-for-private-repositories-is-generally-available/); custom patterns in beta since mid-2021 |
| Dependency review | Shows the dependency changes in a pull request, with known vulnerabilities, in the rich diff | [GA since October 2021](https://github.blog/changelog/2021-10-05-dependency-review-is-generally-available/) |

Two things are worth calling out because they confuse buyers. First, Dependabot alerts and Dependabot security updates are not part of GHAS; they're free on every repository. Dependency review is the GHAS piece, and it's about catching a vulnerable package *before* it merges rather than after. Second, the organisation-level security overview that rolls these alerts up is still in beta, so don't plan your reporting around it being stable.

CodeQL supports C/C++, C#, Go, Java, JavaScript/TypeScript and Python, with Ruby in beta. If your estate is mostly something else, code scanning still works with third-party analysers that upload SARIF, but the value of the licence drops.

## How the licence is counted

GHAS is billed per **active committer**: a unique user who has pushed a commit to at least one GHAS-enabled repository in the last 90 days. Two consequences follow:

- Enabling GHAS on one repository that 200 people commit to costs the same as enabling it on 50 repositories those same 200 people work in. Once someone is counted, extra repos are free for them.
- Contractors, bots that commit (not Dependabot pull requests, but automation accounts that push), and people who touched one repo once in the last quarter all count.

So the first job is not technical. Pull the list of committers on your candidate repositories and decide whether to license the whole engineering population or a defined set of teams. I'd rather license fewer people and have every enabled repo actually triaged than license everyone and have alerts rot.

## Roll out in this order

### 1. Secret scanning first

Secret scanning needs no build, no workflow and no tuning. Turn it on and it scans the entire Git history. It produces the fewest false positives of the three features, and every true positive is a real credential that needs to be checked and, if still valid, rotated today. That makes it the best way to show the business value of the licence in week one.

Before you enable it widely, agree who rotates what. An alert for a production storage account key that nobody owns is worse than no alert, because now you've documented that you knew.

If a repository has test fixtures full of fake keys, exclude those paths with a `.github/secret_scanning.yml` file at the root of the repo:

```yaml
paths-ignore:
  - "tests/fixtures/**"
  - "docs/samples/**"
```

Use this sparingly. Every ignored path is a place where a real secret can hide later.

### 2. Code scanning on new code, not old code

The mistake I see most often with CodeQL is enabling it on a ten-year-old monolith with the extended query suite and presenting the team with 400 alerts. Nobody fixes 400 alerts. Instead:

- Start with the default query suite. Add `security-extended` only once the team is triaging the default results.
- Focus the conversation on pull requests. Code scanning annotates the diff, so the developer sees the finding while the change is still in their head.
- Treat the backlog of existing alerts as a separate, time-boxed piece of work, prioritised by severity.

Here's a workflow for a repository with C# and JavaScript. CodeQL needs to observe a C# build, so I build explicitly rather than relying on autobuild, which tends to guess wrong on solutions with several projects:

```yaml
# .github/workflows/codeql.yml
name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: "30 1 * * 1"

jobs:
  analyze:
    name: Analyze (${{ matrix.language }})
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write

    strategy:
      fail-fast: false
      matrix:
        language: [csharp, javascript]

    steps:
      - name: Checkout repository
        uses: actions/checkout@v2

      - name: Set up .NET
        if: matrix.language == 'csharp'
        uses: actions/setup-dotnet@v1
        with:
          dotnet-version: "6.0.x"

      - name: Initialise CodeQL
        uses: github/codeql-action/init@v1
        with:
          languages: ${{ matrix.language }}

      # Assumes one solution file at the repo root; otherwise use
      # dotnet build <your-solution>.sln
      - name: Build
        if: matrix.language == 'csharp'
        run: dotnet build --configuration Release /p:UseSharedCompilation=false

      - name: Perform CodeQL analysis
        uses: github/codeql-action/analyze@v1
        with:
          category: "/language:${{ matrix.language }}"
```

The toolchain is set up before `init`, and `/p:UseSharedCompilation=false` stops the .NET compiler server from reusing a process the CodeQL tracer can't see, so every compilation gets extracted. JavaScript is interpreted, so it needs no build step. The weekly schedule matters: CodeQL queries are updated regularly, and a scheduled run picks up new checks against code that hasn't changed.

### 3. Make it a merge gate, carefully

Code scanning creates a check on each pull request. Since July 2021, CodeQL security alerts carry a [security severity of critical, high, medium or low](https://github.blog/changelog/2021-07-19-codeql-code-scanning-new-severity-levels-for-security-alerts/), and by default the check fails on critical and high alerts (and on `error`-level non-security alerts). You can change those thresholds in the repository's Security & analysis settings, then mark the check as required in branch protection.

You don't need a custom workflow that queries the alerts API and fails the build. That approach duplicates what the platform already does and breaks the first time someone renames a workflow. Use the built-in check and tune the threshold.

My rule of thumb: run code scanning for two to four weeks without making the check required. Watch the false-positive rate. When the team trusts the results, make it required. If you gate on day one, the first false positive becomes the argument for turning the whole thing off.

### 4. Dependency review as a reviewer habit

Dependency review needs no workflow: once the dependency graph and GHAS are enabled on the repository, it appears in the pull request's rich diff for manifest and lock files. On private repositories the dependency graph is opt-in, so check it's on. The work is cultural: reviewers need to actually open that view when a PR touches `package-lock.json` or a `.csproj`. Add it to your PR template checklist.

## Enabling at scale

For a handful of repos, the Settings UI is fine. For an organisation, script it. The [repository update endpoint](https://docs.github.com/en/rest/repos/repos#update-a-repository) accepts a `security_and_analysis` object. This script enables GHAS and secret scanning on a list of repositories, using a token from an organisation owner or repository admin with the `repo` scope:

```python
import os

import requests

GITHUB_API = "https://api.github.com"
OWNER = "<your-org>"
REPOS = ["<repo-one>", "<repo-two>"]


def enable_ghas(owner: str, repo: str, token: str) -> None:
    response = requests.patch(
        f"{GITHUB_API}/repos/{owner}/{repo}",
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
        },
        json={
            "security_and_analysis": {
                "advanced_security": {"status": "enabled"},
                "secret_scanning": {"status": "enabled"},
            }
        },
        timeout=30,
    )
    response.raise_for_status()
    print(f"Enabled GHAS and secret scanning on {owner}/{repo}")


if __name__ == "__main__":
    github_token = os.environ["GITHUB_TOKEN"]
    for repo_name in REPOS:
        enable_ghas(OWNER, repo_name, github_token)
```

Both settings go in one request because secret scanning on a private repository requires Advanced Security to be enabled. The dependency graph, which dependency review relies on, is a separate setting: enable it in the repository's Security & analysis settings (or for all private repositories at organisation level), because this script doesn't touch it. Enabling GHAS doesn't add a CodeQL workflow, so you still need to roll out the workflow file from the previous section, ideally through an organisation workflow template so teams start from a known-good configuration.

Organisation settings also let you enable GHAS and secret scanning automatically for new repositories. Turn that on once you've decided which teams are licensed, or you'll consume seats as soon as someone creates a sandbox repo.

## When GHAS isn't the right buy

- **Your code is mostly in languages CodeQL doesn't support.** You'd be paying mainly for secret scanning and dependency review.
- **You're on Azure Repos or another Git host.** GHAS only works on GitHub repositories, so it's a migration decision first. If your code lives on GitHub but CI runs in Azure Pipelines or Jenkins, the CodeQL CLI can analyse it there and upload the SARIF results to code scanning.
- **Nobody owns triage.** If no team has the time to fix findings, start with the free features (Dependabot alerts and security updates, and code scanning on any open-source repos) and build the habit before paying for more alerts.
- **You already run a mature SAST tool that developers trust.** You can upload its SARIF to code scanning, but then you're paying GHAS for the alert UI and secret scanning. Make that comparison honestly.

## The takeaway

GHAS is the most developer-friendly security tooling I've used, because it shows findings in the pull request where the fix is cheapest. That advantage disappears if you roll it out as a compliance switch. License deliberately, start with secret scanning, enable CodeQL on new code before tackling the backlog, and make the check required only after the team trusts it.
