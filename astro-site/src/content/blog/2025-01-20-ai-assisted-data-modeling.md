---
title: "Drafting a Star Schema with GPT-4o and Structured Outputs"
description: "Use GPT-4o structured outputs to draft a star schema from requirements, check it with plain code, and generate Fabric Warehouse DDL that respects its limits."
author: Michael John Peña
draft: false
date: 2025-01-20
tags:
  - Data Modeling
  - Azure OpenAI
  - Structured Output
  - Microsoft Fabric
  - Data Warehouse
  - AI
---

The slow part of a new warehouse project is rarely writing the DDL. It's the weeks spent turning a pile of requirements into a list of facts, a grain for each one, and the dimensions everyone agrees on. A large language model can produce a plausible first draft of that in seconds. The catch is that a plausible draft with the wrong grain is worse than no draft, because it looks finished.

My position is simple: use the model to draft the dimensional design and surface the questions, use deterministic code to check it, and keep a human responsible for the grain. Here is how I'd wire that up with Azure OpenAI and a Microsoft Fabric Warehouse as of January 2025.

## Where the model helps and where it doesn't

Kimball's [four-step dimensional design process](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/four-4-step-design-process/) is still the right frame: pick the business process, declare the grain, identify the dimensions, identify the facts. An LLM is useful at each step, but not equally.

| Step | What GPT-4o is good at | What still needs a person |
|---|---|---|
| Business process | Grouping requirements into candidate processes | Deciding which processes are in scope this release |
| Grain | Proposing a grain sentence per fact | Confirming the grain matches how the source system actually records events |
| Dimensions | Spotting the usual suspects (date, customer, product, store) | Conformed dimensions shared with existing marts |
| Facts | Listing measures and guessing additivity | Semi-additive and non-additive measures, which models routinely get wrong |

The model has read a lot of textbook star schemas, so its drafts look like textbook star schemas. That's both the value and the risk. It will happily put `account_balance` on a transaction fact and mark it additive, or invent a `dim_promotion` because retail examples usually have one. Role-playing dimensions are another common slip: an accumulating snapshot needs an order date and a ship date that both point at `dim_date`, and drafts often collapse them into one reference or name them so they collide. It also has no idea that your order lines arrive in a different system from your shipments, which is exactly the kind of fact that decides the grain.

So the workflow I recommend is: requirements in, typed draft out, automated checks, then a design review where people argue about the grain with the draft and its open questions on the screen.

## Constrain the output shape first

Asking for "a JSON structure" in the prompt, or using JSON mode, gets you valid JSON most of the time, but not necessarily your schema. For something you'll feed into a code generator, most of the time isn't good enough. Azure OpenAI's [structured outputs](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/structured-outputs) feature makes the model follow a JSON Schema you supply. It arrived in API version `2024-08-01-preview` and is in the GA API version `2024-10-21`, with `gpt-4o` version `2024-08-06` (or `gpt-4o-mini` version `2024-07-18`) as the model to deploy for it.

There are rules you have to design around. Every property must be required, `additionalProperties` must be false, and only a subset of JSON Schema is supported. In practice that pushes you towards flat, explicit shapes with enums wherever the answer is drawn from a fixed list. I also add an `open_questions` field, because the most useful thing a model can do in a design session is tell you what it had to assume. Fact tables reference dimensions through a role, so a fact can use `dim_date` twice as `order_date` and `ship_date`.

The three snippets below form one script, `draft_schema.py`; install its dependencies with `pip install openai azure-identity pydantic`.

```python
import os
from pathlib import Path
from typing import Literal

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI
from pydantic import BaseModel


class Column(BaseModel):
    name: str
    logical_type: Literal["string", "integer", "bigint", "decimal", "date", "datetime", "boolean"]
    nullable: bool
    description: str


class Measure(BaseModel):
    name: str
    logical_type: Literal["integer", "decimal"]
    additivity: Literal["additive", "semi_additive", "non_additive"]
    description: str


class Dimension(BaseModel):
    name: str
    description: str
    natural_key: str
    scd_type: Literal["type_1", "type_2"]
    attributes: list[Column]


class DimensionRef(BaseModel):
    role: str
    dimension: str


class Fact(BaseModel):
    name: str
    business_process: str
    fact_type: Literal["transaction", "periodic_snapshot", "accumulating_snapshot"]
    grain: str
    dimensions: list[DimensionRef]
    degenerate_dimensions: list[Column]
    measures: list[Measure]


class StarSchema(BaseModel):
    facts: list[Fact]
    dimensions: list[Dimension]
    open_questions: list[str]


SYSTEM_PROMPT = """You are a dimensional modeller following Kimball's four-step process.
For each business process, declare the grain as one sentence describing what a single row represents.
Use snake_case names. Prefix fact tables with fact_ and dimension tables with dim_.
Every dimension a fact references must match a dimension you define.
Give each reference a role, such as order_date or customer; use the dimension name without dim_ when it plays one role.
Do not put foreign key or surrogate key columns in attributes; they are generated later.
Mark balances, inventory levels and other point-in-time values as semi_additive.
List every assumption you made about the source systems in open_questions."""

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)

client = AzureOpenAI(
    azure_endpoint="https://<your-resource-name>.openai.azure.com/",
    azure_ad_token_provider=token_provider,
    api_version="2024-10-21",
)


def draft_star_schema(requirements: str) -> StarSchema:
    completion = client.beta.chat.completions.parse(
        model=os.environ.get("AZURE_OPENAI_DEPLOYMENT", "<your-gpt-4o-deployment>"),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": requirements},
        ],
        response_format=StarSchema,
        temperature=0.2,
    )
    message = completion.choices[0].message
    if message.refusal:
        raise RuntimeError(f"Model refused: {message.refusal}")
    return message.parsed
```

