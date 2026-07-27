---
title: Power BI Paginated Reports for Operational Reporting
author: Michael John Pena
draft: false
date: 2021-03-12
url: /blog/power-bi-paginated-reports/
tags:
  - Azure
  - Power BI
  - Reporting
  - SSRS
  - Business Intelligence

---

I wrote "2021-03-12-power-bi-paginated-reports" to share practical, production-minded guidance on this topic.

## When to Use Paginated Reports

Paginated reports excel when you need:
- Pixel-perfect formatting for print
- Multi-page documents with headers/footers
- Parameter-driven report generation
- Export to PDF, Word, Excel, CSV
- Legacy SSRS report migration

## Creating Reports with Power BI Report Builder

### Data Source Configuration

```xml
<!-- Data source connection string -->
<DataSource Name="AzureSqlDS">
  <ConnectionProperties>
    <DataProvider>SQL</DataProvider>
    <ConnectString>
      Data Source=myserver.database.windows.net;
      Initial Catalog=SalesDB;
      Authentication=Active Directory Integrated
    </ConnectString>
  </ConnectionProperties>
</DataSource>
```

### Dataset Query

```sql
-- Parameterized query for customer invoices
SELECT
    c.CustomerID,
    c.CustomerName,
    c.Address,
    c.City,
    c.State,
    c.PostalCode,
    c.Country,
    o.OrderID,
    o.OrderDate,
    o.ShipDate,
    p.ProductName,
    p.Category,
    oi.Quantity,
    oi.UnitPrice,
    oi.Quantity * oi.UnitPrice AS LineTotal,
    oi.Discount,
    oi.Quantity * oi.UnitPrice * (1 - oi.Discount) AS NetAmount
FROM Customers c
INNER JOIN Orders o ON c.CustomerID = o.CustomerID
INNER JOIN OrderItems oi ON o.OrderID = oi.OrderID
INNER JOIN Products p ON oi.ProductID = p.ProductID
WHERE c.CustomerID = @CustomerID
  AND o.OrderDate BETWEEN @StartDate AND @EndDate
ORDER BY o.OrderDate, o.OrderID, oi.OrderItemID
```

### Report Parameters

```xml
<ReportParameters>
  <ReportParameter Name="CustomerID">
    <DataType>String</DataType>
    <Prompt>Select Customer</Prompt>
    <ValidValues>
      <DataSetReference>
        <DataSetName>CustomersLookup</DataSetName>
        <ValueField>CustomerID</ValueField>
        <LabelField>CustomerName</LabelField>
      </DataSetReference>
    </ValidValues>
  </ReportParameter>
  <ReportParameter Name="StartDate">
    <DataType>DateTime</DataType>
    <Prompt>Start Date</Prompt>
    <DefaultValue>
      <Values>
        <Value>=DateAdd(DateInterval.Month, -1, Today())</Value>
      </Values>
    </DefaultValue>
  </ReportParameter>
  <ReportParameter Name="EndDate">
    <DataType>DateTime</DataType>
    <Prompt>End Date</Prompt>
    <DefaultValue>
      <Values>
        <Value>=Today()</Value>
      </Values>
    </DefaultValue>
  </ReportParameter>
</ReportParameters>
```

## Expression Examples

### Calculated Fields

```vb
' Line total with discount
=Fields!Quantity.Value * Fields!UnitPrice.Value * (1 - Fields!Discount.Value)

' Running total in group
=RunningValue(Fields!NetAmount.Value, Sum, "OrderGroup")

' Grand total
=Sum(Fields!NetAmount.Value)

' Row number
=RowNumber("OrderDetailsGroup")

' Conditional formatting expression
=IIF(Fields!Discount.Value > 0.1, "Red", "Black")
```

### Page Headers and Footers

```vb
' Page number
="Page " & Globals!PageNumber & " of " & Globals!TotalPages

' Report execution time
=Globals!ExecutionTime

' Current date
=Format(Today(), "MMMM dd, yyyy")

' Parameter display
="Customer: " & Parameters!CustomerID.Label &
" | Period: " & Format(Parameters!StartDate.Value, "MM/dd/yyyy") &
" - " & Format(Parameters!EndDate.Value, "MM/dd/yyyy")
```

