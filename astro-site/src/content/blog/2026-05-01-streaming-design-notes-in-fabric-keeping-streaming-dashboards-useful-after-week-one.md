---
title: "Real-Time Dashboards in Git: Reviewable Changes and a Way Back"
description: "Put Fabric Real-Time Dashboards under Git so tile and query changes are reviewed, validated before Update from Git, and reverted cleanly when they break."
author: Michael John Peña
draft: false
date: 2026-05-01
tags:
  - Microsoft Fabric
  - Real-Time Intelligence
  - KQL
  - CI/CD
  - Dashboards
---

Most real-time dashboards are edited live, in production, by whoever has the editor role. That works for week one. By week six nobody can say why a threshold moved, who rewrote the query behind the throughput tile, or what the page looked like before last Tuesday's "small tweak" broke it. Without history, you can't review a change before it lands or undo it after.

I covered the design rules that keep a dashboard trusted (freshness tiles, owned tiles, refresh as a capacity decision) in [Why Real-Time Dashboards Rot After Week One](/blog/2026-03-07-real-time-signals-that-actually-help-keeping-streaming-dashboards-useful-after-week-one/). This post is about the other half: making changes to a Fabric Real-Time Dashboard reviewable, repeatable and reversible, so the design you agreed on in week one is still the design six months later.

## What Fabric already gives you

Real-Time Intelligence items are part of Fabric's lifecycle management. [Git integration and deployment pipelines](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/git-deployment-pipelines) both support Eventhouses, KQL databases, KQL querysets, Eventstreams and Real-Time Dashboards, with Activator's Git support still marked preview. Git integration works with Azure DevOps and with cloud-hosted GitHub and GitHub Enterprise.

When a workspace syncs, each dashboard becomes a folder named `<item name>.KQLDashboard` holding a `.platform` file and a single JSON definition. That JSON is the whole dashboard: pages, tiles and their layout, parameters, base queries, data sources, and every query's KQL as a string. The [Real-Time Dashboard Git reference](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/git-real-time-dashboard) documents the shape.

The KQL database underneath syncs as `DatabaseProperties.json` plus `DatabaseSchema.kql`, a script of `.create-merge table`, `.create-or-alter function`, materialized view, update policy, encoding policy and ingestion mapping commands. The [Eventhouse and KQL database Git reference](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/git-eventhouse-kql-database) lists the supported commands.

None of this stops someone editing production in the browser. That's a process decision, and it's the one that matters. Enforce it with workspace roles: take Contributor, Member and Admin on the production workspace away from everyone except the deployment identity and a small release group, and give consumers Viewer access or share the dashboard item directly. Then a pull request is the only route into production.

## Treat the dashboard JSON as the reviewed artefact

My rule: a change to a production dashboard is a pull request against that JSON, not an edit in the browser. The reviewer sees a diff of KQL text, tile titles and parameter defaults. A sentence in the PR description says which decision the change serves.

Editing in the UI is still fine in a development workspace. The flow I recommend:

1. Editors work in a dev workspace connected to a feature branch.
2. They commit from the workspace, which writes the JSON to the branch.
3. A pull request into the main branch gets reviewed by the tile owner, not only by another engineer.
4. The production-facing workspace is updated from the main branch, or promoted through a deployment pipeline from a test stage that is.

Who reviews matters more than the tooling. A KQL expert can confirm a query is valid. Only the line supervisor who acts on the tile can confirm that changing `bin(Timestamp, 1m)` to `bin(Timestamp, 5m)` still lets them see a stall in time.

## Validate before Update from Git, not after

Hand edits to the JSON are tempting: copying a tile to a new page, bulk-renaming titles, swapping a data source. The dashboard load endpoint enforces rules beyond the JSON schema, and a violation shows up as an "Error loading dashboard" message in the UI after you've already run **Update from Git**. The rules Microsoft documents:

- Every `id` in `tiles`, `queries`, `baseQueries`, `parameters`, `dataSources` and `pages` must be unique within its section and a valid RFC 4122 UUID. A readable string with dashes in it is rejected.
- Every query must be referenced exactly once, counted across tile query references, base queries and parameter data sources. Two tiles can't share a query; duplicate the query with a new ID instead.
- Don't change the identifiers or the eTag of existing entries. The documented list: top-level `id`, `eTag` and `schema_version`; each tile's `id`, `pageId` and `queryRef.queryId`; each query's `id` and `dataSource.dataSourceId`; each data source's `id` and `scopeId`; each page's `id`; each parameter's `id` and `variableName` (plus `beginVariableName` and `endVariableName` on duration parameters); and `config.logicalId` in `.platform`. Fabric treats a changed identifier as a delete and re-create, and you lose state attached to the original.

