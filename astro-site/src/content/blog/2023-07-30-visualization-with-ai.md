---
title: "AI-Powered Visualization: Creating Charts with Natural Language"
author: Michael John Peña
draft: false
date: 2023-07-30
tags:
  - AI
  - Data Visualization
  - ChatGPT
  - Charts
---

Visualization has always required a combination of skills that rarely all sit in the same person: data access, statistical understanding, and design sensibility. Code Interpreter and AI assistants are shifting the bottleneck. I've been using ChatGPT's Code Interpreter to generate matplotlib and seaborn charts from uploaded datasets this week — you describe what you want in plain language ("a line chart of monthly revenue with a 90-day rolling average overlaid, colour the rolling average in orange, and include a shaded confidence interval"), and it writes, executes, and renders the Python. The output often needs iteration, but the iteration is natural language rather than hunting through matplotlib documentation for the right parameter name. For exploratory work where you're generating twenty chart variants to find the right framing, this is genuinely faster than manually coding each one.

## The AI Visualization Advantage

```python
# Benefits of AI-assisted visualization
benefits = {
    "accessibility": "No coding or design expertise required",
    "speed": "Quick iteration on chart designs",
    "best_practices": "AI applies visualization principles",
    "customization": "Natural language adjustments",
    "variety": "Access to many chart types"
}

# Common visualization tasks AI can help with
tasks = [
    "Choosing the right chart type",
    "Customizing colors and themes",
    "Adding annotations and highlights",
    "Creating multi-panel dashboards",
    "Generating publication-ready figures"
]
```

## Chart Type Selection Prompts

### Asking for Recommendations

```markdown
**Prompt:**
"I have data showing:
- Monthly sales figures for 2022-2023
- Broken down by 4 product categories
- I want to show the trend over time AND category comparison

What chart type would you recommend and why?
Please create the visualization."

**AI Response Will Include:**
- Chart type recommendation (e.g., stacked area or multi-line)
- Reasoning for the choice
- The actual visualization
- Alternatives to consider
```

### Comparison Charts

```markdown
**Prompt:**
"Create a chart comparing regional sales performance:
- 5 regions: North, South, East, West, Central
- Metrics: Revenue, Units Sold, Customer Count
- Goal: Identify best and worst performing regions

Use a chart type that makes comparison easy.
Add a clear title and legend."
```

### Distribution Charts

```markdown
**Prompt:**
"Visualize the distribution of customer order values:
- Data: 10,000 order amounts
- Show the shape of the distribution
- Mark the mean, median, and key percentiles
- Identify if there are any unusual patterns
- Use a clean, professional style"
```

## Customization Prompts

### Color Schemes

```markdown
**Basic:**
"Create a bar chart of sales by category"

**With Color Specification:**
"Create a bar chart of sales by category using:
- A blue gradient color scheme
- Lightest for lowest values, darkest for highest
- Color-blind friendly palette
- Corporate style suitable for board presentation"
```

### Annotations

```markdown
**Prompt:**
"Create a line chart of monthly revenue with:
- Highlight the peak month with a marker and label
- Add a horizontal line showing the annual average
- Annotate any months below target (< $50,000)
- Include a text box explaining the Q2 dip"
```

### Styling

```markdown
**Prompt:**
"Create a professional visualization with:
- Clean, minimal design (no gridlines, minimal borders)
- Title: '2023 Sales Performance Overview'
- Subtitle: 'Q1-Q3 Regional Breakdown'
- Source attribution at bottom
- Company colors: #1E3A8A (primary), #3B82F6 (secondary)
- Sans-serif font throughout
- Export at high resolution for print"
```

## Complex Visualizations

### Dashboard Layout

```markdown
**Prompt:**
"Create a dashboard-style figure with 4 panels:

Top Row:
1. Left: Big number KPI showing total revenue with YoY change
2. Right: Donut chart of revenue by category

Bottom Row:
3. Left: Line chart of monthly trend
4. Right: Horizontal bar chart of top 10 products

Requirements:
- Consistent styling across panels
- Aligned titles and labels
- Shared color scheme
- Overall title: 'Sales Dashboard - Q3 2023'
- Figure size suitable for widescreen presentation"
```

