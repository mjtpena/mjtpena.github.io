---
title: "Microsoft 365 Development: Building Productivity Apps"
author: Michael John Peña
draft: false
date: 2022-05-13
tags:
  - microsoft-365
  - Azure
  - office-addins
  - sharepoint
---

## Office Add-ins Overview

Office Add-ins use web technologies and run across platforms:

```bash
# Install Yeoman generator
npm install -g yo generator-office

# Create Excel add-in
yo office --projectType taskpane --name "MyExcelAddin" --host excel --ts true

# Create Word add-in
yo office --projectType taskpane --name "MyWordAddin" --host word --ts true
```

## Excel Add-in

Create an Excel add-in for data analysis:

```typescript
// src/taskpane/taskpane.ts
Office.onReady((info) => {
  if (info.host === Office.HostType.Excel) {
    document.getElementById("analyze-btn")!.onclick = analyzeData;
    document.getElementById("chart-btn")!.onclick = createChart;
  }
});

async function analyzeData(): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();
    const range = sheet.getUsedRange();
    range.load("values");

    await context.sync();

    const values = range.values;

    // Calculate statistics
    const numericValues = values
      .flat()
      .filter((v) => typeof v === "number") as number[];

    const stats = {
      count: numericValues.length,
      sum: numericValues.reduce((a, b) => a + b, 0),
      average: 0,
      min: Math.min(...numericValues),
      max: Math.max(...numericValues),
    };
    stats.average = stats.sum / stats.count;

    // Write results to new sheet
    const resultsSheet = context.workbook.worksheets.add("Analysis Results");

    const resultsRange = resultsSheet.getRange("A1:B5");
    resultsRange.values = [
      ["Metric", "Value"],
      ["Count", stats.count],
      ["Sum", stats.sum],
      ["Average", stats.average],
      ["Min", stats.min],
    ];

    resultsRange.format.autofitColumns();

    const headerRange = resultsSheet.getRange("A1:B1");
    headerRange.format.font.bold = true;
    headerRange.format.fill.color = "#4472C4";
    headerRange.format.font.color = "white";

    await context.sync();
  });
}

async function createChart(): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();
    const dataRange = sheet.getUsedRange();

    const chart = sheet.charts.add(
      Excel.ChartType.columnClustered,
      dataRange,
      Excel.ChartSeriesBy.auto
    );

    chart.title.text = "Data Analysis Chart";
    chart.legend.position = Excel.ChartLegendPosition.right;
    chart.setPosition("E2", "L15");

    await context.sync();
  });
}

async function formatTable(): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();
    const range = sheet.getUsedRange();

    // Create table
    const table = sheet.tables.add(range, true);
    table.name = "DataTable";
    table.style = "TableStyleMedium2";

    // Add conditional formatting
    const conditionalFormat = range.conditionalFormats.add(
      Excel.ConditionalFormatType.colorScale
    );

    conditionalFormat.colorScale.criteria = {
      minimum: {
        type: Excel.ConditionalFormatColorCriterionType.lowestValue,
        color: "#FF6B6B",
      },
      midpoint: {
        type: Excel.ConditionalFormatColorCriterionType.percentile,
        value: 50,
        color: "#FFE66D",
      },
      maximum: {
        type: Excel.ConditionalFormatColorCriterionType.highestValue,
        color: "#4ECDC4",
      },
    };

    await context.sync();
  });
}
```

## Word Add-in

Create a Word add-in for document processing:

```typescript
// src/taskpane/word-taskpane.ts
Office.onReady((info) => {
  if (info.host === Office.HostType.Word) {
    document.getElementById("insert-btn")!.onclick = insertContent;
    document.getElementById("analyze-btn")!.onclick = analyzeDocument;
  }
});

async function insertContent(): Promise<void> {
  await Word.run(async (context) => {
    const selection = context.document.getSelection();

    // Insert formatted content
    selection.insertHtml(
      `
      <h1>Document Title</h1>
      <p>This is a paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
      <ul>
        <li>Item 1</li>
        <li>Item 2</li>
        <li>Item 3</li>
      </ul>
    `,
      Word.InsertLocation.replace
    );

    await context.sync();
  });
}

async function analyzeDocument(): Promise<void> {
  await Word.run(async (context) => {
    const body = context.document.body;
    body.load("text");

    const paragraphs = body.paragraphs;
    paragraphs.load("items");

    await context.sync();

    const text = body.text;
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    const charCount = text.length;
    const paragraphCount = paragraphs.items.length;

    // Calculate reading time (200 words per minute)
    const readingTime = Math.ceil(wordCount / 200);

    // Display results
    const results = document.getElementById("results")!;
    results.innerHTML = `
      <h3>Document Statistics</h3>
      <p>Words: ${wordCount}</p>
      <p>Characters: ${charCount}</p>
      <p>Paragraphs: ${paragraphCount}</p>
      <p>Reading Time: ~${readingTime} minutes</p>
    `;
  });
}

async function searchAndHighlight(searchText: string): Promise<void> {
  await Word.run(async (context) => {
    const body = context.document.body;
    const searchResults = body.search(searchText, {
      matchCase: false,
      matchWholeWord: false,
    });

    searchResults.load("items");
    await context.sync();

    for (const result of searchResults.items) {
      result.font.highlightColor = "yellow";
      result.font.bold = true;
    }

    await context.sync();
  });
}

async function insertTable(): Promise<void> {
  await Word.run(async (context) => {
    const selection = context.document.getSelection();

    const tableData = [
      ["Name", "Department", "Email"],
      ["John Doe", "Engineering", "john@example.com"],
      ["Jane Smith", "Marketing", "jane@example.com"],
      ["Bob Johnson", "Sales", "bob@example.com"],
    ];

    const table = selection.insertTable(
      tableData.length,
      tableData[0].length,
      Word.InsertLocation.after,
      tableData
    );

    table.styleBuiltIn = Word.Style.gridTable5Dark_Accent1;

    await context.sync();
  });
}
```