Those rules are mechanical, so a machine should check them in the pull request. This script runs on Python 3.9 or later with only the standard library. It checks the canonical 8-4-4-4-12 hex format, not the variant bits. It also adds two checks of my own as warnings: every tile has a title, and every tile query is bounded by the dashboard's `_startTime` time range parameter.

```python
"""Check Fabric Real-Time Dashboard definitions in a Git-synced repo.

Usage: python check_rtd.py <path-to-repo-or-workspace-folder>
Exits 1 if any dashboard breaks a documented load rule.
"""
import json
import sys
import uuid
from collections import Counter
from pathlib import Path

SECTIONS = ["tiles", "queries", "baseQueries", "parameters", "dataSources", "pages"]


def is_uuid(value):
    if not isinstance(value, str):
        return False
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        return False
    return str(parsed) == value.lower()


def query_ref(item):
    return item.get("queryRef") or {}


def check_dashboard(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    errors, warnings = [], []

    for section in SECTIONS:
        ids = [item.get("id") for item in data.get(section) or []]
        for item_id in ids:
            if not is_uuid(item_id):
                errors.append(f"{section}: id {item_id!r} is not an RFC 4122 UUID")
        for item_id, count in Counter(ids).items():
            if count > 1:
                errors.append(f"{section}: id {item_id} is used {count} times")

    tiles = data.get("tiles") or []
    refs = [query_ref(t).get("queryId") for t in tiles
            if query_ref(t).get("kind") == "query"]
    refs += [b.get("queryId") for b in data.get("baseQueries") or []]
    refs += [query_ref(p.get("dataSource") or {}).get("queryId")
             for p in data.get("parameters") or []]
    ref_counts = Counter(r for r in refs if r)

    queries = {q.get("id"): q for q in data.get("queries") or []}
    for query_id in queries:
        count = ref_counts.get(query_id, 0)
        if count != 1:
            errors.append(f"queries: {query_id} is referenced {count} times, expected 1")
    for query_id in ref_counts:
        if query_id not in queries:
            errors.append(f"queries: reference to missing query {query_id}")

    for tile in tiles:
        label = tile.get("title") or tile.get("id")
        if not str(tile.get("title") or "").strip():
            warnings.append(f"tile {tile.get('id')}: no title, so nobody knows what it's for")
        ref = query_ref(tile)
        if ref.get("kind") == "query":
            text = (queries.get(ref.get("queryId")) or {}).get("text") or ""
            if "_startTime" not in text:
                warnings.append(f"tile '{label}': query ignores the dashboard time range")

    return errors, warnings


def main(root):
    files = sorted(p for p in Path(root).rglob("*.json")
                   if p.parent.name.endswith(".KQLDashboard"))
    failed = False
    for path in files:
        errors, warnings = check_dashboard(path)
        for message in errors:
            print(f"ERROR   {path}: {message}")
        for message in warnings:
            print(f"WARNING {path}: {message}")
        failed = failed or bool(errors)
    print(f"Checked {len(files)} dashboard definition(s)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "."))
```

The `_startTime` warning is a heuristic. It looks for the variable name in the tile's own KQL, so it flags tiles that get their time filter from a base query or a stored function, and it skips tiles that reference a base query directly. Treat it as a prompt for the reviewer, not a gate.

Run the errors as a required check on pull requests into the main branch. The script doesn't catch identity changes, because that needs the previous version of the file. A reviewer catches those by looking for changed `id` lines in the diff, which is one more reason the diff, not the rendered dashboard, is what gets reviewed.

## Reference data is the gap

The freshness and threshold patterns from the earlier post depend on small reference tables: `ExpectedSources` (which device, who owns it, how long it may go quiet) and a threshold table that every tile looks up. Git integration versions those tables' *schema* through `DatabaseSchema.kql`. It doesn't version their *rows*. The script only supports schema-level commands, and ingestion isn't one of them.