A few choices worth calling out. I authenticate with Microsoft Entra ID through `azure-identity` rather than an API key, because a design tool tends to end up on a shared VM or in a notebook and keys leak from both. The `parse` helper in the `openai` 1.x Python library turns the Pydantic model into the JSON Schema and hands you a typed object back, so there's no `json.loads` and no hand-written schema to keep in sync. Low temperature keeps reruns on the same requirements broadly similar, which matters when you want to diff two drafts.

If you haven't used schema enforcement before, I covered the general pattern in [JSON Schema enforcement in LLM applications](/blog/2024-09-14-json-schema-enforcement/).

## Check the draft with boring code

Structured outputs guarantees the shape, not the sense. A fact can still reference a dimension that doesn't exist, and a "transaction" fact can still carry a semi-additive balance. These checks are cheap, deterministic, and catch the mistakes I'd otherwise be pointing out in a review meeting.

```python
import re

SNAKE_CASE = re.compile(r"^[a-z][a-z0-9_]*$")


def validate(schema: StarSchema) -> list[str]:
    problems: list[str] = []
    dimension_names = {d.name for d in schema.dimensions}
    referenced: set[str] = set()

    for fact in schema.facts:
        if not fact.name.startswith("fact_"):
            problems.append(f"{fact.name}: fact tables should start with fact_")
        if len(fact.grain.split()) < 4:
            problems.append(f"{fact.name}: grain '{fact.grain}' is too vague to review")
        if not any("date" in ref.dimension for ref in fact.dimensions):
            problems.append(f"{fact.name}: no date dimension; check how this process is timed")
        roles = [ref.role for ref in fact.dimensions]
        if len(roles) != len(set(roles)):
            problems.append(f"{fact.name}: duplicate dimension roles; each reference needs its own role")
        for ref in fact.dimensions:
            referenced.add(ref.dimension)
            if ref.dimension not in dimension_names:
                problems.append(f"{fact.name}: references undefined dimension {ref.dimension}")
            if not SNAKE_CASE.match(ref.role):
                problems.append(f"{fact.name}.{ref.role}: role is not snake_case")
        for measure in fact.measures:
            if fact.fact_type == "transaction" and measure.additivity == "semi_additive":
                problems.append(
                    f"{fact.name}.{measure.name}: semi-additive measure on a transaction fact; "
                    "consider a periodic snapshot"
                )

    for dim in schema.dimensions:
        if not dim.name.startswith("dim_"):
            problems.append(f"{dim.name}: dimension tables should start with dim_")
        if dim.name not in referenced:
            problems.append(f"{dim.name}: not used by any fact")
        names = [a.name for a in dim.attributes]
        if len(names) != len(set(names)):
            problems.append(f"{dim.name}: duplicate attribute names")
        for name in names + [dim.natural_key]:
            if not SNAKE_CASE.match(name):
                problems.append(f"{dim.name}.{name}: not snake_case")

    return problems
```

You could ask the model to critique its own draft instead. I wouldn't, at least not as the only gate. A second LLM pass is non-deterministic and tends to agree with itself. Rules like "every fact needs a date dimension" are your team's standards, so encode them once in code and run them on every draft. Feed the failures back to the model as a follow-up message if you want it to repair them, but keep the check itself in Python.

## Generate DDL that Fabric Warehouse will accept

Most generic generators emit SQL Server DDL, and a Fabric Warehouse rejects a fair bit of it. As of January 2025, these are the differences that matter for a star schema:

- [Table constraints](https://learn.microsoft.com/en-us/fabric/data-warehouse/table-constraints) are informational only. `PRIMARY KEY` and `UNIQUE` must be `NONCLUSTERED` and `NOT ENFORCED`, `FOREIGN KEY` must be `NOT ENFORCED`, and you add them with `ALTER TABLE` after creating the table.
- [Data types](https://learn.microsoft.com/en-us/fabric/data-warehouse/data-types) are a subset of SQL Server's. There's no `nvarchar`, `datetime` or `money`, and `datetime2` precision tops out at 6.
- There are no `IDENTITY` columns, so surrogate keys come from your load process, not the table.

Because the keys aren't enforced, the warehouse won't stop duplicate surrogate keys or orphaned fact rows. Declaring them is still worthwhile because tools can read the relationships, but your pipeline owns integrity.

```python
TYPE_MAP = {
    "string": "VARCHAR(255)",
    "integer": "INT",
    "bigint": "BIGINT",
    "decimal": "DECIMAL(19, 4)",
    "date": "DATE",
    "datetime": "DATETIME2(6)",
    "boolean": "BIT",
}


def column_sql(col: Column) -> str:
    null = "NULL" if col.nullable else "NOT NULL"
    return f"{col.name} {TYPE_MAP[col.logical_type]} {null}"


def create_table(name: str, columns: list[str]) -> str:
    body = ",\n    ".join(columns)
    return f"CREATE TABLE dbo.{name} (\n    {body}\n);"


def generate_ddl(schema: StarSchema) -> str:
    statements: list[str] = []

    for dim in schema.dimensions:
        # The natural key is assumed to be a string; adjust if your source uses numeric IDs.
        columns = [f"{dim.name}_key BIGINT NOT NULL", f"{dim.natural_key} VARCHAR(100) NOT NULL"]
        columns += [column_sql(a) for a in dim.attributes if a.name != dim.natural_key]
        if dim.scd_type == "type_2":
            columns += [
                "valid_from DATETIME2(6) NOT NULL",
                "valid_to DATETIME2(6) NULL",
                "is_current BIT NOT NULL",
            ]
        statements.append(create_table(dim.name, columns))
        statements.append(
            f"ALTER TABLE dbo.{dim.name} ADD CONSTRAINT pk_{dim.name} "
            f"PRIMARY KEY NONCLUSTERED ({dim.name}_key) NOT ENFORCED;"
        )

    for fact in schema.facts:
        columns = [f"{ref.role}_key BIGINT NOT NULL" for ref in fact.dimensions]
        columns += [column_sql(c) for c in fact.degenerate_dimensions]
        columns += [f"{m.name} {TYPE_MAP[m.logical_type]} NULL" for m in fact.measures]
        grain = " ".join(fact.grain.split())  # keep the SQL comment on one line
        statements.append(f"-- Grain: {grain}\n" + create_table(fact.name, columns))
        for ref in fact.dimensions:
            statements.append(
                f"ALTER TABLE dbo.{fact.name} ADD CONSTRAINT fk_{fact.name}_{ref.role} "
                f"FOREIGN KEY ({ref.role}_key) REFERENCES dbo.{ref.dimension} "
                f"({ref.dimension}_key) NOT ENFORCED;"
            )

    return "\n\n".join(statements)


if __name__ == "__main__":
    requirements = Path("requirements.md").read_text(encoding="utf-8")
    draft = draft_star_schema(requirements)
    issues = validate(draft)
    for question in draft.open_questions:
        print(f"OPEN QUESTION: {question}")
    if issues:
        for issue in issues:
            print(f"FIX: {issue}")
    else:
        print(generate_ddl(draft))
```

Note that the generator is ordinary code, not a prompt. I don't let the model write DDL directly. The model's job ends at the logical design. Type mapping, naming, SCD columns and constraint syntax are platform rules, and they should come out the same every time. If you later target Azure SQL Database or Synapse dedicated SQL pools, you swap the generator, not the prompt. The grain comment above each fact table is deliberate: it puts the most important design decision where the next engineer will actually read it.

## When not to bother

This approach earns its keep at the start of a new subject area, when the requirements are long and nobody has a diagram yet. It's less useful, or actively unhelpful, in a few cases:

- **Extending a mature warehouse.** The hard part there is conforming to dimensions you already have. Unless you put the existing model into the prompt, the draft will reinvent `dim_customer` with different attributes.
- **Thin requirements.** If the input is three bullet points, the output is a textbook schema with your nouns in it. Do the workshop first.
- **Sensitive requirements documents.** Requirements often name systems, customers and data classifications. That's fine with an Azure OpenAI deployment inside your tenant and governance, and not fine in a consumer chat window.
- **Teams that will skip the review.** If the draft goes straight to DDL, you've automated the most expensive mistake in dimensional modelling: a wrong grain built into every downstream report.

## The takeaway

Treat the model as a fast junior modeller who has read every Kimball book and never seen your source systems. Constrain its output with structured outputs, hold it to your standards with plain code, keep platform-specific DDL in a generator you control, and spend the time you saved arguing about the grain. That conversation is still the job. Once the tables exist, the next layer up is the semantic model, which I covered in [semantic layers with AI](/blog/2025-01-19-semantic-layer-with-ai/).
