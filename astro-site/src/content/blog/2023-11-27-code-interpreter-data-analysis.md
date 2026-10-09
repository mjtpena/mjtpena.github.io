---
title: "Code Interpreter: AI-Powered Data Analysis"
description: "Code Interpreter (Advanced Data Analysis) is the single most productive AI tool I've used for exploratory analysis — it runs Python in a sandbox, opens…"
author: "Michael John Peña"
draft: false
date: 2023-11-27
tags: ["OpenAI", "Code Interpreter", "Data Analysis", "Python", "AI"]
---

Code Interpreter (Advanced Data Analysis) is the single most productive AI tool I've used for exploratory analysis — it runs Python in a sandbox, opens uploaded files, produces visualisations, and returns reproducible scripts. For workflows where an analyst formerly iterated locally on CSVs and notebooks, Code Interpreter compresses that loop into a single conversation: upload a file, ask a question, and get back plots, summary statistics and actionable insights. It's not a replacement for rigorous production data engineering, but for rapid prototyping and insight discovery it's transformative.

## Understanding Code Interpreter

## Understanding Code Interpreter

```python
from openai import OpenAI
from typing import List, Dict, Optional
import json

class CodeInterpreterAssistant:
    """Assistant with code interpreter capabilities."""

    def __init__(self, client: OpenAI):
        self.client = client

    def create_data_analyst(self) -> str:
        """Create a data analysis assistant."""
        assistant = self.client.beta.assistants.create(
            name="Data Analyst",
            instructions="""You are an expert data analyst.
            When given data:
            1. First explore and understand the data structure
            2. Perform requested analysis
            3. Create clear visualizations
            4. Provide actionable insights

            Guidelines:
            - Always handle missing data appropriately
            - Use pandas for data manipulation
            - Use matplotlib/seaborn for visualizations
            - Include statistical significance where relevant
            - Explain findings in business terms""",
            model="gpt-4-1106-preview",
            tools=[{"type": "code_interpreter"}]
        )
        return assistant.id

    def analyze_file(
        self,
        assistant_id: str,
        file_path: str,
        analysis_prompt: str
    ) -> Dict:
        """Upload a file and run analysis."""
        # Upload file
        with open(file_path, "rb") as f:
            file = self.client.files.create(file=f, purpose="assistants")

        # Create thread with file
        thread = self.client.beta.threads.create()
        self.client.beta.threads.messages.create(
            thread_id=thread.id,
            role="user",
            content=analysis_prompt,
            file_ids=[file.id]
        )

        # Run analysis
        run = self.client.beta.threads.runs.create(
            thread_id=thread.id,
            assistant_id=assistant_id
        )

        # Wait for completion
        import time
        while run.status in ["queued", "in_progress"]:
            time.sleep(1)
            run = self.client.beta.threads.runs.retrieve(
                thread_id=thread.id,
                run_id=run.id
            )

        # Get results
        messages = self.client.beta.threads.messages.list(thread_id=thread.id)

        return {
            "thread_id": thread.id,
            "run_id": run.id,
            "status": run.status,
            "response": self._parse_response(messages)
        }

    def _parse_response(self, messages) -> Dict:
        """Parse the assistant response including code and files."""
        result = {
            "text": [],
            "code_blocks": [],
            "generated_files": []
        }

        for message in messages.data:
            if message.role != "assistant":
                continue

            for content in message.content:
                if content.type == "text":
                    result["text"].append(content.text.value)

                    # Extract code blocks from annotations
                    for annotation in content.text.annotations:
                        if annotation.type == "file_path":
                            result["generated_files"].append({
                                "file_id": annotation.file_path.file_id,
                                "reference": annotation.text
                            })

                elif content.type == "image_file":
                    result["generated_files"].append({
                        "file_id": content.image_file.file_id,
                        "type": "image"
                    })

        return result
```

## Practical Analysis Examples

