---
title: "Leakage-Safe Feature Engineering with scikit-learn Pipelines"
description: "Most feature engineering bugs are statistics fitted on the wrong rows. How I keep scaling, encoding and aggregates leak-free with scikit-learn pipelines."
author: Michael John Peña
draft: false
date: 2024-01-31
tags:
  - Feature Engineering
  - Machine Learning
  - Data Science
  - MLOps
  - Azure ML
---

The feature engineering failures that hurt in production are rarely a missing clever feature. They are ordinary transforms (a scaler, a frequency map, a customer average) fitted on rows the model should never have seen, so offline metrics look great and live performance quietly drops. The fix is less about knowing more transforms and more about controlling *where* each statistic is learned.

I've written before about [feature engineering practices for production ML](/blog/2021-12-09-feature-engineering-best-practices/) in general terms. This post is narrower: how to make the common patterns leak-proof with scikit-learn pipelines, as of scikit-learn 1.4 (released 18 January 2024).

## Where leakage hides in "ordinary" feature code

The usual notebook pattern is a set of helper functions that take the whole DataFrame and return it with new columns. Each one looks harmless:

- **Scalers and quantile bins fitted on everything.** `StandardScaler().fit_transform(df[[col]])` or `pd.qcut(df[col], 4)` on the full dataset bakes the test set's mean, spread and cut points into the training features.
- **Frequency or target encoding over the full table.** A `value_counts()` map computed before the split tells the model how common a category is in data it will be evaluated on. Target encoding done this way is worse: it hands the label straight to the model.
- **Group aggregates without a time boundary.** `df.groupby("customer_id")["amount"].mean()` includes the customer's *future* transactions. At scoring time those don't exist.
- **Feature selection before cross-validation.** Picking the "top 20" features using the full `X, y` and then cross-validating on those 20 leaks the selection itself.
- **Random splits on time-ordered data.** Even with perfect transforms, a shuffled split lets the model train on next month to predict last month.

There's also a correctness trap that isn't leakage but does similar damage: `LabelEncoder` on input features. It's designed for targets, and it imposes an arbitrary alphabetical order on nominal categories. Linear models will read that order as meaning.

