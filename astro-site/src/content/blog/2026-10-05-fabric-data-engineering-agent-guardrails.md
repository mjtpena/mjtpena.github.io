---
title: "Fabric's Data Engineering Agent: Set Guardrails Before Autonomy"
description: "Fabric's preview data engineering agent runs with the launching engineer's permissions. What to delegate first, which settings to pick, and what stays human."
author: Michael John Peña
draft: false
date: 2026-10-05
tags:
  - Microsoft Fabric
  - Data Engineering
  - AI Agents
  - Governance
  - CI/CD
---

Microsoft used FabCon Europe in Barcelona last week to preview a data engineering agent for Fabric, built on technology from the Osmos acquisition. It is pitched at long-running work, such as migrations, lakehouse modernisation and complex ETL, and it acts with the permissions of the engineer who launches it, across every workspace that engineer can reach. That detail decides how much you can safely hand it. An agent that borrows a person's access also borrows every gap in your access model.

## What was actually announced

Microsoft announced the acquisition of Osmos, a Seattle startup building agentic data engineering tools, in early January 2026. Osmos already had a native Fabric workload before the deal, and the team moved into the Fabric engineering organisation.

At FabCon Europe (28 September to 1 October 2026), it shipped as the [Fabric data engineering agent (Project Osmos)](https://learn.microsoft.com/en-us/fabric/data-engineering/data-engineering-agent-overview). Microsoft's [FabCon Europe analytics post](https://community.fabric.microsoft.com/blog/fbc_fabricupdatesblogs/bringing-governed-analytics-into-the-flow-of-work-fabric-analytics-at-fabcon-eur/5368918) frames it as "governed, autonomous execution of long-running initiatives", with engineers defining the outcome and the guardrails while the agent plans, executes, validates and refines. The Learn docs give the operational detail:

- **Status:** preview, not intended for production use and without an SLA.
- **Execution:** tasks run remotely on Fabric Spark, inspecting data, creating and testing notebooks, and writing Delta tables. They keep running after your laptop disconnects.
- **Permissions:** tasks run with the permissions of the person who launches them, across any workspace or OneLake item that person can reach; the selected lakehouse is only the default. Anyone with access to the hosting lakehouse can see the task's progress and activity and answer decisions it raises.
- **Surfaces:** tasks are created and steered from GitHub Copilot CLI, Codex or Claude Code through the Skills for Fabric plugin; the lakehouse in Fabric shows task status, activity and outputs. The [get-started guide](https://learn.microsoft.com/en-us/fabric/data-engineering/data-engineering-agent-get-started) says direct interaction from Copilot in the Fabric portal isn't supported.
- **Prerequisites:** Contributor or higher on the workspace, a paid capacity (trial SKUs aren't supported), the Copilot and Azure OpenAI tenant settings enabled, and no outbound access protection on the workspace.
- **Billing:** there is no GA date yet. It already bills against your capacity: token usage converts to CU seconds under the Copilot and AI meter, shown as a Project Osmos background operation in the Capacity Metrics app. The [consumption page](https://learn.microsoft.com/en-us/fabric/data-engineering/data-engineering-agent-consumption) lists the rates per model profile.

The product does ask for guardrails: before a task runs you review a permission boundary, a write pattern such as staging or clone-and-promote, rerun semantics and a schema-evolution policy. Microsoft's own docs say these guide the task while Fabric and OneLake permissions enforce it. Treat the settings as intent and your platform as the control.

## Pick safe settings, then assume they can be wrong

The settings review is worth taking seriously, and the [best-practices page](https://learn.microsoft.com/en-us/fabric/data-engineering/data-engineering-agent-best-practices) is clear about which patterns are risky. My defaults:

- **Write pattern:** clone-and-promote or a staging table. Iterating in place is for throwaway lakehouses only.
- **Schema evolution:** locked on any table with a contract or a downstream consumer. Type-widening is acceptable on new tables still taking shape.
- **Rerun semantics:** fail on rerun for a first run, so a retry can't silently append duplicates. Move to deduplicate on a stable business key once you trust the load.
- **Permission boundary:** name the sources as read-only explicitly, even when you think the outcome text makes that obvious.

None of these replaces a permission. A permission boundary that says "read-only" is an instruction to a model. A missing write grant is a fact the platform enforces.

## The real blast radius is the person, not the workspace

Running tasks as the launching user is the right design. A separate agent permission model would drift from the one your team already reviews, and nobody would audit it. The cost is that the agent's reach is whatever the launching engineer can write to, in every workspace and OneLake item, not just the lakehouse the task was pointed at. In most tenants I look at, an experienced engineer's effective rights are far wider than anyone would accept for an autonomous actor.

So the question is not "what can this workspace's Contributors touch?" It is "who launches tasks, and what else can they write to?" Fabric workspace roles are coarse: Admin, Member, Contributor and Viewer, with Contributor able to create, edit and delete items. If the engineer launching a task in development is also Contributor in production, separating the workspaces does nothing to contain the agent. The task can read or write production on that engineer's behalf.

Shortcuts widen this further. I covered why in [OneLake shortcuts are an authorisation boundary](/blog/2026-07-27-onelake-shortcuts-are-an-authorization-boundary-a-security-model-for-fabric/); an agent following a shortcut works under the same rules a person would, at a pace no person matches.

The fixes are boring and already available, in this order:

- **Keep production write access with a deployment identity**, not with people, and therefore not with an agent acting for people. This is the control that actually contains the agent.
- **Review what each launching engineer can write to**, across all workspaces. That list is now also the list of things the agent can change.
- **Separate workspaces by blast radius**, not by team convenience, with development, test and production apart. This helps only once the first two are true.
- **Check who can see the hosting lakehouse.** Its viewers can follow the task's activity and answer its questions, so check what that activity reveals before launching a task over data those viewers can't otherwise read.

## The contracts that make delegation safe

An agent that validates its own work is only as good as the definition of valid it is given. If correctness lives in someone's head, the agent will validate against whatever it infers, and it will report success.

### Table contracts

A table contract states the schema, keys, nullability, grain and freshness a downstream consumer depends on. I argued in [why table contracts matter before notebooks scale](/blog/2026-04-27-designing-better-lakehouse-flows-in-fabric-why-table-contracts-matter-before-notebooks-scale/) that these pay off once more than one team touches a lakehouse. An agent is another team, one that works overnight. Unless you lock schema evolution in the task settings, the agent can change schemas; the contract is what tells you whether a change is a refactor or a breaking change.

### Tests that run without the agent

The agent's own validation step is useful, but it should not be the only gate. Write the checks as ordinary notebook or pipeline steps that run on a schedule and before promotion, so a human-authored test fails regardless of who changed the table. A minimal contract check in a Fabric notebook looks like this (a fragment: `spark` is the session Fabric notebooks provide, and the table and column names are placeholders):

```python
from pyspark.sql import functions as F

# Schema-enabled lakehouses: "<your_lakehouse>.dbo.silver_orders"
TABLE = "<your_lakehouse>.silver_orders"
EXPECTED_COLUMNS = {
    "order_id": "bigint",
    "customer_id": "bigint",
    "order_date": "date",
    "amount": "decimal(18,2)",
}
KEY = ["order_id"]

df = spark.table(TABLE)
actual = {f.name: f.dataType.simpleString() for f in df.schema.fields}

errors = []
for col, dtype in EXPECTED_COLUMNS.items():
    if col not in actual:
        errors.append(f"missing column {col}")
    elif actual[col] != dtype:
        errors.append(f"{col} is {actual[col]}, expected {dtype}")

if all(k in actual for k in KEY):
    dupes = df.groupBy(*KEY).count().filter(F.col("count") > 1).limit(1).count()
    if dupes:
        errors.append(f"duplicate keys on {KEY}")

    for k in KEY:
        if df.filter(F.col(k).isNull()).limit(1).count():
            errors.append(f"null values in {k}")

if errors:
    raise AssertionError(f"Contract failed for {TABLE}: {errors}")
print(f"Contract passed for {TABLE}")
```

Extra columns pass on purpose. Additive change is usually safe; removed or retyped columns are not. Decide that policy per table and encode it, both here and in the task's schema-evolution setting, rather than leaving it to the agent's judgement.

### A reviewed path to production

Fabric Git integration syncs workspace items to Azure DevOps or GitHub, and deployment pipelines promote content between stages. Point the task at a Git-connected development workspace and set the artifact destination there, so generated notebooks appear as uncommitted workspace changes that a person commits and reviews. Table data the agent writes is outside Git entirely, which is why the staging or clone-and-promote write pattern and the contract tests matter more than the repo.

If engineers routinely edit production workspaces by hand, the agent launched by those engineers can do the same. I wrote about the gaps Git integration leaves, such as roles, connections and capacity assignment, in [Fabric CI/CD is solved, your tenant isn't](/blog/2026-07-27-fabric-cicd-is-solved-your-tenant-isnt-tenant-as-code/). Those gaps are exactly where an agent acting with a person's rights can make changes nobody reviews.

## What to delegate first

My rule of thumb: delegate work where a wrong answer is cheap to detect and cheap to undo. Keep work where a wrong answer is silent or permanent.

| Task | Delegate now? | Write pattern | Why |
|---|---|---|---|
| Translating legacy SQL or stored procedures into Spark notebooks in dev | Yes | Clone-and-promote | Output is code you review; a parallel run against the old system shows whether it matches |
| Building bronze-to-silver transforms against an existing contract | Yes | Staging table, locked schema | The contract test decides pass or fail, not the agent |
| Performance tuning of a single job (partitioning, file sizes, join strategy) | Yes, in dev | Clone-and-promote | Easy to benchmark before and after; easy to revert |
| Data-quality remediation | Yes, with review | Staging table | Before-and-after metrics are reviewable before anything replaces the source |
| Schema changes on tables with downstream consumers | Agent proposes, human approves | Locked schema plus human approval | Breaking changes hit reports and other teams you can't see from the notebook |
| Promotion to test or production | Human-approved, through the pipeline | Not delegated | This is the control point; don't move it |
| Deleting tables, files or historical data | Human only | Not delegated | Recovery depends on retention settings you may not have checked |
| Changes to workspace roles, shortcuts, connections or credentials | Human only | Not delegated | These change what the agent itself can reach |
| Anything touching regulated or personal data without classification | Not yet | Not delegated | The agent can't respect a sensitivity rule that was never written down |

The bottom rows are not a judgement on the agent's ability. They are actions where the platform has no automatic check that would catch a mistake, so a person is the check.

## When not to use it yet

Some platforms are not ready, and putting an agent on them makes things worse:

- **Engineers hold write access to production.** Every task they launch can reach it. Move production writes to a deployment identity first.
- **No written contracts or tests.** The agent will validate against its own reading of the data. You will get confident, plausible output with nothing to check it against.
- **Everyone is Admin.** Common in early Fabric adoptions. The agent then acts with the broadest possible rights, and the "governed" part has nothing to govern with.
- **Outbound access protection enabled.** Not supported on those workspaces.
- **Trial capacity.** Not supported.
- **No capacity headroom or monitoring.** High reasoning effort and pro-model profiles consume CUs quickly. Run tasks on a capacity you can cap and watch, not the one serving your executive reports.
- **Critical deadlines on a preview feature.** Behaviour, limits and billing can change before GA. Use it where a slip costs little.

## Where I'd start

Pick one well-understood migration slice, such as a handful of legacy stored procedures with known outputs. Launch it from an engineer whose rights stop at development, in a Git-connected workspace, with clone-and-promote writes, a locked schema on contracted tables, and contract tests written by your team before the agent starts. Review and commit the generated notebooks yourself, and promote only through the deployment pipeline.

If that goes well, widen the scope by adding contracts and tests, not by adding permissions. The agent's safe autonomy grows only as fast as your platform's ability to check its work. The teams that will get the most from this agent are the ones whose platforms were already strict with human engineers.
