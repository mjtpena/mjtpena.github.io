---
title: "Power BI in Early 2022: What's GA, What's Preview, What to Adopt"
description: "A status check on Power BI's newer modelling, performance and ALM features as of January 2022, with my view on which to adopt now and which to pilot."
author: Michael John Peña
draft: false
date: 2022-01-26
url: /blog/power-bi-2022-features/
tags:
  - Power BI
  - Analytics
  - Data Modeling
  - Data
---

Power BI ships an update every month, and by the start of 2022 the feature list has outgrown most teams' ability to track it. The real problem isn't knowing a feature exists; it's knowing whether it's generally available, which licence it needs, and whether it belongs in a production model or a sandbox. Get that wrong and you either build on a preview that changes under you, or you ignore a GA feature that would have saved weeks.

This post is the map for a short series. Each of the next five posts goes deep on one feature; here I'm sorting them by status and telling you where I'd put my effort this quarter.

## The status board, January 2022

| Feature | Status (Jan 2022) | Licence | My call |
|---|---|---|---|
| Composite models (Import + DirectQuery) | GA | Pro and above | Use it, deliberately |
| DirectQuery for Power BI datasets and Azure Analysis Services | Preview (since December 2020) | Pro and above | Pilot, not mission-critical |
| Hybrid tables | Public preview (December 2021) | Premium, PPU | Pilot on one large fact table |
| Automatic aggregations | Public preview (since August 2021) | Premium, PPU | Pilot if you're already on DirectQuery |
| Smart narrative visual | GA (May 2021) | Pro and above | Use it sparingly |
| Goals | Public preview | Pro to author; Premium/PPU for free viewers and some features | Fine for internal scorecards |
| Deployment pipelines | GA (May 2020); REST APIs added later in 2020 | Premium, PPU | Adopt now if you have the licence |
| Paginated reports | GA | Premium capacity or PPU | Use for operational, print-shaped output |

The pattern worth noticing: almost everything interesting in 2021 landed behind Premium or Premium Per User. If you're on Pro only, half this table is out of reach, and that alone is a reason to revisit the PPU maths. I covered the licence side in [Power BI Premium Per User](/blog/2021-03-11-power-bi-premium-per-user/) and capacity planning in [Power BI Premium Capacities](/blog/2021-11-10-power-bi-premium-capacities/).

## Modelling: composite models and chaining

[Composite models](https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-composite-models) are not new. Mixing Import and DirectQuery tables in one dataset has been GA for years, with Dual storage mode letting a dimension act as either depending on the query. What changed is what people now try to do with them.

Treating a composite model as a way to avoid deciding on a storage mode is expensive. Every relationship that crosses from an Import table to a DirectQuery table becomes a limited relationship, resolved at query time rather than through the engine's in-memory join, and every visual that touches the DirectQuery side sends SQL to the source. Leave the decision open and you pay that cost on every page load. A composite model is a performance design, not a compromise. Put small, slow-changing dimensions in Dual, keep the big fact table where the freshness requirement says it must live, and test the actual queries.

The bigger shift is **DirectQuery for Power BI datasets and Azure Analysis Services**, in preview since December 2020. It lets a report author connect to a published, governed dataset and extend it locally with their own tables and measures. For organisations that have spent years building a certified enterprise model, this finally answers the "I just need to add my budget spreadsheet" request without a copy of the model.

It's still preview, and it behaves like one. You enable it under Preview features in Power BI Desktop, your Power BI admin also has to turn on the matching tenant setting, Power BI Embedded isn't supported for these datasets during the preview, chains are limited in length, and security from the remote model flows through to the composite, which is good, but means testing has to be done as real users. My position: pilot it with a few analysts against one certified dataset, and don't let a board pack depend on it until it reaches GA. The deep dives are in [Power BI Composite Models](/blog/2022-01-27-power-bi-composite-models/) and [DirectQuery for Power BI Datasets](/blog/2022-01-28-power-bi-directquery-datasets/).

## Performance: hybrid tables and automatic aggregations

