---
title: "LLM-Drafted Data Quality Rules: Let the Model Propose, Not Enforce"
description: "Use Azure OpenAI structured outputs to draft Great Expectations rules from a data profile, then backtest and review them before they ever gate a pipeline."
author: Michael John Peña
draft: false
date: 2025-01-22
tags:
  - Data Quality
  - Azure OpenAI
  - Great Expectations
  - Data Engineering
  - Python
---

Most data teams don't lack a validation framework. What they lack is rules. A new table lands, nobody has time to write the forty checks it deserves, and it goes to production with a null check on the primary key and nothing else. Large language models are good at the tedious part, reading a profile and suggesting what "normal" should look like. They are bad at the part that matters, deciding what's allowed to break a pipeline.

My position is simple: **the LLM drafts the rules, deterministic code enforces them, and a human signs off in between.** The model never sits in the hot path, never sees production rows it doesn't need, and never auto-fixes data. This post walks through a small pipeline that does exactly that with Azure OpenAI and Great Expectations (GX Core 1.x).

## Why not let the model validate the data directly?

I covered LLM-based validation back in [AI-Powered Data Quality](/blog/2023-04-23-ai-data-quality/), and the pattern still has a place for messy free-text columns. For structured tables, though, asking a model "is this row valid?" on every load has three problems:

- **It's not reproducible.** The same row can pass on Monday and fail on Tuesday. A data quality gate that isn't deterministic just creates arguments.
- **It's expensive and slow.** You pay tokens per batch, forever, for a judgement that a `BETWEEN` clause makes in microseconds.
- **It's hard to audit.** When a load fails, "the model thought it looked wrong" doesn't help the on-call engineer.

A rule set has none of those problems. Writing one is what's tedious, and that's the bit worth handing to a model. Once the rules are generated, they're plain Great Expectations expectations: versioned in Git, reviewed in a pull request, and run by an engine that gives the same answer every time.

## The pipeline

Four steps before enforcement, and only the second one calls a model:

1. **Profile** the table locally with pandas. Summaries only, no raw rows.
2. **Propose** rules with Azure OpenAI, constrained to a fixed schema.
3. **Compile and backtest** the proposals against a known-good sample using GX. Anything malformed or anything that fails on good data is flagged.
4. **Review** the generated suite in a pull request, then run it in the pipeline like any hand-written suite.

| Step | Who does it | Deterministic? | Touches raw data? |
|---|---|---|---|
| Profile | pandas | Yes | Yes, locally |
| Propose | LLM | No | Summaries only |
| Compile and backtest | GX Core | Yes | Yes, locally |
| Review | Data owner | n/a | No |
| Enforce | GX Core in the pipeline | Yes | Yes |

## Steps 1 and 2: profile, then propose with a constrained schema

The single most useful thing you can do is stop the model from inventing rule types. Azure OpenAI's [structured outputs](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/structured-outputs) feature constrains the response to a JSON schema you supply. It works with `gpt-4o` version `2024-08-06` and is supported in the GA API version `2024-10-21`. With the `openai` Python package (1.x), you pass a Pydantic model and get a parsed object back.

I keep the rule vocabulary deliberately small: five rule types that map one-to-one to GX expectations. If the model wants something else, it can't express it, which is the point.

```python
import json
import os
from typing import Literal, Optional

import pandas as pd
from openai import AzureOpenAI
from pydantic import BaseModel


class RuleProposal(BaseModel):
    column: str
    rule_type: Literal["not_null", "unique", "between", "in_set", "matches_regex"]
    min_value: Optional[float]
    max_value: Optional[float]
    allowed_values: Optional[list[str]]
    regex: Optional[str]
    mostly: float  # fraction of rows that must pass, 0.0-1.0
    rationale: str


class RuleSet(BaseModel):
    rules: list[RuleProposal]


def profile(df: pd.DataFrame, max_distinct: int = 20) -> dict:
    """Column-level summary. No raw rows leave the process."""
    out = {"row_count": int(len(df)), "columns": {}}
    for col in df.columns:
        s = df[col]
        info = {
            "dtype": str(s.dtype),
            "null_pct": round(float(s.isna().mean() * 100), 2),
            "distinct": int(s.nunique()),
        }
        if pd.api.types.is_numeric_dtype(s):
            q = s.quantile([0.0, 0.01, 0.5, 0.99, 1.0])
            info["quantiles"] = {str(k): float(v) for k, v in q.items()}
        elif s.nunique() <= max_distinct:
            info["values"] = sorted(map(str, s.dropna().unique()))
        else:
            lengths = s.dropna().astype(str).str.len()
            info["length_min_max"] = [int(lengths.min()), int(lengths.max())]
        out["columns"][col] = info
    return out


def propose_rules(client: AzureOpenAI, deployment: str, table: str,
                  business_context: str, prof: dict) -> RuleSet:
    completion = client.beta.chat.completions.parse(
        model=deployment,
        temperature=0,
        response_format=RuleSet,
        messages=[
            {"role": "system", "content": (
                "You propose data quality rules for a tabular dataset. "
                "Use only the column names given. Prefer few, high-value rules. "
                "Set mostly below 1.0 only when the profile shows legitimate exceptions. "
                "Leave fields that do not apply to a rule_type as null."
            )},
            {"role": "user", "content": (
                f"Table: {table}\nBusiness context: {business_context}\n"
                f"Profile:\n{json.dumps(prof, indent=2)}"
            )},
        ],
    )
    message = completion.choices[0].message
    if message.refusal:
        raise RuntimeError(f"Model refused: {message.refusal}")
    return message.parsed


if __name__ == "__main__":
    client = AzureOpenAI(
        azure_endpoint="https://<your-resource-name>.openai.azure.com",
        api_key=os.environ["AZURE_OPENAI_API_KEY"],
        api_version="2024-10-21",
    )
    orders = pd.read_csv("orders_sample.csv")
    rules = propose_rules(
        client,
        deployment="<your-gpt-4o-2024-08-06-deployment>",
        table="sales.orders",
        business_context="One row per customer order. Prices in AUD incl. GST.",
        prof=profile(orders),
    )
    with open("proposed_rules.json", "w") as f:
        f.write(rules.model_dump_json(indent=2))
```

