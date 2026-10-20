---
title: "Power BI Smart Narratives vs DAX Text: Choosing How Reports Talk"
description: "When the Power BI smart narrative visual is enough, when a hand-written DAX text measure is safer, and the limitations that decide it before you publish."
author: Michael John Peña
draft: false
date: 2022-01-31
url: /blog/power-bi-smart-narratives/
tags:
  - Power BI
  - AI
  - Analytics
  - DAX
  - Natural Language
---

Most report pages have someone who only reads the words. An executive skims the headline, a regional manager wants one sentence about their region, and the charts are there for the analysts. Power BI gives you two ways to write that sentence: let the smart narrative visual generate it, or write it yourself as a DAX measure. They suit different jobs, and choosing the wrong one usually shows up after publishing, as a summary nobody trusts or a measure nobody can maintain.

## Where smart narratives stand in early 2022

The smart narrative visual arrived as a preview in the [September 2020 Power BI Desktop release](https://powerbi.microsoft.com/en-us/blog/power-bi-september-2020-feature-summary/) and became generally available in the [May 2021 release](https://powerbi.microsoft.com/en-us/blog/power-bi-may-2021-feature-summary/), the GA milestone Microsoft had scheduled in its 2021 release wave 1 plan. It's a core visual, so you don't need a custom visual from AppSource or Premium capacity to use it.

There are two ways in:

- **Add the visual** from the Visualizations pane. With nothing selected, it summarises the visuals already on the page.
- **Right-click a visual and choose Summarize.** That creates a narrative scoped to that one chart.

The generated text describes what the model can see: totals, trends over time, the largest and smallest contributors, and notable changes between periods. The numbers in it are dynamic values, not static text. When a reader cross-filters with a slicer or clicks a bar, the values recompute for the new filter context. The [smart narrative documentation](https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-smart-narrative) covers the mechanics.

## What you can actually customise

The narrative isn't a black box. It behaves like a text box, so you can delete generated sentences, rewrite them, and add your own. The useful part is that you can add your own dynamic values:

- Map a phrase to an existing field or measure.
- Type a natural language expression, such as "total sales for Australia", and let the Q&A engine resolve it to a calculation. You get the same suggestions as you type that you get in the Q&A visual.
- Format each value: currency, decimal places, thousands separator.
- Use the **Review** tab to list every value in the narrative, find unused ones, and remove or reuse them.

That's the full customisation surface, and it's done in the editor, not in a configuration file. There is no JSON schema for "summary level" or "outlier threshold", and you can't feed it your own linguistic rules except through the Q&A synonyms you've already set on the model. Anything you can't do in that editor, you can't do at all.

Because custom values go through Q&A, their quality depends on how well your model is set up for Q&A. If your measures are called `M_Rev_Net_v2` and nobody has added synonyms, "net revenue" won't resolve. The same model hygiene that makes Q&A usable (friendly names, synonyms, hiding technical columns) makes smart narratives usable. The [Q&A best practices](https://learn.microsoft.com/en-us/power-bi/natural-language/q-and-a-best-practices) apply directly.

## The limitations that decide it

This is where most of the decisions actually get made. As of this writing, the smart narrative visual isn't supported for:

- Pinning to a dashboard
- Publish to web
- Power BI Report Server
- On-premises Analysis Services, or live connections to Azure Analysis Services or SQL Server Analysis Services
- Multidimensional Analysis Services data sources

Language is the other constraint that doesn't appear on that list. Custom dynamic values written in natural language are resolved by Q&A, so they follow Q&A's [language support](https://learn.microsoft.com/en-us/power-bi/natural-language/q-and-a-limitations): English, with Spanish in preview. The generated sentences are English too, and there's no way to localise them.

Two of the platform limits catch teams out. If your organisation runs Power BI Report Server for data that can't go to the cloud, smart narratives are off the table. And if your "single source of truth" is an Analysis Services model reached through a live connection, which is common in enterprises that built their semantic layer before Power BI datasets matured, the visual won't work there either.

Dashboards are the other trap. Executives often consume dashboards, not reports, and a narrative can't be pinned to one. If the sentence must appear on the dashboard, you need a measure on a card.

## Writing the sentence yourself in DAX

The alternative is a measure that returns text. You control every word, it works anywhere a card visual works, and it can be scripted, diffed and reviewed with Tabular Editor or ALM Toolkit like any other measure, which matters while a .pbix file is still a binary that source control can't diff. Here's one that assumes a `Sales` fact table, a `Product` dimension, a [Total Sales] measure, and a `Date` table marked as a date table, with the page filtered to a single month:

```dax
Sales Headline =
VAR CurrentSales = [Total Sales]
VAR PriorSales =
    CALCULATE ( [Total Sales], DATEADD ( 'Date'[Date], -1, MONTH ) )
VAR Growth =
    DIVIDE ( CurrentSales - PriorSales, PriorSales )
VAR TopProduct =
    TOPN ( 1, VALUES ( 'Product'[Product Name] ), [Total Sales], DESC )
VAR TopProductName =
    CONCATENATEX ( TopProduct, 'Product'[Product Name], ", " )
RETURN
    IF (
        ISBLANK ( CurrentSales ),
        "No sales for the current selection.",
        "Sales were " & FORMAT ( CurrentSales, "$#,0" )
            & IF (
                ISBLANK ( Growth ),
                ".",
                ", " & FORMAT ( ABS ( Growth ), "0.0%" )
                    & IF ( Growth >= 0, " up on", " down on" )
                    & " the previous month."
            )
            & " Top product: " & TopProductName & "."
    )
```

A few details are deliberate. `VALUES` rather than `ALL` keeps the top product inside the reader's current filters, so selecting a category names the top product in that category. `CONCATENATEX` handles ties, which a `MAXX` over the `TOPN` result would hide. And the blank checks stop the measure from printing an empty percentage when there's no prior month to compare against: testing `Growth` rather than `PriorSales` also covers a prior month of exactly zero, where `DIVIDE` returns BLANK.

A target-based status line works the same way:

```dax
Target Status =
VAR Achievement = DIVIDE ( [Total Sales], [Sales Target] )
RETURN
    SWITCH (
        TRUE (),
        ISBLANK ( Achievement ), "No target set for this selection.",
        Achievement >= 1, "On or above target at " & FORMAT ( Achievement, "0%" ) & ".",
        Achievement >= 0.9, "Close to target at " & FORMAT ( Achievement, "0%" ) & ".",
        "Below target at " & FORMAT ( Achievement, "0%" ) & "."
    )
```

Keep the thresholds in the measure or, better, in a parameter table if the business will want to change them. Avoid editorial words like "Excellent!" or "Immediate action needed". The report should state the fact and let the reader judge it.

The cost is effort. Every sentence is hand-built, every new insight is a new measure, and the text never notices anything you didn't anticipate. A smart narrative might point out that one region drove most of a month's growth; a DAX measure only reports what you told it to look for.

## How they compare

| Concern | Smart narrative | DAX text measure |
|---|---|---|
| Effort to create | Minutes | Hours per sentence pattern |
| Finds things you didn't anticipate | Yes | No |
| Wording control | Editable, but generated sentences can shift as data changes | Total |
| Pin to dashboard | No | Yes, via a card |
| Report Server, live Analysis Services | No | Yes |
| Source control and review | Lives in the report layout, no practical diff | Scriptable and diffable with Tabular Editor or ALM Toolkit |
| Depends on Q&A setup | For custom values | No |
| Languages | English (Q&A Spanish in preview) | Any, you write the words |

## When not to use a smart narrative

I wouldn't put a smart narrative on a report where the wording carries weight: board packs, regulatory reporting, or anything a reader might quote back to you. Generated sentences are accurate about the numbers, but which facts get mentioned can change as the data changes, and that's the wrong property for a page that has to read the same way every month. The same goes for reports published to readers in other languages: you can't translate generated wording, but you can translate a measure.

I also wouldn't use it as a substitute for a well-designed page. If a chart needs a paragraph of generated text to be understood, fix the chart first.

Where it earns its place is exploratory and operational reporting: a sales page reviewed weekly, a self-service report used by managers who won't read a line chart, or a prototype where you want to see what the data says before deciding which sentences deserve a hand-written measure. Using it that way, as a discovery tool, works well. Let the smart narrative show you which observations people actually care about, then promote the stable ones to DAX measures in the model.

## My recommendation

Start with the platform constraints, because they decide most cases. If the text has to be on a dashboard, on Report Server, or over a live Analysis Services connection, write it in DAX. Otherwise, use the smart narrative for pages where discovery matters more than fixed wording, invest in Q&A synonyms so your custom values resolve, and move any sentence that becomes part of a standing conversation into a reviewed measure. For where this sits among the other Power BI features worth adopting right now, see my [early 2022 Power BI status check](/blog/power-bi-2022-features/).
