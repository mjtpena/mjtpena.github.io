---
title: "Power BI Smart Narratives: AI-Generated Insights"
author: Michael John Peña
draft: false
date: 2022-01-31
url: /blog/power-bi-smart-narratives/
tags:
  - power-bi
  - ai
  - analytics
  - natural-language

---

I wrote "Power BI Smart Narratives: AI-Generated Insights" to share practical, production-minded guidance on this topic.

## What Are Smart Narratives?

Smart narratives analyze your visuals and data to produce:
- Key metric summaries
- Trend descriptions
- Outlier highlights
- Comparative insights

## Adding a Smart Narrative

In Power BI Desktop, add the Smart Narrative visual:

```json
{
  "visualType": "smartNarrative",
  "config": {
    "dataRoles": [
      {
        "name": "Values",
        "values": ["Sales[Total Revenue]", "Sales[Quantity]"]
      },
      {
        "name": "Category",
        "values": ["Product[Category]"]
      },
      {
        "name": "Time",
        "values": ["Date[Date]"]
      }
    ],
    "settings": {
      "summaryLevel": "detailed",
      "includeComparisons": true,
      "highlightOutliers": true
    }
  }
}
```

## Customizing Narrative Content

Use the visual's configuration options:

```json
{
  "smartNarrativeSettings": {
    "summary": {
      "enabled": true,
      "type": "autoSummarize"
    },
    "trends": {
      "enabled": true,
      "period": "monthly"
    },
    "outliers": {
      "enabled": true,
      "threshold": 2.0
    },
    "comparisons": {
      "enabled": true,
      "compareWith": "previousPeriod"
    },
    "formatting": {
      "numberFormat": "#,##0",
      "percentFormat": "0.0%",
      "dateFormat": "MMM yyyy"
    }
  }
}
```

## Dynamic Text with DAX

Create custom dynamic text that complements smart narratives:

```dax
// Custom narrative measure
Sales Narrative =
VAR TotalSales = [Total Sales]
VAR PreviousMonthSales = CALCULATE([Total Sales], PREVIOUSMONTH('Date'[Date]))
VAR Growth = DIVIDE(TotalSales - PreviousMonthSales, PreviousMonthSales)
VAR TopProduct = TOPN(1, ALL(Product[Name]), [Total Sales])
VAR TopProductName = MAXX(TopProduct, Product[Name])
VAR TopProductSales = MAXX(TopProduct, [Total Sales])

RETURN
"Total sales reached " & FORMAT(TotalSales, "$#,##0") &
", which is " & FORMAT(ABS(Growth), "0.0%") &
IF(Growth >= 0, " higher ", " lower ") &
"than last month. " &
"The top performing product was " & TopProductName &
" with " & FORMAT(TopProductSales, "$#,##0") & " in sales."

// Conditional narrative
Performance Summary =
VAR CurrentSales = [Total Sales]
VAR Target = [Sales Target]
VAR Achievement = DIVIDE(CurrentSales, Target)

RETURN
SWITCH(TRUE(),
    Achievement >= 1.1, "Excellent! Sales exceeded target by " & FORMAT(Achievement - 1, "0%") & ".",
    Achievement >= 1.0, "Target achieved! Sales met expectations.",
    Achievement >= 0.9, "Close to target. Sales are at " & FORMAT(Achievement, "0%") & " of goal.",
    "Below target. Immediate action needed to reach " & FORMAT(Target, "$#,##0") & " goal."
)
```

## Formatting Smart Narratives

```json
{
  "formatting": {
    "general": {
      "font": {
        "family": "Segoe UI",
        "size": 12
      },
      "color": "#333333"
    },
    "emphasis": {
      "positive": {
        "color": "#107C10",
        "bold": true
      },
      "negative": {
        "color": "#D83B01",
        "bold": true
      },
      "neutral": {
        "color": "#0078D4",
        "bold": false
      }
    },
    "numbers": {
      "style": "currency",
      "decimals": 0,
      "thousandsSeparator": true
    }
  }
}
```

## Combining with Q&A

Enable natural language queries alongside narratives:

```json
{
  "linguisticSchema": {
    "entities": [
      {
        "name": "Sales",
        "terms": ["revenue", "income", "sales amount"],
        "measures": ["Total Sales", "Average Sale"]
      },
      {
        "name": "Products",
        "terms": ["items", "goods", "merchandise"],
        "attributes": ["Category", "Name", "Price"]
      }
    ],
    "relationships": [
      {
        "from": "Sales",
        "to": "Products",
        "terms": ["of", "for", "by"]
      }
    ]
  }
}
```

## Embedding Narratives in Paginated Reports

```xml
<!-- Paginated report with dynamic narrative -->
<Textbox Name="NarrativeSummary">
  <CanGrow>true</CanGrow>
  <Paragraphs>
    <Paragraph>
      <TextRuns>
        <TextRun>
          <Value>=
            "This report covers sales data from " &amp;
            Format(Parameters!StartDate.Value, "MMMM d, yyyy") &amp;
            " to " &amp;
            Format(Parameters!EndDate.Value, "MMMM d, yyyy") &amp;
            ". Total revenue was " &amp;
            Format(Sum(Fields!Revenue.Value, "SalesDataset"), "C0") &amp;
            " across " &amp;
            CountDistinct(Fields!CustomerID.Value, "SalesDataset") &amp;
            " customers."
          </Value>
          <Style>
            <FontSize>12pt</FontSize>
          </Style>
        </TextRun>
      </TextRuns>
    </Paragraph>
  </Paragraphs>
</Textbox>
```

## API Integration

Generate narratives programmatically:

```python
import requests

class SmartNarrativeGenerator:
    def __init__(self, access_token: str):
        self.base_url = "https://api.powerbi.com/v1.0/myorg"
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

    def generate_summary(self, dataset_id: str, visual_config: dict):
        """Generate a summary for the given visual configuration."""
        # Execute DAX query to get data
        dax_query = self._build_summary_query(visual_config)
        result = self._execute_query(dataset_id, dax_query)

        # Generate narrative from results
        narrative = self._create_narrative(result, visual_config)
        return narrative

    def _create_narrative(self, data: dict, config: dict) -> str:
        """Create natural language narrative from data."""
        total = data.get("total", 0)
        previous = data.get("previous", 0)
        change = (total - previous) / previous if previous else 0

        parts = []

        # Summary
        parts.append(f"Total {config['metric_name']} reached {total:,.0f}")

        # Trend
        if change > 0:
            parts.append(f"an increase of {change:.1%} from the previous period")
        elif change < 0:
            parts.append(f"a decrease of {abs(change):.1%} from the previous period")

        # Top performer
        if data.get("top_category"):
            parts.append(f"{data['top_category']} was the top performer")

        return ", ".join(parts) + "."
```

Smart narratives transform raw data into understandable stories, making Power BI reports more accessible to all users regardless of their analytical expertise.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