Save this as `propose.py`. A few design choices are worth explaining.

**Every field is required but nullable.** Strict structured outputs require all properties to be listed as required. `Optional[...]` without a default gives you that: the model must emit `min_value`, but it can emit `null`.

**The profile is the prompt, not the data.** Quantiles, null rates and lengths tell the model almost everything it needs. The one leak is the `values` list for low-cardinality columns. That's usually fine for status codes, but check it before you point this at anything containing personal information. If the column is sensitive, drop it from the profile entirely. Azure OpenAI doesn't use your prompts to train models (see [data, privacy and security for Azure OpenAI](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy)), but data minimisation is still the right default.

**Business context does real work.** "Prices in AUD incl. GST" is the difference between the model proposing `total_aud >= 0` and proposing nothing for that column. One or two sentences from the data owner beat a page of column descriptions.

## Step 3: compile and backtest before anyone reviews

A schema-valid response can still be wrong. The model can reference a column that doesn't exist, produce a regex that won't compile, or propose an allowed-values set that forgets a legitimate status. So before a human looks at anything, the proposals are compiled into a GX Core [Expectation Suite](https://docs.greatexpectations.io/docs/core/define_expectations/organize_expectation_suites) and run against a sample you already trust.

Make that sample a held-out known-good window, such as a different month, not the same extract you profiled in Step 1. Backtest on the profiled data and every `between` rule taken from its minimum and maximum passes by construction, so over-tight thresholds sail through to review instead of failing here.

```python
import json
import re

import great_expectations as gx
import pandas as pd

from propose import RuleProposal, RuleSet


def to_expectation(rule: RuleProposal):
    common = {"column": rule.column, "mostly": rule.mostly}
    if rule.rule_type == "not_null":
        return gx.expectations.ExpectColumnValuesToNotBeNull(**common)
    if rule.rule_type == "unique":
        return gx.expectations.ExpectColumnValuesToBeUnique(**common)
    if rule.rule_type == "between":
        if rule.min_value is None and rule.max_value is None:
            raise ValueError("between rule needs min_value or max_value")
        return gx.expectations.ExpectColumnValuesToBeBetween(
            min_value=rule.min_value, max_value=rule.max_value, **common)
    if rule.rule_type == "in_set":
        if not rule.allowed_values:
            raise ValueError("in_set rule needs allowed_values")
        return gx.expectations.ExpectColumnValuesToBeInSet(
            value_set=rule.allowed_values, **common)
    if rule.rule_type == "matches_regex":
        re.compile(rule.regex or "")  # raises re.error on a bad pattern
        return gx.expectations.ExpectColumnValuesToMatchRegex(
            regex=rule.regex, **common)
    raise ValueError(f"Unsupported rule_type {rule.rule_type}")


def build_suite(rules: RuleSet, df: pd.DataFrame, name: str):
    suite = gx.ExpectationSuite(name=name)
    rejected = []
    for rule in rules.rules:
        if rule.column not in df.columns:
            rejected.append((rule, "unknown column"))
        elif not 0.0 < rule.mostly <= 1.0:
            rejected.append((rule, "mostly out of range"))
        else:
            try:
                suite.add_expectation(to_expectation(rule))
            # GX raises pydantic.v1 ValidationError, a ValueError subclass
            except (ValueError, re.error) as exc:
                rejected.append((rule, str(exc)))
    return suite, rejected


if __name__ == "__main__":
    context = gx.get_context(mode="ephemeral")
    known_good = pd.read_csv("orders_known_good.csv")
    with open("proposed_rules.json") as f:
        rules = RuleSet.model_validate_json(f.read())

    suite, rejected = build_suite(rules, known_good, "sales_orders_proposed")
    for rule, reason in rejected:
        print(f"REJECTED {rule.rule_type} on {rule.column}: {reason}")

    batch = (
        context.data_sources.add_pandas("backtest")
        .add_dataframe_asset(name="orders_known_good")
        .add_batch_definition_whole_dataframe("all_rows")
        .get_batch(batch_parameters={"dataframe": known_good})
    )
    result = batch.validate(suite)
    for r in result.results:
        cfg = r.expectation_config
        status = "ok" if r.success else "FAILS ON KNOWN-GOOD DATA"
        print(f"{status:26} {cfg.type} {cfg.kwargs.get('column')} "
              f"unexpected%={r.result.get('unexpected_percent')}")

    with open("sales_orders_suite.json", "w") as f:
        json.dump(suite.to_json_dict(), f, indent=2)
```

This targets the GX Core 1.x API (1.3 was current at the time of writing), which replaced the 0.x `expectation_type` dictionaries and validators with expectation classes and batch definitions. If you're still on 0.18, the idea carries over but every line of the GX code changes; the [GX migration guide](https://docs.greatexpectations.io/docs/reference/learn/migration_guide) covers the changes.

Two details matter here. First, `gx.get_context()` has to run before you add expectations to a suite, because GX 1.x stores suites through the active data context; that is why the `__main__` block creates the context first. Second, the `except` clause is narrow on purpose. A broad `except Exception` would quietly swallow a real configuration bug and report every rule as "rejected", which looks like a model problem when it's actually yours.

The backtest is the step I'd never skip. A rule that fails on data you already trust is either wrong or encodes something the business hasn't told you. Picture a proposed `status IN ('shipped', 'pending')` rule backtested against a sample where one order in five is cancelled: it fails on 20% of known-good rows, and the output tells you so before the rule goes anywhere near production. That's exactly the type of mistake a model makes from a profile, and exactly the type a backtest catches before it blocks a production load.

## Step 4: review like code, enforce like code

The output is a plain JSON Expectation Suite. Commit it next to the pipeline, open a pull request, and make the data owner the reviewer. Include the `rationale` field from each proposal in the PR description so the reviewer sees *why* a rule exists, not just what it checks. Once merged, the suite runs in the pipeline the same way a hand-written one would. The saved JSON has `"id": null`, so the pipeline rehydrates it into its own context, then attaches it to a validation definition and a Checkpoint. This fragment assumes `context` is your pipeline's data context and `batch_definition` points at the production table:

```python
import json

import great_expectations as gx

with open("sales_orders_suite.json") as f:
    suite = context.suites.add(gx.ExpectationSuite(**json.load(f)))

validation = context.validation_definitions.add(
    gx.ValidationDefinition(name="sales_orders_gate", data=batch_definition, suite=suite))
checkpoint = context.checkpoints.add(
    gx.Checkpoint(name="sales_orders_checkpoint", validation_definitions=[validation]))
result = checkpoint.run()
```

(For a dataframe asset, pass `batch_parameters={"dataframe": df}` to `run()`.) Fail the load when `result.success` is false, or wire the Checkpoint into whatever orchestration you already use.

What I'd ask reviewers to look at:

- **Thresholds hugging the sample.** A `between` rule built from the 0th and 100th percentile of last month's data will fail the first time the business has a good month. Widen it or drop it.
- **`mostly` values that hide problems.** A not-null rule with `mostly=0.98` might be legitimate (guest checkouts with no customer ID) or might be papering over a bug upstream. Only the data owner knows.
- **Missing rules.** The model only sees one table. It won't propose referential integrity, freshness, or row-count expectations across loads unless you give it that context, so add those by hand.

## Where this approach doesn't fit

- **You already have a governed rules catalogue.** If your organisation uses Microsoft Purview's [data quality](https://learn.microsoft.com/en-us/purview/unified-catalog-data-quality) capabilities (in preview at the time of writing) or Delta Live Tables [expectations](/blog/2022-03-22-dlt-expectations-quality/), keep the rules in that system. A side channel of LLM-generated GX suites just splits ownership.
- **The table is tiny or stable.** Ten columns that haven't changed in three years don't need a model. Write the five rules by hand in fifteen minutes.
- **You want auto-remediation.** I'd stay away from letting a model rewrite values in place. "Standardise these addresses" sounds harmless until it silently merges two customers. Quarantine bad rows, and fix them through a reviewed change, not a prompt.
- **The profile itself is sensitive.** Even summaries can identify people in small populations. If you can't send the profile to an external endpoint under your data policies, this pipeline isn't for that table.

## The takeaway

Treat the LLM as a junior analyst who's fast, tireless, and occasionally confidently wrong. Give it a narrow vocabulary, feed it summaries rather than rows, check its work automatically against data you trust, and make a human accountable for what ships. You get most of the coverage benefit of "AI-driven data quality" while the thing that actually blocks a pipeline stays boring, deterministic, and explainable. For the habits that make any rule set stick, the older [Data Quality Practices](/blog/2021-12-25-data-quality-practices/) post still applies.