### Small Multiples

```markdown
**Prompt:**
"Create small multiples showing sales trends:
- One mini chart per region (5 regions)
- Same scale for comparability
- Highlight overall trend line in each
- 2 rows x 3 columns layout
- Subtle gridlines for alignment
- Clear region labels above each chart"
```

### Combined Charts

```markdown
**Prompt:**
"Create a combination chart:
- Primary axis: Bar chart showing monthly revenue
- Secondary axis: Line chart showing profit margin %
- Time period: Jan 2023 - Dec 2023
- Clear legend distinguishing the two metrics
- Axis labels formatted appropriately ($K for revenue, % for margin)
- Title: 'Revenue and Profitability Trends'"
```

## Iterative Refinement

### Initial Request

```markdown
"Create a scatter plot showing customer age vs. purchase amount"
```

### Refinement 1

```markdown
"Good, but please:
- Add a trend line with R-squared value
- Color points by customer segment
- Increase point transparency (alpha=0.5)
- Make the x-axis start at 18"
```

### Refinement 2

```markdown
"Almost perfect. Now:
- Add 95% confidence band around trend line
- Put legend outside the plot area
- Remove top and right spines
- Add subtle gridlines on y-axis only"
```

### Final Polish

```markdown
"Great! Final touches:
- Increase font sizes for presentation (title=16, labels=12)
- Save as high-DPI PNG (300dpi)
- Also provide the matplotlib code for future reference"
```

## Industry-Specific Visualizations

### Financial

```markdown
**Prompt:**
"Create a financial performance chart:
- Waterfall chart showing bridge from last year revenue to this year
- Components: Volume change, Price change, Mix change, New products
- Use standard waterfall conventions (green=positive, red=negative)
- Show cumulative values at each step
- Professional financial reporting style"
```

### Scientific

```markdown
**Prompt:**
"Create a publication-quality figure:
- Error bars showing standard deviation
- Statistical significance markers (*p<0.05, **p<0.01)
- Panel labels (A, B, C, D)
- Journal figure dimensions (single column: 3.5in width)
- Vector format (SVG) for scalability"
```

### Marketing

```markdown
**Prompt:**
"Create a funnel visualization:
- Stages: Awareness, Interest, Consideration, Purchase
- Show counts and conversion rates at each stage
- Percentage labels between stages
- Visually compelling with gradient colors
- Title: 'Customer Journey Analysis'"
```

## Prompt Templates

```python
# Comprehensive visualization prompt template
viz_prompt_template = """
[Data Description]
I have data showing: {describe your data}
Number of records: {count}
Key columns: {list relevant columns}

[Visualization Goal]
I want to show: {what insight/story}
Audience: {who will see this}
Context: {where it will be used - presentation/report/dashboard}

[Chart Specifications]
Chart type: {specific type or "recommend based on data"}
Color scheme: {brand colors/palette/preference}
Style: {minimal/detailed/corporate/casual}

[Required Elements]
- Title: {specific title or "generate appropriate"}
- Annotations: {any specific callouts}
- Legend: {position preference}
- Axis formatting: {any specific formats}

[Output Requirements]
- Size: {dimensions or context like "slide presentation"}
- Format: {PNG/SVG/interactive}
- Also provide: {code/explanation/alternatives}
"""
```

## Best Practices

```python
best_practices = {
    "clarity": "One main message per visualization",
    "honesty": "Don't distort data with axis manipulation",
    "accessibility": "Use color-blind friendly palettes",
    "context": "Include necessary labels and legends",
    "simplicity": "Remove unnecessary chart junk",
    "consistency": "Maintain style across related charts"
}
```

Tomorrow we'll explore file processing patterns with AI.

## Resources

- [Data Visualization Best Practices](https://www.tableau.com/learn/articles/data-visualization-tips)
- [Color Brewer](https://colorbrewer2.org/) - Color schemes for maps and charts
- [Matplotlib Gallery](https://matplotlib.org/stable/gallery/index.html)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
