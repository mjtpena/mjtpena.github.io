---
title: "Generating dbt Models with Azure OpenAI: Let dbt Be the Judge"
description: "Use Azure OpenAI structured outputs to draft dbt models and YAML, then gate every draft with dbt build so nothing untested reaches review."
author: Michael John Peña
draft: false
date: 2025-01-21
tags:
  - dbt
  - Azure OpenAI
  - Data Engineering
  - Data Transformation
  - LLM
---

Most "AI for dbt" demos stop at the moment the model prints some SQL. That is the easy part. The hard part is knowing whether the SQL compiles, whether the grain is what you asked for, and whether the tests it proposes would actually catch a broken join. An LLM is a fast drafter and a poor judge of its own work, so the useful pattern is to let the model draft and let dbt decide.

The loop: Azure OpenAI drafts a model and its YAML in a fixed shape, the files land on a feature branch, and `dbt build` compiles, runs and tests the result before a human ever looks at it.

## What already exists, and why I'd still build this

If you are on dbt Cloud Enterprise, look at [dbt Copilot](https://www.getdbt.com/blog/coalesce-2024-product-announcements) first. dbt Labs announced it at Coalesce in October 2024 (it grew out of the earlier dbt Assist), and as of January 2025 it is in beta inside the dbt Cloud IDE, generating documentation, data tests and semantic models for existing models. dbt Labs manages the LLM connection, so there is no prompt plumbing on your side.

There are still good reasons to run your own loop:

- You run dbt Core, or you are not on the Enterprise tier.
- Your data governance rules say prompts containing schema and business logic must go to your own Azure OpenAI resource, in your region, under your content filtering and logging. Be clear about what leaves your tenant: table and column names, the requirement text and, on a retry, dbt's error output.
- You want generation in a batch job or pull request pipeline, not only in an IDE.
- You want the generator to know your conventions: your staging layer naming, your surrogate key macro, your preferred incremental strategy.

If none of those apply, use the product and skip the rest of this post.

## The shape of the loop

| Step | Who does it | What can go wrong |
|---|---|---|
| Describe the requirement and the upstream models | Engineer | Vague grain ("sales by product") |
| Draft SQL and YAML in a fixed schema | Azure OpenAI | Invented columns, wrong joins |
| Write files to `models/` on a feature branch | Script | Clobbering an existing model |
| `dbt build --select <model>` against a dev target | dbt | Compile errors, failing tests |
| Feed the failure back once, then stop | Script and model | Endless retry loops |
| Pull request review | Engineer | Rubber-stamping |

The important design choice is in row four. dbt already knows how to tell you that a `ref()` points at nothing, that a column doesn't exist, or that a key you claimed was unique has duplicates. Re-implementing that check as a second LLM call ("review this SQL and score it out of 10") gives you an opinion, not evidence. I'd rather spend the tokens on a better first draft and let the warehouse answer the factual questions.

## Structured outputs instead of "return JSON please"

The common failure in hand-rolled generators is parsing. You ask for JSON, the model wraps it in a code fence or adds a sentence, and `json.loads` throws. Azure OpenAI's [structured outputs](https://learn.microsoft.com/azure/ai-services/openai/how-to/structured-outputs) fix this by constraining the response to a JSON schema. It was added in API version `2024-08-01-preview` and is in the `2024-10-21` GA API, with `gpt-4o` version `2024-08-06` as the model to deploy. I covered the feature itself in [an earlier post](/blog/2024-09-13-structured-outputs-openai/).

Structured outputs need every field to be required and don't accept default values, so the Pydantic model below is deliberately plain. The `openai` Python library (1.x) converts it to a schema and parses the response back for you.

```python
# dbt_draft.py
import os

from openai import AzureOpenAI
from pydantic import BaseModel


class ColumnDoc(BaseModel):
    name: str
    description: str
    data_tests: list[str]  # only "not_null" or "unique"


class DbtModelDraft(BaseModel):
    model_name: str
    layer: str  # "staging", "intermediate" or "marts"
    grain: str  # one sentence: what one row represents
    sql: str
    model_description: str
    columns: list[ColumnDoc]
    assumptions: list[str]  # things the reviewer must confirm


SYSTEM_PROMPT = """You write dbt models for a project on dbt Core 1.9.
Rules:
- Select only from the upstream models listed by the user, using ref().
- Use only columns that appear in the upstream column lists.
- Use CTEs, lower-case SQL, and the prefixes stg_, int_, fct_, dim_.
- Generate surrogate keys with dbt_utils.generate_surrogate_key.
- Use only not_null and unique in data_tests.
- State the grain in one sentence. Every column that makes up the grain
  gets not_null; the surrogate key gets unique and not_null.
- Put anything you had to guess in assumptions. Do not invent columns."""

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],  # https://<your-resource-name>.openai.azure.com
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2024-10-21",
)


def draft_model(requirement: str, upstream: str, feedback: str = "") -> DbtModelDraft:
    user_content = f"Requirement:\n{requirement}\n\nUpstream models and columns:\n{upstream}"
    if feedback:
        user_content += f"\n\nYour previous draft failed dbt build with:\n{feedback}\nFix it."

    completion = client.beta.chat.completions.parse(
        model="<your-gpt-4o-deployment>",  # a gpt-4o 2024-08-06 deployment
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        response_format=DbtModelDraft,
        temperature=0,
    )
    draft = completion.choices[0].message.parsed
    if draft is None:
        raise RuntimeError(f"Model refused: {completion.choices[0].message.refusal}")
    return draft
```

Two prompt rules do most of the work. "Use only columns that appear in the upstream column lists" cuts down invented columns, and the `assumptions` field gives the model somewhere honest to put guesses instead of burying them in the SQL. The grain sentence matters more than it looks: if the model can't state the grain clearly, the requirement was ambiguous, and no amount of retrying will fix that.

For the `upstream` text, don't hand-type column lists. Pull them from `target/catalog.json` after `dbt docs generate`, which records the columns the warehouse actually has. `manifest.json` only knows the columns you documented in YAML.

The surrogate key rule assumes `dbt_utils` is already in your `packages.yml` and installed with `dbt deps`; otherwise the very first build fails on an undefined macro. The data test rule is a scope decision too. A `list[str]` can't carry the arguments that `accepted_values` or `relationships` need, and a bare `accepted_values` fails `dbt build` with an error that wastes the one retry, so parameterised tests stay with the human reviewer.

## Writing files without trusting the model

The model chooses the file name, so treat it as untrusted input. Restrict the layer to known folders, refuse to overwrite existing files, and write YAML with a YAML library rather than string concatenation. Since dbt 1.8 the column-level key is `data_tests:`. The old `tests:` key is still accepted for backward compatibility (1.8 warned about it; 1.9 renames it silently), so generate the new spelling.

```python
# write_draft.py
import re
from pathlib import Path

import yaml

from dbt_draft import DbtModelDraft

ALLOWED_LAYERS = {"staging", "intermediate", "marts"}
NAME_PATTERN = re.compile(r"^(stg|int|fct|dim)_[a-z0-9_]+$")


def write_draft(draft: DbtModelDraft, project_dir: Path) -> Path:
    if draft.layer not in ALLOWED_LAYERS:
        raise ValueError(f"Unexpected layer: {draft.layer}")
    if not NAME_PATTERN.match(draft.model_name):
        raise ValueError(f"Model name breaks conventions: {draft.model_name}")

    folder = project_dir / "models" / draft.layer
    folder.mkdir(parents=True, exist_ok=True)
    sql_path = folder / f"{draft.model_name}.sql"
    yml_path = folder / f"_{draft.model_name}.yml"
    if sql_path.exists() or yml_path.exists():
        raise FileExistsError(f"{draft.model_name} already exists; refusing to overwrite")

    header = f"-- grain: {draft.grain}\n-- drafted by Azure OpenAI; review assumptions in the PR\n\n"
    sql_path.write_text(header + draft.sql.strip() + "\n", encoding="utf-8")

    properties = {
        "version": 2,
        "models": [{
            "name": draft.model_name,
            "description": draft.model_description,
            "columns": [
                {"name": c.name, "description": c.description, "data_tests": c.data_tests}
                for c in draft.columns
            ],
        }],
    }
    yml_path.write_text(yaml.safe_dump(properties, sort_keys=False), encoding="utf-8")
    return sql_path
```

One properties file per model avoids the classic problem of a generator appending to a shared `schema.yml` and corrupting it. It also makes the pull request diff easy to read.

## Let dbt be the judge

dbt Core has had a supported Python entry point, `dbtRunner`, since 1.5, so there is no need to shell out and scrape stdout. `dbt build --select <model>` compiles the model, runs it and then runs its data tests, which is exactly the evidence we want. Point it at a dev target with a sample of data; you do not want a generator materialising tables in production. Make that dev schema disposable, ideally one per run that you drop afterwards: the repair step below deletes the failed draft's files, but the table or view it built stays in the schema, and if the retry picks a different model name it is left orphaned.

```python
# generate.py
from pathlib import Path

from dbt.cli.main import dbtRunner

from dbt_draft import draft_model
from write_draft import write_draft

PROJECT_DIR = Path("<path-to-your-dbt-project>")


def build(model_name: str) -> tuple[bool, str]:
    res = dbtRunner().invoke([
        "build", "--select", model_name,
        "--project-dir", str(PROJECT_DIR), "--target", "dev",
    ])
    if res.exception is not None:
        return False, str(res.exception)
    failures = [
        f"{r.node.name}: {r.status} {r.message or ''}"
        for r in res.result
        if str(r.status) in ("error", "fail")
    ]
    return res.success, "\n".join(failures)


def generate(requirement: str, upstream: str) -> None:
    draft = draft_model(requirement, upstream)
    sql_path = write_draft(draft, PROJECT_DIR)
    ok, feedback = build(draft.model_name)

    if not ok:
        # One repair attempt only. A second failure means the requirement needs a human.
        # The failed draft's relation stays in the dev schema; drop that schema after the run.
        sql_path.unlink()
        sql_path.with_name(f"_{draft.model_name}.yml").unlink()
        draft = draft_model(requirement, upstream, feedback)
        sql_path = write_draft(draft, PROJECT_DIR)
        ok, feedback = build(draft.model_name)

    print(f"{draft.model_name}: {'passed' if ok else 'FAILED'} dbt build")
    print("Assumptions to confirm in review:")
    for item in draft.assumptions:
        print(f"  - {item}")
    if not ok:
        print(feedback)
```

The single retry is deliberate. Compile and database errors, such as a bad `ref()` or a misspelled column, come back with a precise dbt message, and in my experience those are the ones worth one retry. A failing `unique` test is different: it usually means the grain is wrong or an upstream join fans out, and a model that keeps retrying will "fix" it by adding `distinct`, which hides the bug. Stop, and give the engineer the failure plus the assumptions list.

## Where this goes wrong

Passing `dbt build` proves the SQL runs and the generated tests pass. It does not prove the tests are the right ones, and the model wrote both. A few failure modes to watch:

- **Self-graded tests.** If the model gets the grain wrong, it will put `unique` on the wrong key and the test will pass. Reviewers should check the grain comment and the key tests before reading anything else.
- **Left joins that should be inner joins**, or the reverse. Row counts against the upstream model are the cheapest check; a [dbt unit test](https://docs.getdbt.com/docs/build/unit-tests) (new in 1.8) on a handful of hand-written rows is the strongest.
- **Incremental logic.** Generated `is_incremental()` filters are often subtly wrong around late-arriving data. For new models I'd have the generator default to `table` and let a human decide when a model earns incremental materialisation. If you are on 1.9 and want incremental, the new `microbatch` strategy is easier to review than a hand-written filter.
- **Data in the feedback.** dbt error messages can quote values from your warehouse, such as a value that failed a cast. Trim or redact the feedback before it goes back into the prompt, especially when the dev target holds real customer data.
- **Metric definitions.** "Revenue" means something specific in your business. The model will pick a plausible column. Put metric definitions in the prompt or keep metric models out of scope.

## When not to bother

Don't build this for a project with a dozen models; the prompt engineering will cost more than writing the SQL. Don't use it for marts that encode contested business rules, because the draft will look authoritative and anchor the discussion. And don't skip the dev target: a generator that can `dbt build` against production is a generator that can overwrite a production table.

Where it does pay off is the repetitive middle of a dbt project: staging models over dozens of source tables, documentation for columns nobody described, and baseline `not_null` and `unique` tests on keys. That work follows conventions, dbt can verify it, and a reviewer can check it in minutes.

## The decision

Use dbt Copilot if you are on dbt Cloud Enterprise and are comfortable with its beta status and with dbt Labs managing the LLM connection. Build your own loop when you need your own Azure OpenAI resource, dbt Core, or pipeline automation. Either way, keep the rule that makes it safe: the model drafts, dbt judges, and a person who understands the business signs off on the grain.
