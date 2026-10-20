---
title: "APPROXIMATEDISTINCTCOUNT in Direct Lake: When 1.6% Error Is Fine"
description: "APPROXIMATEDISTINCTCOUNT now runs on Import and Direct Lake models in preview. Decide per measure where about 1.6% error is fine, label it, and test the gain."
author: Michael John Peña
draft: false
date: 2026-10-08
tags:
  - Power BI
  - DAX
  - Direct Lake
  - Semantic Models
  - Performance
---

Distinct counts are among the most expensive things you can ask a semantic model for. A measure counting unique users, sessions or devices over a column with tens of millions of values is often the slowest one on the page, and it gets slower as data grows. The [Power BI September 2026 feature summary](https://community.fabric.microsoft.com/blog/fbc_pbiupdatesblog/power-bi-september-2026-feature-summary/5325831) brings `APPROXIMATEDISTINCTCOUNT` to Import and Direct Lake models in preview, with a standard error of about 1.6%. It's a useful tool, but it's a measure-by-measure decision: the wrong default can put a number in front of an auditor that can't be reconciled.

## What changed

[`APPROXIMATEDISTINCTCOUNT`](https://learn.microsoft.com/en-us/dax/approximatedistinctcount-function-dax) isn't new DAX. It takes a single column, like `DISTINCTCOUNT`, and returns an estimate of how many distinct values it has. Until now it only worked in DirectQuery, where Power BI pushed it down to the source's own approximate aggregation, such as [`APPROX_COUNT_DISTINCT` in Azure SQL](https://learn.microsoft.com/en-us/sql/t-sql/functions/approx-count-distinct-transact-sql). Import and Dual storage modes weren't supported, so most models never had the option.

The September update changes that: the engine now evaluates the function itself for Import tables and for Direct Lake tables. It's a preview, so treat it as such. Don't put it on a certified model until you've tested it against your own data, and expect behaviour to change before GA.

The feature summary gives the status and the error figure, but it doesn't spell out a minimum Desktop version, a switch under **Options > Preview features**, or whether Dual-mode tables and composite models are covered. I won't guess at those. Use the current Desktop release, check the updated DAX reference page before you build on it, and test a Dual table separately if your model has one. The reference page has long excluded the function from calculated columns and row-level security (RLS) rules, so assume those limits still apply until the documentation says otherwise.

The source-side implementations are typically HyperLogLog-style sketches. These hash every value, keep a small fixed-size summary, and estimate cardinality from it. Memory use stays roughly constant no matter how many distinct values there are, which is why the gain is largest on high-cardinality columns. For classic HyperLogLog, the standard error is about 1.04 divided by the square root of the number of registers. With 4,096 registers that comes to roughly 1.6%, which matches the figure Microsoft quotes. I'm not claiming that's exactly how the VertiPaq implementation works. It's the right mental model for what the error means, though.

## What "about 1.6% standard error" means

Standard error isn't a maximum. It describes a spread. If the estimator's error is roughly normal (figures rounded, based on 1.6%):

| Range | Roughly how often the estimate lands inside it |
|---|---|
| ±1.6% (one standard error) | about 68% of the time |
| ±3.2% (two standard errors) | about 95% of the time |
| ±4.8% (three standard errors) | about 99.7% of the time |

So on a card showing 2,000,000 monthly active users, the true figure is probably within about 32,000, and almost certainly within about 100,000. For a trend line that's noise. For a figure someone reconciles against a billing system, that's a defect.

The error is also relative, and it applies to every cell separately. Each cell in a matrix is its own estimate, so the subtotal is a separate estimate, not the sum of the rows. Exact distinct counts don't add up either, so that part isn't new. What's new is that the rows and the total can each be slightly off in different directions. Anyone who exports the table to Excel and checks it by hand will notice.

## Decide per measure, not per model

My rule: approximation is a property of a measure's *purpose*, not of the model or the column. The same `CustomerKey` column can feed an exact measure for finance and an approximate one for product analytics. I'd classify every distinct count before deciding:

| Measure purpose | Approximate? | Why |
|---|---|---|
| Daily or monthly active users, sessions, visitors | Yes | Read as trends and ratios over time. A 1–3% wobble doesn't change any decision. |
| Engagement and reach in marketing or product dashboards | Yes | The source data (tracking, cookies, device IDs) is already noisier than 1.6%. |
| Exploratory analysis on very large event tables | Yes, with a label | Speed matters more than the last digit while exploring. |
| Customer counts in financial or board reporting | No | People compare these with the ledger and the CRM. They have to tie out. |
| Compliance and regulatory counts (affected individuals, consents, licensed seats) | No | A figure you file or attest to must be exact and reproducible. |
| Reconciliation and data quality checks | No | The whole point is to detect small differences. An estimator hides them. |
| Small populations, such as a single store or a rare segment | Usually no | 1.6% of a small number is small, but these figures are scrutinised row by row, and the speed gain is minimal. |

When unsure, keep it exact. An exact measure that's slow is a performance problem you can fix with aggregation tables, better partitioning or [Delta layout work](/blog/2024-01-17-direct-lake-best-practices/). An approximate measure in the wrong report is a trust problem, and those are much harder to fix.

## Label approximate measures so consumers know

A report viewer can't tell from a card whether its number is exact. If you approximate, say so everywhere the number appears, including places that don't show a visual.

Two measure definitions, as you'd type them in the formula bar or TMDL view (fragments, not a DAX query):

```dax
-- Exact: use for finance, compliance and reconciliation
Customers = DISTINCTCOUNT ( Sales[CustomerKey] )

-- Approximate: trend and engagement reporting only
Active Users (approx.) = APPROXIMATEDISTINCTCOUNT ( Events[UserId] )
```

The conventions I'd use:

- **Put it in the name.** A suffix such as `(approx.)` is visible in the field list, in visual headers, in exported data and in Q&A or Copilot answers. A naming convention survives places that formatting and tooltips don't reach.
- **Write a measure description.** Description text shows when you hover over the field in the Data pane. It's also the metadata that agents read. I argued in the [Fabric IQ governance post](/blog/2026-10-01-fabric-iq-copilot-semantic-model-governance/) that descriptions are now part of your model's contract, and "approximate, about 1.6% standard error, not for reconciliation" is exactly what an agent should know before quoting the number.
- **Use a display folder.** Putting approximate measures in their own folder stops report authors from picking one up by accident when they meant the exact one.
- **Add a visual subtitle on the report.** One line such as "Unique users are estimated (typically within ±3%)" is enough. Don't put it in a footnote on another page.

## Test the gain before you adopt it

Don't assume a speed-up. Measure it on the columns you actually care about, and measure the error at the same time. A comparison measure does both:

```dax
Approx Error % =
VAR ExactCount = DISTINCTCOUNT ( Events[UserId] )
VAR ApproxCount = APPROXIMATEDISTINCTCOUNT ( Events[UserId] )
RETURN
    DIVIDE ( ApproxCount - ExactCount, ExactCount )

Approx Abs Error % by Day =
AVERAGEX (
    VALUES ( 'Date'[Date] ),
    ABS ( [Approx Error %] )
)
```

Put both in a matrix by date and by your main segments. The signed measure shows whether the estimate leans high or low; the absolute one averages the size of the error across the days in context, so a single total tells you the typical daily error without reading every cell. Swap `'Date'[Date]` for a segment column to average across segments instead. You're checking two things: that the error behaves as advertised on your data, and whether any slice you care about behaves badly. Small segments and heavily filtered contexts are the first places I'd look. Also check how blanks are handled compared with your exact measure, since `DISTINCTCOUNT` counts a blank as a value.

For timings, run the exact and approximate versions of the same query in [DAX Studio](https://daxstudio.org/) with Server Timings on and the cache cleared, or use [Performance Analyzer](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-performance-analyzer) in Desktop for the whole visual. Some practical points:

- **Test where the cost is.** The gain should show up on high-cardinality columns such as user IDs, device IDs and transaction IDs. On a column with a few thousand values, `DISTINCTCOUNT` is already cheap, and approximating gives you error for nothing.
- **Separate cold and warm runs in Direct Lake.** The first query after a reframe also pays to load the column into memory. That cost is the same for both functions, so measure warm runs when comparing them, and measure cold runs separately so you know what users see first thing in the morning.
- **Test realistic filter contexts.** A card with no filters can behave very differently from a matrix with a date slicer and three segment columns. Copy the DAX query that Performance Analyzer captured for a real visual and time that.
- **Weigh the alternatives.** If one high-cardinality distinct count dominates a report, a pre-aggregated table built in the Lakehouse (daily active users by segment, for example) can be both exact and fast. That's more work upstream, but it's the right answer when the number has to tie out.

## Don't mix exact and approximate counts in one visual

The surest way to destroy trust in a dashboard is to put exact and approximate figures where someone can compare them. Three patterns to avoid:

1. **Side-by-side columns.** A table with `Customers` (exact) next to `Active Users (approx.)` invites people to subtract one from the other. When the difference doesn't make sense, they stop trusting both.
2. **Ratios with one exact and one approximate side.** A conversion rate of `DIVIDE ( [Purchasers], [Active Users (approx.)] )` carries the estimator's error into the ratio. If both sides are approximate, the two errors combine. Where purchasers are close to visitors, the rate can exceed 100% for some slices. If you approximate a ratio, approximate both sides deliberately and label the result. If the ratio feeds a target or a bonus, keep both sides exact.
3. **Exact rows, approximate total.** A measure with an `ISINSCOPE` (or `HASONEVALUE`) branch that switches to the approximate function only at the grand total looks like a clever optimisation. It produces a total that doesn't match its rows in a way nobody can explain. Keep one function per visual.

A simple test: if someone can check a number with a calculator using only other numbers on the same page, those numbers should come from the same counting method.

## Where I land

`APPROXIMATEDISTINCTCOUNT` on Import and Direct Lake is a sensible addition, and on large event tables it may be the cheapest performance fix available. I'd use it for engagement and trend measures, where the source data is already noisier than the estimator. I'd keep it out of anything financial, regulated or reconciled. Make the choice per measure, put "approx." in the name and the description, prove the gain and the error on your own high-cardinality columns, and never let an estimate share a visual with an exact count. While it's in preview, keep the approximate measures off certified models and expect to revisit them at GA.