The scikit-learn docs have a good [common pitfalls page on data leakage](https://scikit-learn.org/stable/common_pitfalls.html) that covers the theory. Below is how I apply it.

## Stateless vs stateful transforms

The single most useful question to ask of any feature is: does computing it require learning something from other rows?

| Kind | Examples | Where it belongs |
|---|---|---|
| Stateless (row-wise) | `log1p`, hour-of-day sin/cos, `is_weekend`, ratios of columns in the same row | Anywhere; safe to compute up front |
| Stateful (learns from data) | Scaling, binning, one-hot vocabularies, frequency and target encoding, imputation, feature selection | Inside the pipeline, fitted on the training fold only |
| Point-in-time (learns from the entity's history) | Rolling counts, 30-day averages, time since last event | Computed with an explicit "strictly before this row" boundary |

Stateless features are where the old helper functions were fine. Stateful ones need to move into a `Pipeline` so that `fit` only ever sees training rows. Point-in-time features need their own discipline, because a pipeline can't fix a window that already looks into the future.

## Point-in-time aggregates first

Entity aggregates are often the strongest features in tabular problems such as fraud, churn and demand, and they're also the easiest to leak. The rule: every aggregate for a row may only use events strictly earlier than that row's timestamp.

```python
import pandas as pd


def add_customer_history(df: pd.DataFrame) -> pd.DataFrame:
    """Per-customer features using only events strictly before the current one."""
    out = df.sort_values(["customer_id", "event_time"]).copy()
    history = out.set_index("event_time").groupby("customer_id")["amount"]

    # closed="left" excludes the current row, so a transaction never sees itself
    rolling = history.rolling("30D", closed="left")
    # groupby output order matches the sort above, so positional assignment is safe
    out["cust_txn_count_30d"] = rolling.count().fillna(0).to_numpy()
    out["cust_amount_mean_30d"] = rolling.mean().to_numpy()

    # Gap since the customer's previous transaction, in hours
    previous = out.groupby("customer_id")["event_time"].shift(1)
    out["hours_since_prev_txn"] = (
        out["event_time"] - previous
    ).dt.total_seconds() / 3600

    return out.sort_index()
```

Two details matter. `closed="left"` on a time-based rolling window excludes the current row, which stops the label-bearing event from contributing to its own feature. And the first transaction per customer gets `NaN` for the mean and gap, which is honest: at scoring time a new customer really has no history. Don't fill it with the global mean computed over the whole table; leave it missing and let the model or a fitted imputer deal with it.

The cost of this approach is that you're now responsible for reproducing the exact same window logic at inference time. That's the point where a feature store starts to earn its keep (more on that below).

## Put every learned statistic inside the pipeline

With history features computed point-in-time, everything stateful goes into a `ColumnTransformer` inside a `Pipeline`. The example is a binary fraud-style classifier with numeric, low-cardinality, high-cardinality and timestamp columns.

```python
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import (
    FunctionTransformer,
    OneHotEncoder,
    RobustScaler,
    TargetEncoder,
)

HISTORY_COLS = ["cust_txn_count_30d", "cust_amount_mean_30d", "hours_since_prev_txn"]


def time_parts(X: pd.DataFrame) -> pd.DataFrame:
    """Stateless: derives calendar features row by row, learns nothing."""
    ts = pd.to_datetime(X.iloc[:, 0])
    return pd.DataFrame(
        {
            "hour_sin": np.sin(2 * np.pi * ts.dt.hour / 24),
            "hour_cos": np.cos(2 * np.pi * ts.dt.hour / 24),
            "dow_sin": np.sin(2 * np.pi * ts.dt.dayofweek / 7),
            "dow_cos": np.cos(2 * np.pi * ts.dt.dayofweek / 7),
            "is_weekend": (ts.dt.dayofweek >= 5).astype(int),
        },
        index=X.index,
    )


def time_part_names(transformer, input_features):
    return ["hour_sin", "hour_cos", "dow_sin", "dow_cos", "is_weekend"]


numeric = make_pipeline(
    FunctionTransformer(np.log1p, feature_names_out="one-to-one"),
    RobustScaler(),
)

preprocess = ColumnTransformer(
    transformers=[
        ("num", numeric, ["amount", "account_age_days"]),
        (
            "low_card",
            OneHotEncoder(
                handle_unknown="infrequent_if_exist",
                min_frequency=20,
                sparse_output=False,
            ),
            ["channel", "merchant_category"],
        ),
        ("high_card", TargetEncoder(), ["merchant_id"]),
        (
            "time",
            FunctionTransformer(time_parts, feature_names_out=time_part_names),
            ["event_time"],
        ),
        ("history", "passthrough", HISTORY_COLS),
    ],
    remainder="drop",
)

model = Pipeline(
    steps=[
        ("features", preprocess),
        ("clf", HistGradientBoostingClassifier(random_state=42)),
    ]
)
```

A few choices here are deliberate.

**`RobustScaler` after `log1p`, not five variants of every column.** Generating log, square root, z-score, robust-scaled and quartile versions of each numeric column triples the feature count and mostly adds correlated noise. Pick one transform per column based on its distribution. For tree-based models like `HistGradientBoostingClassifier`, scaling barely matters at all; I keep it because the same preprocessing often gets reused with a linear baseline.

**`OneHotEncoder` with `min_frequency` and `handle_unknown="infrequent_if_exist"`.** Rare categories are grouped into one "infrequent" column, and a category that first appears in production maps to that same column instead of raising an error. Both options have been available since scikit-learn 1.1. `sparse_output=False` (available since 1.2) is there because `HistGradientBoostingClassifier` needs dense input: with sparse one-hot output and enough categories, `ColumnTransformer` drops below its default `sparse_threshold=0.3` and hands the model a sparse matrix, which fails with a `TypeError`.

**`TargetEncoder` for high-cardinality IDs.** It was added in [scikit-learn 1.3](https://scikit-learn.org/stable/modules/generated/sklearn.preprocessing.TargetEncoder.html) (June 2023), and it's the main reason I stopped hand-rolling target encoding. When it runs through `fit_transform`, which is what `Pipeline.fit` calls, it uses internal cross-fitting, so each training row is encoded with statistics from the other folds. One subtlety: calling `.fit(X, y)` and then `.transform(X)` on the same data skips the cross-fitting and leaks. Inside a pipeline you get that cross-fitting automatically, with one caveat for time-ordered data: the internal folds are shuffled by default (`cv=5, shuffle=True`), so they aren't time-aware. Within each `TimeSeriesSplit` training fold, a row's encoding can draw on later rows from the same fold. The test fold is still clean, so I usually accept it; if it bothers you, `TargetEncoder(shuffle=False)` keeps the internal folds as roughly contiguous blocks of time, which limits the look-ahead without removing it.

**Calendar features as a stateless `FunctionTransformer`.** Sin/cos encoding keeps hour 23 next to hour 0. Because these learn nothing, they could live outside the pipeline, but keeping them in means the scoring service receives a raw timestamp and the pipeline does the rest.

## Validate the way you'll deploy

A leak-free pipeline is only half of it. The split has to match how the model will be used, and for anything with timestamps that means training on the past and testing on the future.

```python
from sklearn.model_selection import TimeSeriesSplit, cross_val_score

df = add_customer_history(raw_df).sort_values("event_time").reset_index(drop=True)

X = df.drop(columns=["is_fraud"])
y = df["is_fraud"]

scores = cross_val_score(
    model,
    X,
    y,
    cv=TimeSeriesSplit(n_splits=5),
    scoring="average_precision",
)
print(f"PR-AUC per fold: {scores.round(3)}  mean: {scores.mean():.3f}")
```

This fragment assumes `raw_df` is your transactions DataFrame and that `model` and `add_customer_history` come from the snippets above. Each fold refits the entire pipeline (scaler, encoders, target statistics) on earlier data only. If your score drops noticeably when you switch from a shuffled `KFold` to `TimeSeriesSplit`, that gap is roughly how much your old numbers were flattered.

### Feature selection belongs in the folds too

The same logic applies to selection. If you want `SelectKBest` or model-based selection, add it as a pipeline step between `features` and `clf` so it's refitted per fold. Running a selection function on the full `X, y` and then cross-validating the survivors is one of the most common leaks I see in reviews, and it's hard to spot because the code that leaks is several cells away from the code that reports the score.

For gradient-boosted trees, I'd skip explicit selection unless you have hundreds of features or a latency budget to meet. Trees handle irrelevant features reasonably well, and the selection step adds a tuning knob that's easy to overfit.

## When a pipeline isn't enough

A fitted scikit-learn pipeline solves training/serving consistency for stateful transforms, because you persist the whole object and the scoring service calls `predict` on raw columns. It does not solve it for the point-in-time history features. Those depend on data the request doesn't carry, so production needs a separate path to compute or look up the same 30-day window.

That's the problem feature stores are built for. On Azure, the [managed feature store in Azure Machine Learning](https://learn.microsoft.com/azure/machine-learning/concept-what-is-managed-feature-store) reached general availability in November 2023. You define feature sets with Spark transformation code, materialise them, and generate training data with point-in-time joins against an observation table, which replaces the hand-written `closed="left"` logic above with a managed, reusable definition. I covered the January 2024 state of it in [Azure Machine Learning updates](/blog/2024-01-30-azure-ml-updates/), and the underlying concepts in [Understanding feature stores](/blog/2021-09-05-feature-stores-concepts/).

When not to reach for one: a single model owned by a single team, with history features that can be recomputed from a source table at scoring time. A feature store adds a Spark dependency, materialisation jobs and another set of permissions to manage. It pays off when several models share the same entity features, or when online scoring needs precomputed values within a tight latency budget.

## What I'd change first

If you have an existing feature notebook, don't rewrite it all at once. Work through it in this order:

1. Find every `fit`, `fit_transform`, `value_counts`, `qcut` and `groupby(...).agg` that runs before the train/test split. Each one is a candidate leak.
2. Move the stateful ones into a `ColumnTransformer` and swap hand-rolled target or label encoding for `TargetEncoder` and `OneHotEncoder`.
3. Rewrite entity aggregates with an explicit "strictly before" boundary.
4. Switch evaluation to a time-based split and compare the numbers. Expect them to go down. That's the point.

The new score is the one you can defend in production. A feature that only helps when it can see the test set was never a feature.