```python
class DataAnalysisWorkflows:
    """Pre-built analysis workflows using code interpreter."""

    def __init__(self, client: OpenAI, assistant_id: str):
        self.client = client
        self.assistant_id = assistant_id
        self.ci = CodeInterpreterAssistant(client)

    def exploratory_analysis(self, file_path: str) -> Dict:
        """Run exploratory data analysis."""
        prompt = """Perform a comprehensive exploratory data analysis:

        1. Data Overview:
           - Shape, columns, data types
           - Missing values summary
           - Unique values per column

        2. Statistical Summary:
           - Descriptive statistics for numeric columns
           - Value counts for categorical columns

        3. Visualizations:
           - Distribution plots for numeric columns
           - Correlation heatmap
           - Bar charts for categorical columns

        4. Key Findings:
           - Summarize the most important insights
           - Flag any data quality issues"""

        return self.ci.analyze_file(self.assistant_id, file_path, prompt)

    def sales_analysis(self, file_path: str) -> Dict:
        """Analyze sales data."""
        prompt = """Analyze this sales data and provide:

        1. Revenue Analysis:
           - Total revenue by period (month/quarter)
           - Revenue by product category
           - Revenue by region/segment

        2. Trend Analysis:
           - Month-over-month growth
           - Seasonal patterns
           - Year-over-year comparison if applicable

        3. Top Performers:
           - Top 10 products by revenue
           - Top 10 customers
           - Best performing regions

        4. Visualizations:
           - Revenue trend line chart
           - Category breakdown pie chart
           - Regional heatmap

        5. Recommendations:
           - Areas for improvement
           - Growth opportunities"""

        return self.ci.analyze_file(self.assistant_id, file_path, prompt)

    def customer_segmentation(self, file_path: str) -> Dict:
        """Perform customer segmentation analysis."""
        prompt = """Perform customer segmentation analysis:

        1. RFM Analysis (if applicable):
           - Calculate Recency, Frequency, Monetary scores
           - Segment customers into groups

        2. Clustering:
           - Use K-means or similar algorithm
           - Determine optimal number of clusters
           - Visualize clusters

        3. Segment Profiles:
           - Describe each segment characteristics
           - Size of each segment
           - Average metrics per segment

        4. Recommendations:
           - Marketing strategies per segment
           - Retention priorities"""

        return self.ci.analyze_file(self.assistant_id, file_path, prompt)

    def anomaly_detection(self, file_path: str, target_column: str) -> Dict:
        """Detect anomalies in data."""
        prompt = f"""Analyze the '{target_column}' column for anomalies:

        1. Statistical Methods:
           - Z-score analysis
           - IQR method
           - Moving average deviation

        2. Visualization:
           - Time series plot with anomalies highlighted
           - Box plot showing outliers

        3. Anomaly Summary:
           - List all detected anomalies
           - Severity classification
           - Potential causes/patterns

        4. Recommendations:
           - Which anomalies require investigation
           - Suggested thresholds for monitoring"""

        return self.ci.analyze_file(self.assistant_id, file_path, prompt)
```

## Interactive Analysis Session

```python
class InteractiveAnalysisSession:
    """Manage interactive data analysis sessions."""

    def __init__(self, client: OpenAI, assistant_id: str):
        self.client = client
        self.assistant_id = assistant_id
        self.thread_id = None
        self.file_ids = []

    def start_session(self, file_paths: List[str] = None) -> str:
        """Start a new analysis session."""
        # Upload files if provided
        if file_paths:
            for path in file_paths:
                with open(path, "rb") as f:
                    file = self.client.files.create(file=f, purpose="assistants")
                    self.file_ids.append(file.id)

        # Create thread
        self.thread_id = self.client.beta.threads.create().id

        # Initial context message
        if self.file_ids:
            self.client.beta.threads.messages.create(
                thread_id=self.thread_id,
                role="user",
                content="I've uploaded data files for analysis. Please acknowledge and briefly describe what you see.",
                file_ids=self.file_ids
            )
            self._run_and_wait()

        return self.thread_id

    def ask(self, question: str, file_path: str = None) -> str:
        """Ask a question or request analysis."""
        file_ids = []
        if file_path:
            with open(file_path, "rb") as f:
                file = self.client.files.create(file=f, purpose="assistants")
                file_ids.append(file.id)
                self.file_ids.append(file.id)

        self.client.beta.threads.messages.create(
            thread_id=self.thread_id,
            role="user",
            content=question,
            file_ids=file_ids if file_ids else None
        )

        return self._run_and_wait()

    def _run_and_wait(self) -> str:
        """Run assistant and return response."""
        import time

        run = self.client.beta.threads.runs.create(
            thread_id=self.thread_id,
            assistant_id=self.assistant_id
        )

        while run.status in ["queued", "in_progress"]:
            time.sleep(1)
            run = self.client.beta.threads.runs.retrieve(
                thread_id=self.thread_id,
                run_id=run.id
            )

        messages = self.client.beta.threads.messages.list(
            thread_id=self.thread_id,
            limit=1
        )

        return messages.data[0].content[0].text.value

    def download_outputs(self, output_dir: str = "analysis_output") -> List[str]:
        """Download all generated files from the session."""
        import os
        os.makedirs(output_dir, exist_ok=True)

        messages = self.client.beta.threads.messages.list(thread_id=self.thread_id)
        downloaded = []

        for message in messages.data:
            for content in message.content:
                if content.type == "image_file":
                    file_id = content.image_file.file_id
                    path = os.path.join(output_dir, f"{file_id}.png")
                    content = self.client.files.content(file_id)
                    with open(path, "wb") as f:
                        f.write(content.read())
                    downloaded.append(path)

        return downloaded

# Example usage
"""
session = InteractiveAnalysisSession(client, assistant_id)
session.start_session(["sales_data.csv"])

# Interactive questions
print(session.ask("What's the total revenue by month?"))
print(session.ask("Create a chart showing the trend"))
print(session.ask("Which products are declining in sales?"))
print(session.ask("Predict next month's revenue using linear regression"))

# Download all charts
outputs = session.download_outputs()
"""
```

## Best Practices

1. **Be specific** about the analysis you want
2. **Request visualizations** explicitly
3. **Ask for intermediate steps** to verify methodology
4. **Download generated files** promptly
5. **Use follow-up questions** to drill down into insights

Tomorrow, we'll explore the Retrieval tool for building knowledge-based AI applications!