That matters, because a threshold change is exactly the kind of change you want reviewed. Someone moving "warning" from 80 to 75 changes what every tile and every alert says, without touching a line of dashboard JSON.

My approach: keep the rows in the same repo as a KQL command file, reviewed like any other change, and run it as a post-deployment step against each stage's database.

```kql
.set-or-replace ExpectedSources <|
    datatable(DeviceId: string, Owner: string, MaxSilenceMinutes: int)
    [
        "press-01", "<line-supervisor-alias>", 5,
        "press-02", "<line-supervisor-alias>", 5,
        "kiln-03", "<maintenance-lead-alias>", 15
    ]
```

`.set-or-replace` swaps the table contents in one operation, so the table matches the file after every run. The table itself stays in `DatabaseSchema.kql` as a `.create-merge table` command. Fabric deployment pipelines can't run a post-deployment script, so the step needs its own runner. Two options that work: an Azure DevOps or GitHub Actions job that sends the `.kql` file to each stage's Query URI through the Kusto management REST endpoint or the Kusto Python or .NET SDK, authenticated as a service principal; or a Fabric notebook in each stage's workspace that reads the file and runs the command. Either way, give that identity Table Admin on the reference tables (the minimum `.set-or-replace` needs on an existing table), not database admin, with `.add table ExpectedSources admins ("aadapp=<app-id>;<tenant-id>")`, and keep the step idempotent so a re-run is harmless.

If you only have two or three thresholds and they change once a year, this is overkill. Hard-coding is still wrong, but a manual update with a note in the deployment history is a fair trade at that size.

## The way back

Deployment pipelines keep a [deployment history](https://learn.microsoft.com/en-us/fabric/cicd/deployment-pipelines/deployment-history) with who deployed what and when, plus an optional note per deployment. That's an audit log, not a restore point. You can't redeploy last week's version of a stage from it, and backward deployment only works into an empty stage.

The restore point is Git. To roll back a bad dashboard change:

1. Revert the commit on the main branch, through a pull request like any other change.
2. In the workspace connected to that branch, pull the update in from the **Source control** panel. An update always syncs the whole workspace to the latest commit, so make sure nothing else unreviewed is waiting on the branch.
3. If production is a later pipeline stage, promote the reverted item forward again.

Run a revert drill in the test stage before you need it in production. Write the steps into the runbook next to the tile owners list, and record the rollback in the deployment note so the history shows the reason.

## Check where the deployed copy points

Each data source in the dashboard JSON carries a `clusterUri` and a `database` value (a name or item ID) as plain fields. Deployment pipelines [autobind dependent Fabric items](https://learn.microsoft.com/en-us/fabric/cicd/deployment-pipelines/understand-the-deployment-process#autobinding) in general, but at the time of writing the Real-Time Intelligence CI/CD docs don't confirm this covers dashboard data sources, so verify it rather than assume it. A test dashboard quietly reading dev data looks healthy and proves nothing.

After the first deployment to a stage, open the dashboard there in editing mode, open the data sources pane, and compare each source's cluster and database with the Query URI and the database name or item ID shown for that stage's KQL database. If the stage's workspace is connected to Git, do the same against the committed JSON: every `clusterUri` should equal that stage's query URI. That's a few extra lines in the validation script if you keep one expected URI per stage. Repeat the check whenever someone adds or edits a data source.

Permissions also don't travel with the definition. If the dashboard runs queries under an editor's cloud connection rather than passing through the viewer's identity, each stage needs its own cloud connection with a named owner. A connection that goes unused for 90 days expires and has to be re-authenticated, so a rarely opened test stage will break quietly. The [dashboard permissions documentation](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/dashboard-permissions) covers both models.

## When this is too much process

- **A personal or exploratory dashboard.** If one person builds it and uses it, Git adds ceremony without protecting anyone.
- **A dashboard with a short, known lifespan.** A board for a two-week cutover doesn't need a deployment pipeline. Export the JSON for the record and move on.
- **No one will review.** A pull request that one person opens and merges is a slower version of editing live. Fix the ownership first, then add the process.

## Where I'd start

If you change only one thing, connect the workspace that holds your production dashboard to Git and commit it today. That gives you history and a revert path even before anyone reviews anything. Then add the validation check, then move reference rows into the repo, then add pipeline stages. Each step is useful on its own. A dashboard whose changes are diffs with owners stays useful long after week one, because nobody has to remember why it looks the way it does.