Both of these target the same pain: a fact table too large or too fresh for Import, and too slow under DirectQuery.

**Hybrid tables** arrived in public preview in December 2021. They extend [incremental refresh](https://learn.microsoft.com/en-us/power-bi/connect-data/incremental-refresh-overview): you define the usual RangeStart and RangeEnd policy, then tick the option to get the latest data in real time with DirectQuery. The service keeps historical partitions in Import and adds a DirectQuery partition for the most recent period. One table, two storage modes, split by time.

This is the feature I'm most interested in for 2022, because it removes a common ugly workaround: two separate tables (history and today) stitched together with measures. The trade-offs are real, though. It needs Premium or PPU, the source query must fold so the partition filters reach the database, and any visual that includes the current period still pays DirectQuery latency. If your users mostly look at last month, you won't notice. If the landing page is "today so far", you will. More in [Power BI Hybrid Tables](/blog/2022-01-29-power-bi-hybrid-tables/).

**Automatic aggregations**, in public preview on Premium and PPU since August 2021, take a different approach. Instead of you designing aggregation tables by hand, the service analyses the dataset's query log, trains an in-memory aggregation cache, and answers matching DirectQuery queries from it. You turn it on in the dataset settings, and the training runs with scheduled refresh.

I like the idea, and I'd still be careful. It only helps DirectQuery datasets, training depends on having a representative query history, and a preview that rewrites query paths is exactly the sort of thing you want to observe before you trust it. If you already have hand-built aggregations that work, there's no urgent reason to switch. If you're running a large DirectQuery model with no aggregations at all, it's a cheap experiment. See [Power BI Automatic Aggregations](/blog/2022-01-30-power-bi-automatic-aggregations/).

### When not to reach for either

If your data fits comfortably in Import and a few refreshes a day meets the business need, do that. Import with incremental refresh remains the fastest and simplest option. Hybrid tables and automatic aggregations exist for models that have genuinely outgrown it, not as defaults.

## Report authoring: smart narrative

The [smart narrative visual](https://learn.microsoft.com/en-us/power-platform-release-plan/2021wave1/power-bi/smart-narratives-ga) went GA in the May 2021 Desktop release after a preview that started in September 2020. It generates a text summary of the visuals on a page, and you can edit the text and insert dynamic values that recalculate with filters.

It's useful for one thing in particular: a sentence at the top of a page that states the headline number in words, filtered to the reader's context. It's less useful as an autogenerated paragraph nobody edits. Generic text such as "Sales increased the most in Category X" ends up ignored by the second week. My rule of thumb is to keep the dynamic values and rewrite the prose yourself. More in [Power BI Smart Narratives](/blog/2022-01-31-power-bi-smart-narratives/).

## Measuring outcomes: Goals

Goals has been in public preview since 2021 and lets you build scorecards where each goal's current value and target can be connected to a measure in a dataset, with status rules and check-ins. I wrote about it when it launched in [Introducing Power BI Goals](/blog/2021-07-05-power-bi-goals/).

Licensing is friendlier than the rest of this list: a Pro licence is enough to create a scorecard, and Premium capacity or PPU only comes into play for viewers on free licences and some of the more advanced features. It's still preview, though, and the authoring surface is the Power BI service, not a definition file you can source-control. For an internal team scorecard that's fine. For an executive OKR process with audit expectations, I'd wait for GA and see how it settles.

## Delivery: deployment pipelines

[Deployment pipelines](https://learn.microsoft.com/en-us/power-bi/create-reports/deployment-pipelines-overview) have been GA since 2020 and are the least glamorous item here, and the one I'd push hardest. Development, test and production workspaces, with deployment rules to swap data sources and parameters per stage, are the minimum for any Power BI estate that matters. The catch is the same as above: Premium or PPU.

The [Deploy All REST API](https://learn.microsoft.com/en-us/rest/api/power-bi/pipelines/deploy-all) lets you trigger promotions from a release pipeline instead of clicking in the portal. The call is asynchronous: it returns an operation you poll. Here's a complete script that signs in with the device code flow and promotes everything from Development to Test:

```python
import sys
import time

import msal
import requests

CLIENT_ID = "<your-app-registration-client-id>"
TENANT_ID = "<your-tenant-id>"
PIPELINE_ID = "<your-pipeline-id>"
SCOPES = ["https://analysis.windows.net/powerbi/api/.default"]
BASE_URL = "https://api.powerbi.com/v1.0/myorg"
MAX_WAIT_SECONDS = 30 * 60  # stop well before the access token expires


def get_token() -> str:
    app = msal.PublicClientApplication(
        CLIENT_ID, authority=f"https://login.microsoftonline.com/{TENANT_ID}"
    )
    flow = app.initiate_device_flow(scopes=SCOPES)
    print(flow["message"])
    result = app.acquire_token_by_device_flow(flow)
    if "access_token" not in result:
        sys.exit(f"Sign-in failed: {result.get('error_description')}")
    return result["access_token"]


def deploy_all(token: str, source_stage_order: int) -> str:
    response = requests.post(
        f"{BASE_URL}/pipelines/{PIPELINE_ID}/deployAll",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "sourceStageOrder": source_stage_order,
            "options": {
                "allowCreateArtifact": True,
                "allowOverwriteArtifact": True,
            },
        },
        timeout=60,
    )
    response.raise_for_status()
    return response.json()["id"]


def wait_for_operation(token: str, operation_id: str) -> str:
    url = f"{BASE_URL}/pipelines/{PIPELINE_ID}/operations/{operation_id}"
    deadline = time.monotonic() + MAX_WAIT_SECONDS
    while time.monotonic() < deadline:
        response = requests.get(
            url, headers={"Authorization": f"Bearer {token}"}, timeout=60
        )
        response.raise_for_status()
        status = response.json()["status"]
        if status in ("Succeeded", "Failed"):
            return status
        time.sleep(10)  # NotStarted or Executing: keep polling
    sys.exit(f"Deployment {operation_id} still running after {MAX_WAIT_SECONDS} s")


if __name__ == "__main__":
    access_token = get_token()
    op_id = deploy_all(access_token, source_stage_order=0)  # 0 = Development
    final_status = wait_for_operation(access_token, op_id)
    print(f"Deployment {op_id}: {final_status}")
    sys.exit(0 if final_status == "Succeeded" else 1)
```

The app registration needs the Power BI Service delegated permissions `Pipeline.Deploy` (and `Pipeline.Read.All` to read operations), granted with admin consent, and the signed-in user must be a pipeline admin with access to both workspaces. The script gives up after 30 minutes so a stuck deployment fails the release instead of hanging it; if your deployments genuinely run longer, refresh the token inside the loop rather than raising the limit, because access tokens expire after about an hour. In a real release pipeline you'd swap the device code flow for a service principal through `msal.ConfidentialClientApplication`, which the pipelines APIs accept once your admin allows service principals to use Power BI APIs in the tenant settings and the principal has access to the pipeline and workspaces. The request and polling logic stay the same. I covered the stage design in [Power BI Deployment Pipelines](/blog/2021-11-11-power-bi-deployment-pipelines/).

## Where I'd spend the first quarter of 2022

If you have Premium or PPU, set up deployment pipelines first. It's GA, it's boring, and it prevents the incidents that erode trust in a BI platform faster than any slow report.

If you produce invoices, statements or anything else people print or export page by page, paginated reports are the other Premium/PPU feature that justifies the licence on its own. If your output is interactive dashboards, they won't move the needle, so don't buy the licence for them.

Second, pick one large fact table and pilot hybrid tables against it, measuring query times before and after. That's the preview with the clearest payoff.

Third, give a small group of analysts DirectQuery for Power BI datasets against your certified model, and collect the cases where they extend it. Those requests tell you what the enterprise model is missing.

Leave automatic aggregations and Goals in the "watch" column unless you have a specific problem they solve today. Preview features are worth learning early; they're not worth making load-bearing early.
