---
title: "LLM-Drafted Tests for PySpark: The Model Writes, pytest Judges"
description: "Use Azure OpenAI structured outputs to draft edge-case test data for PySpark transforms, review it like code, and let pytest and assertDataFrameEqual decide."
author: Michael John Peña
draft: false
date: 2025-01-23
tags:
  - Testing
  - PySpark
  - Azure OpenAI
  - Data Engineering
  - Python
---

Most data pipelines are tested in production: a dashboard looks wrong, someone traces it back to a transform, and the fix ships without a test. The reason is rarely laziness. Writing good test data for a PySpark transform is tedious, and thinking of the nasty cases (the null in the join key, the trailing space, the date that parses in one format but not another) takes more attention than the transform itself. LLMs are good at that enumeration and bad at deciding whether your pipeline is correct. The design question is how to use the first strength without trusting the second.

## Where an LLM helps, and where it doesn't

I see three common ways teams put an LLM into pipeline testing:

| Approach | What the model does | My view |
|---|---|---|
| Generate pytest code | Writes whole test files from the function source | Useful for a first pass, but reviewers skim generated code and miss weak assertions |
| Generate test cases as data | Proposes input rows and expected output rows in a fixed schema | The sweet spot: reviewable, diffable, deterministic once committed |
| LLM as runtime validator | Looks at a sample of output and says whether it "looks right" | Avoid. It is non-deterministic, sees a sample, costs tokens on every run and produces opinions, not evidence |

The third pattern shows up in a lot of demos and I'd keep it out of a pipeline. A test that passes on Tuesday and fails on Wednesday with the same data is worse than no test, because people learn to ignore it. Runtime checks on production data should be deterministic rules: schema, nullability, ranges, row counts, freshness. I covered where AI can help with those rules in [the previous post on data quality automation](/blog/2025-01-22-data-quality-automation-ai/), and the same principle applies here: the model proposes, something deterministic decides.

So this post builds the second approach. The model drafts test cases as structured data, an engineer reviews and commits them, and pytest runs them against the real transform on every change. It is the same loop I used for [generating dbt models](/blog/2025-01-21-dbt-with-ai-code-generation/), applied to PySpark.

## The transform under test

Here is a small but realistic cleaning step. It is deliberately the kind of function nobody writes tests for because it "obviously works".

```python
# my_pipeline/transformations.py
from pyspark.sql import DataFrame
from pyspark.sql import functions as F

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


def clean_customers(df: DataFrame) -> DataFrame:
    """Trim and title-case names, drop rows without a name, normalise emails,
    parse signup dates and floor lifetime value at zero."""
    return (
        df.withColumn("name", F.initcap(F.trim(F.col("name"))))
        .filter(F.col("name").isNotNull() & (F.col("name") != ""))
        .withColumn("email", F.lower(F.trim(F.col("email"))))
        .withColumn(
            "email_valid",
            F.coalesce(F.col("email").rlike(EMAIL_PATTERN), F.lit(False)),
        )
        .withColumn("signup_date", F.to_date(F.col("signup_date"), "yyyy-MM-dd"))
        .withColumn("lifetime_value", F.greatest(F.col("lifetime_value"), F.lit(0.0)))
    )
```

There are at least three decisions hiding in there that a good test should surface. `F.greatest` skips nulls, so a null `lifetime_value` becomes `0.0`, not null. Is that the business rule, or an accident? `initcap` turns `o'brien` into `O'brien` and `McDonald` into `Mcdonald`. And `to_date` does not simply return null for a bad date. Since Spark 3.0, with the default `spark.sql.legacy.timeParserPolicy` of `EXCEPTION`, a string the old parser would have accepted but the new one rejects, such as `2024-1-5`, raises a `SparkUpgradeException` and fails the whole job, while `2024-02-30` quietly becomes null. Whether a malformed date should kill the load or become null depends on a session setting the function never mentions, which makes it the most dangerous hidden decision of the three. None of these is a bug in Spark. They are questions for whoever owns the customer data, and they only get asked if someone writes the case down.

