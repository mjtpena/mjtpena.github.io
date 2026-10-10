---
title: "Natural Language over a Power BI Model: Let the LLM Pick, Not Write"
description: "Answer plain-English questions from a Power BI semantic model by having Azure OpenAI choose measures and filters, then run them with semantic link."
author: Michael John Peña
draft: false
date: 2025-01-19
tags:
  - Semantic Layer
  - Power BI
  - Microsoft Fabric
  - Azure OpenAI
  - Natural Language
---

Most "chat with your data" prototypes let a language model write SQL against raw tables. That means the model quietly redefines revenue, active customer and margin every time someone asks a question, and nobody notices until two answers disagree in a board pack. If your organisation already has a Power BI semantic model, those definitions have been written down, tested and argued over. The model should be the contract, and the LLM's job should shrink to picking from it.

Here is that pattern as it stands in January 2025: Azure OpenAI turns a question into a small query plan made only of measures and columns that exist in the model, your code checks the plan, and semantic link in Microsoft Fabric runs it. The LLM never writes DAX.

## What Microsoft gives you today, and where it stops

Before building anything, check whether a product already covers your case. In January 2025 there are three realistic options for natural language questions over Fabric and Power BI data.

| Option | What it queries | Status and requirements | Where it falls short |
|---|---|---|---|
| Copilot in Power BI | Reports and semantic models | Needs an F64 or higher, or a P SKU ([Copilot in Fabric overview](https://learn.microsoft.com/fabric/fundamentals/copilot-fabric-overview)); several experiences still in preview | Little control over prompting or output; lives inside Power BI |
| Fabric AI skill | Lakehouse, warehouse, KQL database or Power BI semantic model (generated T-SQL/DAX/KQL) | Public preview, F64 or higher | You can't constrain or validate the generated query; Microsoft advises against production use while in preview |
| Your own app on semantic link + Azure OpenAI | The semantic model, through its measures | Semantic link is in the default Fabric Spark runtime; you bring an Azure OpenAI deployment | You own the prompt, validation, hosting and evaluation |

The AI skill launched in August 2024 over a single lakehouse or warehouse, and the Ignite 2024 updates added Power BI semantic models and KQL databases as sources, with several sources per skill. The [AI skill concepts page](https://learn.microsoft.com/fabric/data-science/concept-data-agent) covers how it works and its preview limits. (Microsoft later renamed AI skill to Fabric data agent in 2025, so that link now opens the data agent page.) Over a semantic model it writes its own DAX, so it may or may not use your measures, and you can't put a check between the generated query and the answer. It also loses accuracy with large or poorly named schemas. I covered setting one up in [Fabric AI skills](/blog/2024-11-20-fabric-ai-skills/), and reviewing what Copilot produces in [Reviewing Copilot output in Fabric](/blog/2025-01-11-fabric-ai-features-copilot-deep-dive/).

If your users live in Power BI reports and you have the capacity, start with Copilot. The do-it-yourself route earns its place when the questions come from somewhere else, such as a Teams bot, an internal portal or an agent, and you need answers that match the numbers in the reports exactly.

## Why the LLM shouldn't write DAX

The obvious build is "send the schema to GPT-4o, ask for a DAX query, run it". I'd avoid that for anything business users will rely on:

- **Free-form DAX can't be checked cheaply.** A query can be valid and still wrong: a `CALCULATE` that drops a filter, a `SUMX` over the wrong table, or a time-intelligence calculation that ignores your fiscal calendar. You can't review every generated query.
- **It re-implements logic you already have.** If `[Net Revenue]` excludes returns and intercompany sales, a generated `SUM(Sales[Amount])` doesn't, and the answer won't match the report.

Access isn't the difference. Semantic link's metadata calls (`list_measures`, `list_columns`) and `evaluate_dax` go through the XMLA endpoint, so the capacity needs XMLA read enabled either way. `evaluate_measure` uses the REST backend by default. The [read and write Power BI data with Python](https://learn.microsoft.com/fabric/data-science/read-write-power-bi-python) guide spells out both paths.

The better contract looks like this. The LLM picks **which measures** to show, **which columns** to group by and **which values** to filter on. Your code checks every name against the model and calls `fabric.evaluate_measure`. The model's DAX does the maths. If a question can't be answered with existing measures, the system says so instead of improvising, and that gap becomes a backlog item for the model owner.

## Step 1: Harvest the vocabulary from the model

[Semantic link](https://learn.microsoft.com/fabric/data-science/semantic-link-overview) (the SemPy library) reads model metadata directly. The code below runs in a Fabric notebook on Runtime 1.2 or 1.3, where semantic link is preinstalled. The runtime's bundled `openai` package isn't guaranteed to be 1.x, and `AzureOpenAI` needs 1.x, so the first cell upgrades it:

```python
%pip install -U openai
```

The next cell collects the visible measures and columns along with their descriptions, because descriptions are what turn "turnover" into `[Net Revenue]`.

```python
import json

import notebookutils
import sempy.fabric as fabric
from openai import AzureOpenAI

DATASET = "<your-semantic-model>"
WORKSPACE = "<your-workspace>"

# Only expose what report users can see. Hidden measures and keys are
# implementation details, and every extra name lowers accuracy.
measures = fabric.list_measures(DATASET, workspace=WORKSPACE)
measures = measures[~measures["Measure Hidden"]]

columns = fabric.list_columns(DATASET, workspace=WORKSPACE)
columns = columns[~columns["Hidden"]].copy()
columns["Ref"] = "'" + columns["Table Name"] + "'[" + columns["Column Name"] + "]"

measure_names = sorted(measures["Measure Name"].unique().tolist())
column_refs = sorted(columns["Ref"].unique().tolist())
# Filters compare text values, so only text columns can be filtered on.
filter_refs = sorted(columns.loc[columns["Data Type"] == "String", "Ref"].unique().tolist())

def describe(rows, name_col, desc_col):
    lines = []
    for _, row in rows.iterrows():
        desc = row[desc_col] if isinstance(row[desc_col], str) and row[desc_col] else "no description"
        lines.append(f"- {row[name_col]}: {desc}")
    return "\n".join(lines)

catalogue = (
    "MEASURES\n" + describe(measures, "Measure Name", "Measure Description")
    + "\n\nCOLUMNS\n" + describe(columns, "Ref", "Description")
)
```

The column names come from SemPy's own output (`Measure Name`, `Measure Hidden`, `Measure Description`, `Table Name`, `Column Name`, `Hidden`, `Description`, `Data Type`). The quality of this catalogue sets the ceiling on answer quality. A measure called `M_Rev_Adj2` with no description won't be chosen correctly by any LLM. My rule of thumb: time spent writing descriptions in the semantic model pays back more than time spent on the prompt.

## Step 2: Constrain the plan with structured outputs

Azure OpenAI [structured outputs](https://learn.microsoft.com/azure/ai-services/openai/how-to/structured-outputs) are supported in the GA API version `2024-10-21` with `gpt-4o` version `2024-08-06` or later. With `strict` set to true, the response has to match the JSON schema. Putting the measure names and column references into `enum` lists means the LLM can't return a measure name that isn't in the semantic model.

```python
schema = {
    "type": "object",
    "properties": {
        "answerable": {"type": "boolean"},
        "reason": {"type": "string"},
        "measures": {"type": "array", "items": {"type": "string", "enum": measure_names}},
        "group_by": {"type": "array", "items": {"type": "string", "enum": column_refs}},
        "filters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "enum": filter_refs},
                    "values": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["column", "values"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["answerable", "reason", "measures", "group_by", "filters"],
    "additionalProperties": False,
}

client = AzureOpenAI(
    azure_endpoint="https://<your-resource-name>.openai.azure.com/",
    api_key=notebookutils.credentials.getSecret(
        "https://<your-key-vault-name>.vault.azure.net/", "<aoai-key-secret-name>"
    ),
    api_version="2024-10-21",
)

SYSTEM_PROMPT = f"""You map business questions to a Power BI semantic model.
Choose only existing measures and columns. Never invent calculations.
If the question needs a calculation that no measure provides, set answerable
to false and explain which measure is missing in reason.
Filters match exact column values only.

{catalogue}"""

def plan_question(question: str) -> dict:
    response = client.chat.completions.create(
        model="<your-gpt-4o-deployment>",
        temperature=0,
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "query_plan", "strict": True, "schema": schema},
        },
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ],
    )
    return json.loads(response.choices[0].message.content)
```

The `answerable` flag matters more than it looks. Without a clean way to refuse, an LLM asked for "churn rate" against a semantic model with no churn measure will pick the nearest-sounding measure and present it confidently. With the flag, "no measure for that yet" is a valid answer you can log and send to the semantic model's owner.

Structured outputs also cap schema size. The Azure page documents up to 100 object properties and five levels of nesting. OpenAI's [structured outputs guide](https://platform.openai.com/docs/guides/structured-outputs), which describes the same feature, adds the enum limits: 500 enum values across the whole schema, and 7,500 characters in total for a single enum with more than 250 values. The schema above spends its budget three times (measures, group-by columns and filter columns), so a semantic model with a few hundred visible columns will hit it. That's a useful signal: curate a smaller, question-friendly subset (or a perspective-like list you maintain) instead of exposing everything.

## Step 3: Validate values, then execute

Enums cover names, but not filter values. "Victoria" versus "VIC" is where these systems usually go wrong. Check each filter value against the column's actual contents before running anything:

```python
def known_values(column_ref: str) -> set[str]:
    # Only text columns reach here (see filter_refs), so values are strings already.
    df = fabric.evaluate_dax(DATASET, f"EVALUATE VALUES({column_ref})", workspace=WORKSPACE)
    return set(df.iloc[:, 0].dropna())

def answer(question: str):
    plan = plan_question(question)
    if not plan["answerable"] or not plan["measures"]:
        return plan, None

    filters = {}
    for f in plan["filters"]:
        unknown = set(f["values"]) - known_values(f["column"])
        if unknown:
            raise ValueError(f"Values not found in {f['column']}: {sorted(unknown)}")
        filters[f["column"]] = f["values"]

    result = fabric.evaluate_measure(
        DATASET,
        measure=plan["measures"],
        groupby_columns=plan["group_by"] or None,
        filters=filters or None,
        workspace=WORKSPACE,
    )
    return plan, result

plan, result = answer("Net revenue by region for the Consumer segment")
print(json.dumps(plan, indent=2))
display(result)
```

Always show the plan next to the result. Users trust "Net Revenue, grouped by Region, filtered to Segment = Consumer" because they can read it and spot a wrong choice. Nobody reads a 40-line DAX query.

If you'd rather not query column values on every question, cache `known_values` or refresh the lists on a schedule. Either way, only expose filters on low-cardinality text columns. Validating a filter on customer name against millions of rows on every question is a cost you don't need.

## The trade-offs you're signing up for

This design is deliberately narrow, and the narrowness has costs.

- **Filters are equality only.** `evaluate_measure` supports only "in" filters on column values. "Revenue over $10k" or "orders between March and June" don't fit. Point date questions at text calendar columns such as `'Date'[Month Name]` or a fiscal-year label like "FY2025". If `'Date'[Fiscal Year]` is an integer, it won't appear in `filter_refs`, so add a text label column rather than passing strings to a numeric column. Treat range filters as a reason to add a measure or a banding column to the model.
- **No ad hoc maths.** "Revenue per store as a percentage of the region total" works only if someone has built that measure. I count this as a feature. Every answerable question goes through reviewed DAX, and every refusal is a concrete request for the model team.
- **Security follows the caller.** Semantic link runs as the identity executing the notebook, so row-level security applies to that user. Remember that RLS doesn't apply to workspace Admins, Members or Contributors. If you put this behind a shared service identity, you've bypassed RLS for everyone using it.
- **Latency stacks up.** You're paying for one LLM call plus one or more semantic model queries. That's fine for a chat experience but not for a dashboard tile.

## When I wouldn't build this

Skip the custom route if Copilot in Power BI already reaches your users where they work and your capacity supports it. A Microsoft-maintained experience beats a notebook you have to look after. Skip it too if the semantic model is thin: few measures, no descriptions, cryptic names. The LLM will expose those gaps immediately, and fixing the model is the real project. And if your questions are mostly exploratory ("what's unusual in last week's orders?"), a plan of measures and filters is too rigid. That's a job for an analyst with good tools, not a constrained query planner.

## The takeaway

Treat the semantic model as the only place business logic lives and give the language model the smallest possible job: choosing from a closed list. Structured outputs make that list enforceable, semantic link makes it executable, and the refusals tell you exactly what the semantic model is missing.
