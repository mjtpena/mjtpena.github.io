---
title: "Fabric Runtime 2.0 Is GA but Not Default: An Upgrade Plan"
description: "Fabric Runtime 2.0 is GA and set to become the default in late September. A plan to inventory, test libraries and Delta features, and pin runtimes first."
author: Michael John Peña
draft: false
date: 2026-09-03
tags:
  - Microsoft Fabric
  - Spark
  - Delta Lake
  - Data Engineering
  - Migration
---

Fabric Runtime 2.0 is generally available, and it's a bigger jump than any Fabric Spark upgrade so far: Spark 3.5 to 4.1, Scala 2.12 to 2.13, Java 11 to 21, Python 3.11 to 3.13, Delta Lake 3.2 to 4.2, and Azure Linux 2.0 to 3.0, all in one move. Microsoft has deliberately not made it the default yet, but the [Runtime 2.0 page](https://learn.microsoft.com/en-us/fabric/data-engineering/runtime-2-0) says the plan is to make it the default selection, and the default for new workspaces and environment items, in late September 2026. That leaves a few weeks to decide which workloads move, which stay pinned, and which Delta tables must not be touched until every reader has caught up.

## What actually changes, and when

Runtime 2.0 moved from preview to GA in August, and the [Runtime 2.0 page](https://learn.microsoft.com/en-us/fabric/data-engineering/runtime-2-0) now lists it as generally available. Here is the component comparison that drives most of the work below:

| Component | Runtime 1.3 | Runtime 2.0 |
|---|---|---|
| Apache Spark | 3.5 | 4.1 |
| Scala | 2.12.17 | 2.13.16 |
| Java | 11 | 21 |
| Python | 3.11 | 3.13 |
| Delta Lake | 3.2 | 4.2 |
| R | 4.4.1 | 4.5.2 |
| OS | Azure Linux 2.0 (Mariner 2.0) | Azure Linux 3.0 (Mariner 3.0) |

Two dates matter more than the default switch. The [runtime lifecycle page](https://learn.microsoft.com/en-us/fabric/data-engineering/lifecycle) lists Runtime 1.3's end of standard support as 30 September 2026, followed by six months of Long Term Support through March 2027. Runtime 2.0 is supported until 31 August 2028. So "not default yet" doesn't mean "optional". Runtime 1.3 is your bridge until March, and the default switch is just the first point where the change can reach you without anyone deciding it should.

Read the default-switch wording carefully. It applies to the selection in the UI and to *new* workspaces and *new* environment items. My reading is that a workspace already set to 1.3 isn't flipped for you, but anything created after the switch starts on 2.0 unless someone picks otherwise. That's where teams get caught: the developer who creates a fresh environment for a new notebook, or the deployment pipeline that creates a feature-branch workspace, ends up on a different runtime from production without anyone choosing that.

## Step 1: Inventory what runs on what

You can't plan a migration if you don't know the runtime of each workload. A notebook or Spark job definition runs on its attached environment's runtime if it has one, and on the workspace default if it doesn't. Both are available through the Fabric REST API: the workspace Spark settings carry `environment.runtimeVersion`, and each environment's published Spark compute has a `runtimeVersion` field in the environment public API.

```python
"""Inventory Spark runtime versions across every Fabric workspace you can see.

Requires: pip install azure-identity requests
Run as an identity with at least Contributor on the workspaces you want covered.
"""
import csv
import sys
import time

import requests
from azure.identity import DefaultAzureCredential

API = "https://api.fabric.microsoft.com/v1"
token = DefaultAzureCredential().get_token("https://api.fabric.microsoft.com/.default").token
session = requests.Session()
session.headers["Authorization"] = f"Bearer {token}"


def get_all(url: str) -> list[dict]:
    """Follow Fabric continuation links until the list is exhausted."""
    items = []
    while url:
        resp = session.get(url, timeout=60)
        resp.raise_for_status()
        body = resp.json()
        items.extend(body.get("value", []))
        url = body.get("continuationUri")
    return items


def get_json(url: str) -> dict | None:
    """Return the body, {} if the resource doesn't exist yet, or None if access is denied."""
    for _ in range(5):
        resp = session.get(url, timeout=60)
        if resp.status_code != 429:
            break
        time.sleep(int(resp.headers.get("Retry-After", "30")))  # Fabric API throttling
    if resp.status_code in (401, 403):
        return None  # no permission on this workspace or item
    if resp.status_code == 404:
        return {}  # e.g. an environment that has never been published
    resp.raise_for_status()
    return resp.json()


writer = csv.writer(sys.stdout)
writer.writerow(["workspace", "scope", "item", "runtime"])

for ws in get_all(f"{API}/workspaces"):
    ws_id, ws_name = ws["id"], ws["displayName"]

    settings = get_json(f"{API}/workspaces/{ws_id}/spark/settings")
    if settings:
        default_runtime = settings.get("environment", {}).get("runtimeVersion", "unknown")
        writer.writerow([ws_name, "workspace-default", "", default_runtime])

    for env in get_all(f"{API}/workspaces/{ws_id}/environments"):
        compute = get_json(
            f"{API}/workspaces/{ws_id}/environments/{env['id']}/sparkcompute?beta=False"
        )
        runtime = "no access" if compute is None else compute.get("runtimeVersion", "unpublished")
        writer.writerow([ws_name, "environment", env["displayName"], runtime])
```

The output gives you a list of workspaces and environments that you can sort by runtime. Add an owner column by hand. Every environment without an owner is a candidate for deletion rather than migration.

## Step 2: Find the library breaks before the runtime does

Runtime changes migrate your library list, not your libraries' compatibility. The [multiple runtimes documentation](https://learn.microsoft.com/en-us/fabric/data-engineering/runtime) says it plainly: if the Python and R versions stay the same, libraries carry over, but JARs have "a significant chance" of breaking because of changes in Scala, Java, Spark and the OS. Moving from 1.3 to 2.0 changes the Python *and* R versions too, so treat every custom library as suspect.

**Scala and JARs.** Spark 4 supports only Scala 2.13, and Scala minor versions aren't binary compatible. Any artifact with a `_2.12` suffix needs a `_2.13` build, and any in-house JAR needs recompiling against Spark 4.1 and Java 21. Check the third-party connectors first. A missing 2.13 build of a vendor connector is the kind of blocker no amount of work on your side will fix.

**Python 3.13.** Two Python releases removed standard library modules. Python 3.12 dropped `distutils`, `imp`, `asyncore`, `asynchat` and `smtpd`. Python 3.13 removed the PEP 594 "dead batteries" (`cgi`, `telnetlib`, `imghdr`, `pipes`, `crypt` and others) along with `lib2to3`. Old notebooks and in-house wheels tend to import these indirectly. Pinned package versions are the other trap: a version pinned in 2024 often has no wheel for 3.13.

If your workspaces are connected to Git, you can scan the source before you run anything:

```python
"""Scan a Fabric Git repo for Runtime 2.0 risks: removed stdlib modules and Scala 2.12 artifacts."""
import re
import sys
from pathlib import Path

REMOVED_MODULES = {
    # removed in Python 3.12
    "distutils", "imp", "asynchat", "asyncore", "smtpd",
    # removed in Python 3.13 (PEP 594) plus lib2to3
    "aifc", "audioop", "cgi", "cgitb", "chunk", "crypt", "imghdr", "mailcap",
    "msilib", "nis", "nntplib", "ossaudiodev", "pipes", "sndhdr", "spwd",
    "sunau", "telnetlib", "uu", "xdrlib", "lib2to3",
}
IMPORT_RE = re.compile(r"^\s*(?:from|import)\s+([a-zA-Z_][\w]*)", re.MULTILINE)
SCALA_212_RE = re.compile(r"_2\.12\b")

root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
for path in root.rglob("*"):
    if not path.is_file():
        continue
    if path.suffix == ".jar" and SCALA_212_RE.search(path.name):
        print(f"SCALA 2.12 JAR   {path}")
        continue
    if path.suffix not in {".py", ".yml", ".yaml", ".json", ".txt", ".scala", ".sbt", ".xml"}:
        continue
    text = path.read_text(encoding="utf-8", errors="ignore")
    for module in sorted({m for m in IMPORT_RE.findall(text) if m in REMOVED_MODULES}):
        print(f"REMOVED MODULE   {path}: {module}")
    if SCALA_212_RE.search(text):
        print(f"SCALA 2.12 REF   {path}")
```

The scan assumes the default Git format, where each notebook is stored as `notebook-content.py`. If you've chosen `.ipynb` instead, the source lines sit inside JSON strings, so load each file with `json.loads` and join the `source` of every code cell before applying `IMPORT_RE`. It won't catch everything, such as transitive imports inside a third-party wheel, but it gives you a list to start from instead of finding problems one failed job at a time.

**Spark 4 behaviour.** Upstream, Spark 4.0 turned on ANSI SQL mode by default, so casts and arithmetic that used to return `NULL` quietly can now raise errors. Check `spark.conf.get("spark.sql.ansi.enabled")` in a 2.0 session instead of assuming, and read the "Upgrading from Spark SQL 3.5 to 4.0" section of the [Spark SQL migration guide](https://spark.apache.org/docs/latest/sql-migration-guide.html). SparkR is also deprecated in Spark 4.x, so R-heavy teams should plan their exit from SparkR now, not when it's removed.

One operational detail to know about: Microsoft's Runtime 2.0 page currently warns that a Python upgrade rolled out to 2.0 broke environments with Python and wheel libraries, showing a `LibraryManagementError` asking you to republish. The documented fix is to remove all libraries, publish, re-add them and publish again. It's a reminder that environments are built artefacts. Keep the library list in source control so rebuilding one is a routine task.

## Step 3: Treat Delta protocol upgrades as hard to undo

Rolling a runtime back is easy: change the environment back to 1.3 and republish. Rolling a Delta table's protocol back is not. The runtime docs call protocol upgrades nonreversible. Delta does have [`ALTER TABLE ... DROP FEATURE`](https://docs.delta.io/latest/delta-drop-feature.html) for some features, such as deletion vectors, but it rewrites data and truncates table history, so treat it as a recovery procedure, not a rollback. The part of the plan most likely to break production is a 2.0 job that creates or replaces a table, or enables a feature on one, that another reader can no longer open. Appends and merges into an existing table keep its protocol; CREATE OR REPLACE and drop-and-recreate patterns pick up the 2.0 defaults.

The [Delta Lake interoperability matrix](https://learn.microsoft.com/en-us/fabric/fundamentals/delta-lake-interoperability) shows how wide the gap is. Runtime 1.3 writes tables at reader 1 / writer 2 by default. Runtime 2.0's default is reader 3 / writer 7 with deletion vectors. Most Fabric engines read deletion vectors, but Python notebooks (which use `deltalake`, Polars and DuckDB) and pipelines don't. In Python notebooks, DuckDB's `delta_scan` can read them as a read-only workaround. Type widening isn't supported on Runtime 1.3. Delta 4.x features such as variant, collations and coordinated commits aren't supported outside Spark at all, and Microsoft describes Delta 4.2-specific features as experimental, Spark-only, and not something to enable on tables shared across workloads. V2 checkpoints are Spark-only as well, and the Lakehouse and SQL analytics endpoint don't list those tables correctly.

So before the first 2.0 job creates or replaces a shared table, take a baseline of every table's protocol and repeat it after each migration wave:

```python
# Run in a Fabric notebook attached to the lakehouse you want to audit.
RISKY_FEATURES = {
    "deletionVectors": "not readable by Python notebooks (deltalake/Polars) or pipelines",
    "typeWidening": "not supported on Runtime 1.3 or Python notebooks",
    "v2Checkpoint": "Spark only; Lakehouse and SQL endpoint listing affected",
    "variantType": "Delta 4.x feature, Spark only",
    "collations": "Delta 4.x feature, Spark only",
}

rows = []
for db in spark.catalog.listDatabases():  # covers every schema in a schema-enabled lakehouse
    for table in spark.catalog.listTables(db.name):
        if table.tableType in ("VIEW", "TEMPORARY") or table.isTemporary:
            continue
        detail = spark.sql(f"DESCRIBE DETAIL `{db.name}`.`{table.name}`").collect()[0].asDict()
        features = detail.get("tableFeatures") or []
        risks = [
            f"{feat}: {why}"
            for feat in features
            for key, why in RISKY_FEATURES.items()
            if feat.startswith(key)
        ]
        rows.append((db.name, table.name, detail["minReaderVersion"], detail["minWriterVersion"],
                     ", ".join(sorted(features)), "; ".join(risks)))

audit = spark.createDataFrame(
    rows, "schema string, table string, reader int, writer int, features string, risks string"
)
display(audit.orderBy("reader", "writer", ascending=False))
```

Then use the results to make a decision for each table. Tables read only by Spark, all moving to 2.0 together, can take on the new defaults. Tables with other readers need their writers to hold back, and how far depends on the reader:

| Reader | Writers must avoid |
|---|---|
| Direct Lake models and the SQL analytics endpoint | Delta 4.x features (variant, collations, coordinated commits) and V2 checkpoints |
| Python notebooks and pipelines | Deletion vectors and type widening, plus the Delta 4.x features and V2 checkpoints above |
| Runtime 1.3 jobs that aren't migrating yet | Type widening and Delta 4.x features |

If you're [mixing storage modes in Direct Lake models](/blog/2026-09-01-direct-lake-tables-to-import-hybrid-models/), check the tables behind them too. Writer settings can be controlled per table with properties such as `delta.enableDeletionVectors`, or for new tables in a session with `spark.databricks.delta.properties.defaults.enableDeletionVectors=false`. Before you rely on that session default, create a scratch table on 2.0 and confirm with `DESCRIBE DETAIL` what you actually get.

## Step 4: Pin explicitly, then move in waves

The default switch only catches you out where you've left the choice to the default. The goal is to make the runtime an explicit decision everywhere:

1. **Record and lock each production workspace's runtime.** Confirm it reads 1.3 in the inventory (Workspace settings > Data Engineering/Science > Spark settings > Environment), and restrict who can change Spark settings (workspace Admin only) so nobody flips it ad hoc.
2. **Give each production workload its own environment item with the runtime set**, and attach notebooks and Spark job definitions to it. An environment overrides the workspace default, so this is the pin that survives someone changing workspace settings.
3. **Pin runtimes in whatever creates workspaces.** If you provision workspaces from code, as I argued for in [treating the tenant as code](/blog/2026-07-27-fabric-cicd-is-solved-your-tenant-isnt-tenant-as-code/), set the Spark runtime in that definition. After late September, a newly created workspace that doesn't set it will start on 2.0.
4. **Create a 2.0 copy of each environment** and run the workload against non-production data with it. Compare row counts and outputs, not just whether the job succeeded. ANSI-mode errors fail loudly. Library behaviour changes don't.
5. **Move in waves ordered by readers, not by writers.** Move the downstream consumers of a table first, and its writers last, so no reader is left behind a protocol it can't read.

Runtime 1.3 also has an early access release channel (preview) that brings the Azure Linux 3.0 OS upgrade to 1.3. If you have OS-level dependencies, testing 1.3 on that channel separates OS problems from Spark 4 problems.

## When not to rush

I wouldn't move everything to 2.0 in September just because it's the default. If a workload depends on a connector with no Scala 2.13 build, or its tables feed engines that can't read the newer Delta features, stay on 1.3 until March 2027 and use the time to fix the dependency. That's a sensible use of the runtime's remaining support. What isn't sensible is staying on 1.3 because nobody checked. Run the inventory this week, pin everything explicitly before the default switch, and make each move to 2.0 a planned change with its Delta protocol consequences understood.
