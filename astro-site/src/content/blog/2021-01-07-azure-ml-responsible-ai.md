---
title: "Explain and Fairness-Check an Azure ML Model Before You Ship It"
description: "A pre-deployment review for Azure ML models using azureml-interpret and Fairlearn 0.5: what to measure, how to log it to a run, and what it can't tell you."
author: Michael John Peña
draft: false
date: 2021-01-07
tags:
  - Azure
  - Machine Learning
  - Responsible AI
  - Fairness
  - Ethics
---

"The model said no, and I can't tell why" is the conversation that derails most ML deployments. It usually happens after go-live, in front of a risk committee or an angry customer, and by then the only honest answer is "we didn't check". Azure Machine Learning gives you two practical tools to check before deployment: model interpretability through the `azureml-interpret` package, and fairness assessment through the open-source Fairlearn library. I've used the Fairlearn dashboard to flag a credit-decisioning model that quietly behaved differently across postcodes, so I treat this review as a release gate, not a research exercise.

## What's actually in the box (January 2021)

Microsoft grouped these tools under "responsible ML" at Build 2020, and the names get blurred, so here is what you can use in the Azure ML Python SDK today and its status (the [interpretability how-to](https://learn.microsoft.com/en-us/azure/machine-learning/v1/how-to-machine-learning-interpretability-aml) covers the explanation side in detail):

| Capability | Package | Where you see results | Status |
|---|---|---|---|
| Global and local explanations | `azureml-interpret` (wraps the open-source `interpret-community`) | Explanations tab on a run in Azure ML studio, or a notebook widget | Preview |
| Fairness metrics and mitigation | `fairlearn` 0.5.0 (released November 2020) | `FairlearnDashboard` widget in Jupyter | Open source |
| Fairness results stored with a run | `azureml-contrib-fairness` | Fairness tab on the run or registered model in studio | Preview |

Two things worth stating plainly. First, "preview" here means no SLA and APIs that can change between the roughly monthly SDK releases (1.19.0 shipped in December 2020). Pin your versions. Second, there is no single combined dashboard in Azure ML. Interpretability and fairness are separate packages with separate widgets, and you stitch them together yourself.

## Start with the question, not the toolkit

The mistake I see most often is running every explainer and every fairness metric, producing a wall of charts, and calling the model "reviewed". That's theatre. Before writing any code, answer three questions with the business owner:

1. **Who can be harmed, and how?** For a lending model, a false positive (predicting default for someone who would have repaid) means a declined applicant. A false negative means a bad loan. Those harms land on different people.
2. **Which groups do you need to compare?** Sex and age band are common. Postcode is a trap: it isn't a protected attribute on its face, but it often acts as a proxy for one.
3. **What disparity is acceptable?** If nobody will commit to a threshold, the fairness numbers can't fail the model, and the review is decorative.

Only then pick metrics. For the lending example, false positive rate and selection rate by group matter more than overall accuracy. Because the positive class here is default, `selection_rate` is the predicted-decline rate per group.

## Explain the model with azureml-interpret

`TabularExplainer` picks an appropriate SHAP-based explainer for your model type (a tree explainer for gradient boosting, a kernel explainer for black boxes). The example below trains a simple classifier on numeric features and keeps the sensitive attributes out of the feature set, but alongside it for assessment.

```python
# requirements: azureml-sdk==1.19.0, azureml-interpret==1.19.0, azureml-contrib-fairness==1.19.0, fairlearn==0.5.0
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from interpret.ext.blackbox import TabularExplainer

df = pd.read_csv("loans.csv")  # placeholder dataset with a binary 'defaulted' column

features = ["income", "loan_amount", "term_months", "credit_history_years", "existing_debt"]
sensitive = ["sex", "age_band"]

X = df[features]
y = df["defaulted"]
A = df[sensitive]

X_train, X_test, y_train, y_test, A_train, A_test = train_test_split(
    X, y, A, test_size=0.3, random_state=42, stratify=y
)

model = GradientBoostingClassifier(random_state=42).fit(X_train, y_train)

explainer = TabularExplainer(
    model, X_train, features=features, classes=["repaid", "defaulted"]
)

global_explanation = explainer.explain_global(X_test)
print(global_explanation.get_feature_importance_dict())

# Why did the model score the first five test applicants the way it did?
local_explanation = explainer.explain_local(X_test[0:5])
print(local_explanation.get_ranked_local_names())
```

Leaving `sex` and `age_band` out of training is necessary but not sufficient. If `income` or `credit_history_years` correlates strongly with age, the model can learn age anyway. That is why you still measure outcomes by group. To test for a proxy like postcode, check how strongly each candidate feature correlates with the protected attributes before training, and pass a postcode-region column into `MetricFrame` as an extra sensitive feature for assessment only, never as a model input.

### Put the explanation where reviewers can find it

(These snippets continue in the same notebook session, so `model`, `X_test` and friends carry over.)

A notebook printout disappears. Uploading the explanation to the run puts it in the run's Explanations tab in studio, next to the metrics and the registered model, which is what an auditor will ask for six months later.

```python
from azureml.core import Workspace, Experiment
from azureml.interpret import ExplanationClient

ws = Workspace.from_config()
run = Experiment(ws, "loan-default-review").start_logging()

client = ExplanationClient.from_run(run)
client.upload_model_explanation(global_explanation, comment="GBM v1: global explanation on test set")
```

In a remote training script you'd use `Run.get_context()` instead of `start_logging()`; the [azureml-interpret reference](https://learn.microsoft.com/en-us/python/api/azureml-interpret/azureml.interpret) covers both.

## Measure fairness with Fairlearn's MetricFrame

Fairlearn 0.5.0 replaced the old `group_summary` functions with `MetricFrame` ([changelog](https://github.com/fairlearn/fairlearn/blob/v0.5.0/CHANGES.md)). It computes any scikit-learn-style metric overall and per group, and it handles multiple sensitive features at once. `MetricFrame` takes a single callable or a dict of named callables as its first argument, `metric`.

```python
from sklearn.metrics import accuracy_score
from fairlearn.metrics import (
    MetricFrame,
    selection_rate,
    false_positive_rate,
    false_negative_rate,
)

y_pred = model.predict(X_test)

mf = MetricFrame(
    metric={
        "accuracy": accuracy_score,
        "selection_rate": selection_rate,
        "false_positive_rate": false_positive_rate,
        "false_negative_rate": false_negative_rate,
    },
    y_true=y_test,
    y_pred=y_pred,
    sensitive_features=A_test,
)

print(mf.overall)
print(mf.by_group)        # one row per (sex, age_band) combination
print(mf.difference())    # largest gap between groups, per metric
print(mf.ratio())         # smallest ratio between groups, per metric
```

Read `by_group` before you read `difference()`. A small gap can hide a group with forty rows in the test set, where every metric is noise. If a group is that thin, the honest finding is "we can't assess this group", and that belongs in the review notes.

### Store the fairness assessment with the run

The `azureml-contrib-fairness` package uploads the same data the Fairlearn dashboard uses, so it renders in studio. It relies on a private Fairlearn helper, `_create_group_metric_set`, which is what Microsoft's [Fairlearn with Azure ML guide](https://learn.microsoft.com/en-us/azure/machine-learning/v1/how-to-machine-learning-fairness-aml) uses. Expect it to move between versions.

```python
from azureml.core import Model
from azureml.contrib.fairness import upload_dashboard_dictionary
from fairlearn.metrics._group_metric_set import _create_group_metric_set
import joblib

joblib.dump(model, "loan_gbm.pkl")
registered = Model.register(ws, model_path="loan_gbm.pkl", model_name="loan-gbm")

dash_dict = _create_group_metric_set(
    y_true=y_test,
    predictions={registered.id: y_pred},
    sensitive_features={"sex": A_test["sex"], "age_band": A_test["age_band"]},
    prediction_type="binary_classification",
)

upload_dashboard_dictionary(run, dash_dict, dashboard_name="loan-gbm v1 fairness")
run.complete()
```

## Mitigate, then look at what it cost

If the gap fails your threshold, Fairlearn's reductions approach retrains the model under a constraint. `ExponentiatedGradient` wraps any estimator that accepts `sample_weight` in `fit`.

```python
from fairlearn.reductions import ExponentiatedGradient, EqualizedOdds
from fairlearn.metrics import equalized_odds_difference

mitigator = ExponentiatedGradient(
    GradientBoostingClassifier(random_state=42),
    constraints=EqualizedOdds(),
)
mitigator.fit(X_train, y_train, sensitive_features=A_train["sex"])

y_pred_mitigated = mitigator.predict(X_test, random_state=42)

for name, preds in [("original", y_pred), ("mitigated", y_pred_mitigated)]:
    gap = equalized_odds_difference(y_test, preds, sensitive_features=A_test["sex"])
    print(f"{name}: accuracy={accuracy_score(y_test, preds):.3f}, equalized odds gap={gap:.3f}")
```

Three trade-offs to put in front of the business before you deploy the mitigated model:

- **Accuracy usually drops.** That's the point: you're giving up some overall fit to narrow the gap. Show both numbers side by side and let the owner decide.
- **The model is randomised.** `ExponentiatedGradient` produces a mixture of classifiers, and `predict` samples from it, so the same applicant can get different answers on repeat calls unless you fix `random_state`. For a regulated decision, that alone may rule it out. Fairlearn's `ThresholdOptimizer` (post-processing) is the alternative, but it needs the sensitive feature at prediction time, which brings its own legal questions.
- **The constraint fixes one metric.** Equalized odds and demographic parity can't generally both hold. Choose the one that matches the harm you identified earlier.

## When not to bother (and when this isn't enough)

Skip the fairness assessment when the model never makes a decision about a person, such as forecasting demand for a warehouse. Do the interpretability step anyway, because it catches leakage (a feature that's suspiciously dominant) faster than anything else.

Don't treat any of this as sufficient for high-stakes decisions. SHAP values describe the model, not the world; they won't tell you the training labels were biased by past human decisions. Fairlearn measures the groups you give it and nothing else. And with the Azure ML pieces still in preview, I'd keep a copy of the metrics in your own model documentation rather than relying on studio alone.

## The takeaway

Make this a gate in your release process: a global explanation and a `MetricFrame` by group, uploaded to the run, reviewed against a threshold the business owner agreed to in writing. In my experience the wiring is the easy part; agreeing the threshold takes longer. If you're using [Automated ML](/blog/2020-11-11-azure-ml-automated-ml/), you already get explanations for the best model; add the fairness step on top. The tooling will mature, but the discipline of asking "who could this hurt?" before shipping is the part that matters, and no SDK does that for you.