## Drafting cases with structured outputs

The generator asks Azure OpenAI for test cases in a fixed shape. [Structured outputs](https://learn.microsoft.com/azure/ai-services/openai/how-to/structured-outputs) constrain the response to a JSON schema, so there is no parsing of code fences or apologetic prose. As of January 2025 the feature is in the `2024-10-21` GA API version with a `gpt-4o` version `2024-08-06` deployment, and the `openai` Python library (1.x) converts a Pydantic model into the schema and parses the response back. I covered the feature itself in [an earlier post](/blog/2024-09-13-structured-outputs-openai/).

Strict schemas need every field to be required, so optional values are expressed as `X | None` rather than defaults. To run the examples, install `pip install "pyspark[pandas_on_spark]==3.5.*" pytest openai pydantic`; the `pandas_on_spark` extra matters because `pyspark.testing` imports pandas and PyArrow, and a plain `pip install pyspark` fails with `ImportError: Pandas >= 1.0.5 must be installed` when the harness loads.

```python
# tools/draft_cases.py
import inspect
import json
import os
import sys
from pathlib import Path

from openai import AzureOpenAI
from pydantic import BaseModel

from my_pipeline.transformations import clean_customers


class CustomerIn(BaseModel):
    id: int
    name: str | None
    email: str | None
    signup_date: str | None  # raw string as it arrives from the source
    lifetime_value: float | None


class CustomerOut(BaseModel):
    id: int
    name: str
    email: str | None
    signup_date: str | None  # yyyy-MM-dd, or null when the date doesn't parse
    # (assumes timeParserPolicy=CORRECTED; under the default EXCEPTION, inputs
    # like "2024-1-5" raise instead of returning null)
    lifetime_value: float | None
    email_valid: bool


class TestCase(BaseModel):
    case_id: str  # snake_case, unique
    description: str
    input_rows: list[CustomerIn]
    expected_rows: list[CustomerOut]
    question_for_reviewer: str | None  # set when the right answer is a business decision


class TestCaseSet(BaseModel):
    cases: list[TestCase]


SYSTEM_PROMPT = """You write test cases for PySpark 3.5 transformations.
Rules:
- Read the module source carefully and predict the function's actual output.
- Assume spark.sql.legacy.timeParserPolicy=CORRECTED: unparseable dates
  become null rather than raising.
- Cover nulls in every nullable column, empty and whitespace-only strings,
  mixed case, apostrophes and hyphens in names, non-ASCII characters,
  invalid and boundary dates, negative, zero and very large numbers.
- Keep each case to 1-4 input rows so a reviewer can check it by eye.
- If the code's behaviour may not match what a business owner would want,
  still predict what the code does, and explain the doubt in
  question_for_reviewer.
- Produce 10 to 15 cases."""

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],  # https://<your-resource-name>.openai.azure.com
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2024-10-21",
)


def draft_cases(output_path: Path) -> None:
    # Send the whole module, not just the function: constants such as
    # EMAIL_PATTERN live outside clean_customers and decide email_valid.
    source = inspect.getsource(sys.modules[clean_customers.__module__])
    completion = client.beta.chat.completions.parse(
        model="<your-gpt-4o-deployment>",  # a gpt-4o 2024-08-06 deployment
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Write test cases for clean_customers in this module:\n\n{source}",
            },
        ],
        response_format=TestCaseSet,
        temperature=0,
    )
    result = completion.choices[0].message.parsed
    if result is None:
        raise RuntimeError(f"Model refused: {completion.choices[0].message.refusal}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(result.model_dump(), indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"Wrote {len(result.cases)} draft cases to {output_path}")


if __name__ == "__main__":
    draft_cases(Path("tests/cases/clean_customers.draft.json"))
```

Run it from the repository root as `python -m tools.draft_cases` (with an empty `tools/__init__.py`), or install the pipeline with `pip install -e .`; running `python tools/draft_cases.py` puts `tools/` rather than the root on `sys.path` and fails with `No module named 'my_pipeline'`. The generator sends the whole module rather than `inspect.getsource(clean_customers)`, because the function's source names `EMAIL_PATTERN` without its value, and a model that has to guess the regex cannot predict `email_valid`.

Two choices matter more than the prompt wording.

First, the output is **data, not code**. A JSON file of input and expected rows is something a reviewer can read in a pull request diff, and something a data owner who doesn't write Python can still check. Generated pytest files tend to contain assertions like `assert result.count() > 0`, which pass for almost any bug.

Second, the `question_for_reviewer` field gives the model an honest place to flag business ambiguity instead of quietly picking an answer. The null lifetime value above is exactly the kind of case where I want a question, not a guess.

The file is written as `.draft.json`. The test harness ignores drafts. A person renames it to `.json` after review, and that rename is the sign-off.

## The harness: hand-written, small and boring

The harness is the one part I would never generate. It is short, it rarely changes, and everything depends on it being right. It loads every reviewed case file, builds Spark DataFrames with explicit schemas and compares them with `assertDataFrameEqual` from [`pyspark.testing`](https://spark.apache.org/docs/3.5.0/api/python/reference/api/pyspark.testing.assertDataFrameEqual.html), which arrived in PySpark 3.5.0. Row order is ignored by default, and floats are compared with a relative tolerance.

```python
# tests/test_clean_customers.py
import json
from pathlib import Path

import pytest
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.testing import assertDataFrameEqual

from my_pipeline.transformations import clean_customers

CASE_DIR = Path(__file__).parent / "cases"
INPUT_SCHEMA = "id BIGINT, name STRING, email STRING, signup_date STRING, lifetime_value DOUBLE"
EXPECTED_SCHEMA = (
    "id BIGINT, name STRING, email STRING, signup_date STRING, "
    "lifetime_value DOUBLE, email_valid BOOLEAN"
)


def load_cases():
    cases = []
    for path in sorted(CASE_DIR.glob("*.json")):
        if path.name.endswith(".draft.json"):
            continue  # unreviewed drafts never run in CI
        for case in json.loads(path.read_text(encoding="utf-8"))["cases"]:
            cases.append(pytest.param(case, id=f"{path.stem}:{case['case_id']}"))
    return cases


@pytest.fixture(scope="session")
def spark():
    session = (
        SparkSession.builder.master("local[1]")
        .appName("pipeline-tests")
        .config("spark.sql.shuffle.partitions", "1")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.legacy.timeParserPolicy", "CORRECTED")
        .getOrCreate()
    )
    yield session
    session.stop()


def to_rows(records, columns):
    return [tuple(r[c] for c in columns) for r in records]


@pytest.mark.parametrize("case", load_cases())
def test_clean_customers(spark, case):
    input_cols = ["id", "name", "email", "signup_date", "lifetime_value"]
    expected_cols = input_cols + ["email_valid"]

    source = spark.createDataFrame(to_rows(case["input_rows"], input_cols), INPUT_SCHEMA)
    expected = spark.createDataFrame(
        to_rows(case["expected_rows"], expected_cols), EXPECTED_SCHEMA
    ).withColumn("signup_date", F.to_date("signup_date", "yyyy-MM-dd"))

    assertDataFrameEqual(clean_customers(source), expected)
```

Add `pythonpath = ["."]` under `[tool.pytest.ini_options]` in `pyproject.toml` (pytest 7 and later) so `my_pipeline` imports when you run `pytest` from the root.

A few details are there on purpose. Setting `timeParserPolicy` to `CORRECTED` makes `to_date` return null for any string the new parser rejects, which is the behaviour the cases describe. A test session is only honest if the deployed job runs with the same setting, so set it in the job's Spark configuration too rather than relying on whatever default the runtime ships with. If your team would rather a malformed date fail the load, keep `EXCEPTION` everywhere and write cases that expect the error instead. Explicit DDL schemas stop Spark from inferring `id` as a long in one test and an int in another, which produces confusing schema mismatches. One shuffle partition and a single local core keep the suite fast on a laptop or a CI agent. Pinning the session time zone does nothing for this date-only transform, but it saves you the day someone adds a timestamp column and the tests pass in Sydney and fail on a build agent running in UTC. Keep your local PySpark version aligned with the runtime you deploy to, for example Fabric Runtime 1.3, which is built on [Spark 3.5](https://learn.microsoft.com/fabric/data-engineering/lifecycle), so a test that passes locally means the same thing in the workspace.

## Reviewing what the model got wrong

The model's expected rows are predictions. Some will be wrong, and that is useful, because every failing case lands in one of three buckets:

1. **The model misread the code.** For example, it expects a null `lifetime_value` to stay null, but `greatest` returns `0.0`. Or it expects `2024-1-5` to parse, when under `CORRECTED` the strict `yyyy-MM-dd` pattern returns null (and under the default `EXCEPTION` policy the run would have crashed instead). Fix the expectation and move on.
2. **The code does something nobody intended.** Same example, but the data owner says null means "unknown" and must stay null. Now you have found a real bug before production did. Fix the transform and keep the case.
3. **The rule was never decided.** `Mcdonald` versus `McDonald` usually falls here. Write the decision down, encode it in the case, and accept that the test now documents a business rule.

This is why I don't let the model "repair" failing tests automatically. A loop that edits expectations until everything passes turns category 2 into category 1 and hides the bug. The review step is the point of the exercise, not overhead.

The same rule applies when the transform changes. Committed cases are the regression baseline, so never regenerate the reviewed file wholesale; draft only new cases for the changed behaviour into a fresh `.draft.json`, and edit an old case by hand only when the change is intended and the data owner agrees. Behaviour that should raise, such as choosing `EXCEPTION` for malformed dates, doesn't fit rows-in, rows-out cases; write those few tests by hand with `pytest.raises` around a `collect()`, because Spark evaluates lazily and nothing fails until an action runs.

Reviewing 15 small cases takes me far less time than inventing them, and the model reliably proposes cases I would skip on a busy day: whitespace-only names, Unicode in email local parts, `2024-02-30`, an empty input DataFrame.

## Beyond unit tests

The same pattern stretches, with limits.

- **Integration tests.** For a chain of transforms, the model can draft a small set of source rows that exercise each join and the expected final output. Keep these few and hand-checked; a wrong expectation across three joins is hard to spot in review.
- **Synthetic volume data.** Don't ask an LLM for 100,000 rows. It is slow, expensive and the output drifts. Use a seeded generator such as Faker or plain Python for volume, and reserve the model for the dozen awkward rows that matter.
- **Production checks.** Keep these deterministic. Schema, null, range and volume rules belong in the pipeline itself, whether that is Delta Live Tables expectations, Great Expectations or plain PySpark assertions.

## When not to bother

Skip the generator for transforms that are a single `select` with renames; a hand-written case is quicker than a prompt. Be careful with transforms that encode contested business logic such as revenue recognition, because confident-looking expected rows anchor the discussion before the business has agreed on the rule. And never send real customer rows to the model to "inspire" cases. The function source is enough, and it keeps personal data out of prompts.

## The takeaway

Use the LLM for what it is good at: enumerating edge cases faster and more thoroughly than a tired engineer. Have it produce test data in a strict schema rather than test code, review that data like any other change, and let a small hand-written pytest harness with `assertDataFrameEqual` be the judge. The tests that matter most will be the ones where the model and the code disagree, because those are the conversations your pipeline needed to have anyway.