### Group Expressions

```vb
' Group header - order summary
="Order #" & Fields!OrderID.Value &
" | Date: " & Format(Fields!OrderDate.Value, "MM/dd/yyyy") &
" | Items: " & CountRows("OrderItemsGroup")

' Group footer - subtotal
="Subtotal: " & Format(Sum(Fields!NetAmount.Value), "C2")
```

## Invoice Template Example

```xml
<!-- Report body structure -->
<Body>
  <!-- Company header -->
  <ReportItems>
    <Image Name="CompanyLogo">
      <Source>External</Source>
      <Value>https://company.com/logo.png</Value>
    </Image>
    <Textbox Name="CompanyName">
      <Value>Contoso Corporation</Value>
      <Style>
        <FontSize>18pt</FontSize>
        <FontWeight>Bold</FontWeight>
      </Style>
    </Textbox>
  </ReportItems>

  <!-- Customer information -->
  <Textbox Name="BillTo">
    <Value>="Bill To:" & vbCrLf &
           Fields!CustomerName.Value & vbCrLf &
           Fields!Address.Value & vbCrLf &
           Fields!City.Value & ", " & Fields!State.Value & " " & Fields!PostalCode.Value</Value>
  </Textbox>

  <!-- Invoice details table -->
  <Tablix Name="InvoiceDetails">
    <TablixBody>
      <TablixColumns>
        <TablixColumn><Width>2in</Width></TablixColumn>
        <TablixColumn><Width>1in</Width></TablixColumn>
        <TablixColumn><Width>1in</Width></TablixColumn>
        <TablixColumn><Width>1in</Width></TablixColumn>
        <TablixColumn><Width>1in</Width></TablixColumn>
      </TablixColumns>
      <TablixRows>
        <!-- Header row -->
        <TablixRow>
          <TablixCells>
            <TablixCell><CellContents><Textbox><Value>Product</Value></Textbox></CellContents></TablixCell>
            <TablixCell><CellContents><Textbox><Value>Qty</Value></Textbox></CellContents></TablixCell>
            <TablixCell><CellContents><Textbox><Value>Unit Price</Value></Textbox></CellContents></TablixCell>
            <TablixCell><CellContents><Textbox><Value>Discount</Value></Textbox></CellContents></TablixCell>
            <TablixCell><CellContents><Textbox><Value>Amount</Value></Textbox></CellContents></TablixCell>
          </TablixCells>
        </TablixRow>
        <!-- Detail row -->
        <TablixRow>
          <TablixCells>
            <TablixCell><CellContents><Textbox><Value>=Fields!ProductName.Value</Value></Textbox></CellContents></TablixCell>
            <TablixCell><CellContents><Textbox><Value>=Fields!Quantity.Value</Value></Textbox></CellContents></TablixCell>
            <TablixCell><CellContents><Textbox><Value>=Format(Fields!UnitPrice.Value, "C2")</Value></Textbox></CellContents></TablixCell>
            <TablixCell><CellContents><Textbox><Value>=Format(Fields!Discount.Value, "P0")</Value></Textbox></CellContents></TablixCell>
            <TablixCell><CellContents><Textbox><Value>=Format(Fields!NetAmount.Value, "C2")</Value></Textbox></CellContents></TablixCell>
          </TablixCells>
        </TablixRow>
      </TablixRows>
    </TablixBody>
  </Tablix>

  <!-- Totals section -->
  <Textbox Name="GrandTotal">
    <Value>="Grand Total: " & Format(Sum(Fields!NetAmount.Value, "InvoiceDataset"), "C2")</Value>
    <Style>
      <FontSize>14pt</FontSize>
      <FontWeight>Bold</FontWeight>
      <TextAlign>Right</TextAlign>
    </Style>
  </Textbox>
</Body>
```

## Programmatic Report Generation