## Outlook Add-in

Create an Outlook add-in for email processing:

```typescript
// src/taskpane/outlook-taskpane.ts
Office.onReady((info) => {
  if (info.host === Office.HostType.Outlook) {
    loadEmailData();
    document.getElementById("save-btn")!.onclick = saveToSystem;
  }
});

async function loadEmailData(): Promise<void> {
  const item = Office.context.mailbox.item;

  if (!item) return;

  // Load basic properties
  const subject = item.subject;
  const from = item.from?.emailAddress;

  // Get recipients
  item.to.getAsync((result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded) {
      const recipients = result.value.map((r) => r.emailAddress).join(", ");
      document.getElementById("to-field")!.textContent = recipients;
    }
  });

  // Get body
  item.body.getAsync(Office.CoercionType.Text, (result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded) {
      document.getElementById("body-preview")!.textContent =
        result.value.substring(0, 500) + "...";
    }
  });

  // Get attachments
  if (item.attachments && item.attachments.length > 0) {
    const attachmentList = item.attachments
      .map((a) => `<li>${a.name} (${formatBytes(a.size)})</li>`)
      .join("");
    document.getElementById(
      "attachments"
    )!.innerHTML = `<ul>${attachmentList}</ul>`;
  }

  document.getElementById("subject")!.textContent = subject;
  document.getElementById("from")!.textContent = from || "Unknown";
}

async function saveToSystem(): Promise<void> {
  const item = Office.context.mailbox.item;

  if (!item) return;

  item.body.getAsync(Office.CoercionType.Html, async (result) => {
    if (result.status === Office.AsyncResultStatus.Succeeded) {
      const emailData = {
        subject: item.subject,
        from: item.from?.emailAddress,
        body: result.value,
        receivedDate: item.dateTimeCreated,
      };

      // Send to your API
      try {
        const response = await fetch("https://api.example.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(emailData),
        });

        if (response.ok) {
          showNotification("Success", "Email saved to system");
        }
      } catch (error) {
        showNotification("Error", "Failed to save email");
      }
    }
  });
}

function showNotification(title: string, message: string): void {
  Office.context.mailbox.item?.notificationMessages.addAsync("notification", {
    type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
    message: message,
    icon: "icon-16",
    persistent: false,
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
```

## SharePoint Framework (SPFx)

Build SharePoint web parts:

```typescript
// src/webparts/dataViewer/DataViewerWebPart.ts
import { Version } from "@microsoft/sp-core-library";
import {
  IPropertyPaneConfiguration,
  PropertyPaneTextField,
} from "@microsoft/sp-property-pane";
import { BaseClientSideWebPart } from "@microsoft/sp-webpart-base";
import { SPHttpClient, SPHttpClientResponse } from "@microsoft/sp-http";
import styles from "./DataViewerWebPart.module.scss";

export interface IDataViewerWebPartProps {
  listName: string;
}

export default class DataViewerWebPart extends BaseClientSideWebPart<IDataViewerWebPartProps> {
  public render(): void {
    this.domElement.innerHTML = `
      <div class="${styles.dataViewer}">
        <h2>List Data Viewer</h2>
        <div id="listData">Loading...</div>
      </div>
    `;

    this.loadListData();
  }

  private async loadListData(): Promise<void> {
    const listName = this.properties.listName || "Documents";

    try {
      const response: SPHttpClientResponse = await this.context.spHttpClient.get(
        `${this.context.pageContext.web.absoluteUrl}/_api/web/lists/getbytitle('${listName}')/items?$top=10`,
        SPHttpClient.configurations.v1
      );

      const data = await response.json();
      this.renderList(data.value);
    } catch (error) {
      this.domElement.querySelector("#listData")!.innerHTML =
        "Error loading data";
    }
  }

  private renderList(items: any[]): void {
    const html = items
      .map(
        (item) => `
      <div class="${styles.listItem}">
        <span class="${styles.title}">${item.Title || item.FileLeafRef}</span>
        <span class="${styles.date}">${new Date(item.Modified).toLocaleDateString()}</span>
      </div>
    `
      )
      .join("");

    this.domElement.querySelector("#listData")!.innerHTML =
      html || "No items found";
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: { description: "Configuration" },
          groups: [
            {
              groupName: "Settings",
              groupFields: [
                PropertyPaneTextField("listName", {
                  label: "List Name",
                  description: "Enter the name of the SharePoint list",
                }),
              ],
            },
          ],
        },
      ],
    };
  }

  protected get dataVersion(): Version {
    return Version.parse("1.0");
  }
}
```

## Summary

Microsoft 365 development offers:

- Cross-platform Office Add-ins
- SharePoint Framework for portals
- Rich APIs for document manipulation
- Integration with Microsoft Graph
- Marketplace distribution

Build productivity-enhancing solutions that integrate seamlessly with Microsoft 365.