```csharp
// Generate reports programmatically using Power BI REST API
using System.Net.Http;
using System.Text.Json;

public class PaginatedReportService
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl = "https://api.powerbi.com/v1.0/myorg";

    public PaginatedReportService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<byte[]> ExportReportAsync(
        string groupId,
        string reportId,
        string format,
        Dictionary<string, string> parameters)
    {
        // Start export
        var exportRequest = new
        {
            format = format, // PDF, XLSX, DOCX, CSV, PPTX, PNG
            paginatedReportConfiguration = new
            {
                parameterValues = parameters.Select(p => new
                {
                    name = p.Key,
                    value = p.Value
                }).ToArray()
            }
        };

        var response = await _httpClient.PostAsJsonAsync(
            $"{_baseUrl}/groups/{groupId}/reports/{reportId}/ExportTo",
            exportRequest);

        var exportResult = await response.Content.ReadFromJsonAsync<ExportResult>();

        // Poll for completion
        while (exportResult.Status != "Succeeded")
        {
            await Task.Delay(5000);

            var statusResponse = await _httpClient.GetAsync(
                $"{_baseUrl}/groups/{groupId}/reports/{reportId}/exports/{exportResult.Id}");

            exportResult = await statusResponse.Content.ReadFromJsonAsync<ExportResult>();

            if (exportResult.Status == "Failed")
            {
                throw new Exception($"Export failed: {exportResult.Error}");
            }
        }

        // Download the file
        var fileResponse = await _httpClient.GetAsync(
            $"{_baseUrl}/groups/{groupId}/reports/{reportId}/exports/{exportResult.Id}/file");

        return await fileResponse.Content.ReadAsByteArrayAsync();
    }

    public async Task<string> GenerateInvoicesAsync(
        string groupId,
        string reportId,
        string[] customerIds,
        DateTime startDate,
        DateTime endDate)
    {
        var outputPath = Path.Combine(Path.GetTempPath(), "invoices");
        Directory.CreateDirectory(outputPath);

        foreach (var customerId in customerIds)
        {
            var parameters = new Dictionary<string, string>
            {
                ["CustomerID"] = customerId,
                ["StartDate"] = startDate.ToString("yyyy-MM-dd"),
                ["EndDate"] = endDate.ToString("yyyy-MM-dd")
            };

            var pdfBytes = await ExportReportAsync(groupId, reportId, "PDF", parameters);

            var fileName = $"Invoice_{customerId}_{startDate:yyyyMMdd}_{endDate:yyyyMMdd}.pdf";
            await File.WriteAllBytesAsync(Path.Combine(outputPath, fileName), pdfBytes);
        }

        return outputPath;
    }
}

public class ExportResult
{
    public string Id { get; set; }
    public string Status { get; set; }
    public string Error { get; set; }
}
```

## Subreports for Complex Documents

```vb
' Main report calls subreport with parameters
<Subreport Name="OrderDetailsSubreport">
  <ReportName>OrderDetails</ReportName>
  <Parameters>
    <Parameter Name="OrderID">
      <Value>=Fields!OrderID.Value</Value>
    </Parameter>
  </Parameters>
</Subreport>

' Subreport query
SELECT
    oi.OrderItemID,
    p.ProductName,
    p.SKU,
    oi.Quantity,
    oi.UnitPrice,
    oi.Discount,
    oi.Quantity * oi.UnitPrice * (1 - oi.Discount) AS LineTotal
FROM OrderItems oi
INNER JOIN Products p ON oi.ProductID = p.ProductID
WHERE oi.OrderID = @OrderID
ORDER BY oi.OrderItemID
```

## Best Practices

1. **Optimize Queries**: Push filtering to the database level
2. **Use Stored Procedures**: For complex data retrieval
3. **Limit Data Volume**: Paginated reports aren't for big data exploration
4. **Cache Parameters**: Use cascading parameters efficiently
5. **Test Print Layout**: Always verify print output before deployment

## Conclusion

Paginated reports fill a critical gap in modern BI platforms. They're essential for:
- Legal and compliance documents
- Financial statements and invoices
- Operational reports with precise formatting
- Bulk document generation

Combined with Power BI's interactive reports, you have a complete enterprise reporting solution.

