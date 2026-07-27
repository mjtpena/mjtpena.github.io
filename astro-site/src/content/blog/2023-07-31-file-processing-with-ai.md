---
title: "File Processing with AI: Automating Data Workflows"
author: Michael John Peña
draft: false
date: 2023-07-31
tags:
  - AI
  - File Processing
  - Data Engineering
  - Automation
---

File processing — extracting structured data from PDFs, converting between formats, parsing inconsistent CSVs, pulling content from Excel sheets with non-standard layouts — is unglamorous data engineering work that consumes more hours than most teams admit. Code Interpreter makes a class of these tasks much more approachable: upload the file, describe the extraction problem in natural language, and let the model generate and execute the parsing code. I've had it successfully extract tables from PDFs with inconsistent column positions using `pdfplumber`, parse Excel files where the header row starts on row 4 (not row 0), and clean CSVs with mixed date formats across rows. It won't replace a production-grade document intelligence pipeline for high-volume or compliance-sensitive processing — Azure Document Intelligence (Form Recogniser) is still the right tool there — but for one-off data archaeology tasks, it's saved me hours this month.

## File Processing Capabilities

```python
# What AI can do with files
capabilities = {
    "data_files": {
        "csv": "Read, analyze, transform, export",
        "excel": "Multi-sheet processing, formulas extraction",
        "json": "Parse, flatten, restructure",
        "parquet": "Read and convert",
        "xml": "Parse and extract data"
    },
    "documents": {
        "pdf": "Extract text and tables",
        "text": "Parse, clean, structure",
        "markdown": "Generate and format"
    },
    "images": {
        "charts": "Digitize data from chart images",
        "screenshots": "Extract information",
        "diagrams": "Describe and analyze"
    }
}
```

## Pattern 1: Format Conversion

### CSV to JSON

```markdown
**Prompt:**
"I'm uploading a CSV file with customer data.
Please:
1. Convert it to JSON format
2. Use camelCase for keys (customer_id -> customerId)
3. Group records by region into nested structure
4. Validate that all required fields are present
5. Provide the JSON file for download"
```

### Excel to CSV

```markdown
**Prompt:**
"Process this Excel file:
- Sheet 'Q1 Sales' contains data
- Skip the first 3 rows (headers start at row 4)
- Columns A-F contain the relevant data
- Convert date columns to YYYY-MM-DD format
- Replace empty cells with 'N/A'
- Export as UTF-8 CSV"
```

### Flattening Nested JSON

```markdown
**Prompt:**
"I have a JSON file with nested structure:
{
  'orders': [
    {
      'id': 1,
      'customer': {'name': '...', 'address': {...}},
      'items': [{'product': '...', 'qty': 1}, ...]
    }
  ]
}

Please:
1. Flatten to tabular format
2. One row per order-item combination
3. Use dot notation for nested fields (customer.name)
4. Export as CSV"
```

## Pattern 2: Data Cleaning Automation

### Standardization

```markdown
**Prompt:**
"Clean this customer data file:

1. Names:
   - Convert to Title Case
   - Remove extra whitespace
   - Handle 'Mr.', 'Mrs.', etc. prefixes

2. Phone Numbers:
   - Standardize to format: (XXX) XXX-XXXX
   - Mark invalid numbers as 'INVALID'

3. Addresses:
   - Expand abbreviations (St -> Street, Ave -> Avenue)
   - Standardize state codes

4. Emails:
   - Convert to lowercase
   - Validate format
   - Flag potentially invalid emails

Provide a cleaned file and a summary of changes made."
```

### Deduplication

```markdown
**Prompt:**
"Find and handle duplicates in this customer file:

1. Identify exact duplicates (all fields match)
2. Identify potential duplicates:
   - Same email
   - Same name + phone
   - Similar names (fuzzy match)

3. For each duplicate set:
   - Keep the most recent record
   - Merge non-empty fields where possible

4. Provide:
   - Deduplicated file
   - List of removed duplicates with reason
   - Confidence score for fuzzy matches"
```

## Pattern 3: Data Extraction

### Extract Tables from PDF

```markdown
**Prompt:**
"I'm uploading a PDF report.
Please:
1. Identify all tables in the document
2. Extract each table to a separate CSV
3. Preserve the header rows
4. Handle merged cells appropriately
5. Number the outputs (table_1.csv, table_2.csv, etc.)
6. Provide a summary of what was extracted from where"
```

### Extract Data from Screenshots

```markdown
**Prompt:**
"I'm uploading a screenshot of a data table from a web page.
Please:
1. Extract all visible data into structured format
2. Identify column headers
3. Handle any partially visible rows appropriately
4. Provide as CSV file
5. Note any extraction uncertainties"
```

### Parse Semi-Structured Text

```markdown
**Prompt:**
"I have a text file with product information in this format:
---
Product: Widget A
SKU: WID-001
Price: $29.99
In Stock: Yes
Description: A high-quality widget...
---
Product: Gadget B
...

Please:
1. Parse all products
2. Extract fields: product name, sku, price (as number), in_stock (as boolean), description
3. Convert to structured JSON
4. Flag any records with missing required fields"
```

## Pattern 4: File Merging and Splitting

### Merge Multiple Files

```markdown
**Prompt:**
"I'm uploading 3 CSV files (sales_jan.csv, sales_feb.csv, sales_mar.csv).
Please:
1. Verify all have the same columns
2. Concatenate into a single file
3. Add a 'source_file' column to track origin
4. Remove any duplicate rows
5. Sort by date
6. Provide the combined file"
```

### Split Large File

```markdown
**Prompt:**
"I have a large CSV file that needs to be split:
1. Split by region (create one file per unique region)
2. Name files as 'sales_{region}.csv'
3. Keep headers in each output file
4. Provide a summary showing record counts per file"
```

## Pattern 5: Data Validation

### Schema Validation

```markdown
**Prompt:**
"Validate this data file against these rules:

Required columns: id, name, email, created_date, amount
Data types:
  - id: positive integer
  - name: non-empty string
  - email: valid email format
  - created_date: date in YYYY-MM-DD format
  - amount: positive decimal

Business rules:
  - created_date cannot be in the future
  - amount must be between 0 and 10000
  - no duplicate ids

Provide:
1. List of validation errors with row numbers
2. Summary statistics (total rows, valid rows, error rate)
3. A cleaned file with only valid rows
4. A file with rejected rows and error reasons"
```

## Pattern 6: Report Generation

### Generate Report from Data

```markdown
**Prompt:**
"Based on the uploaded sales data, generate:

1. Executive Summary Report (Word/Markdown):
   - Key metrics (total sales, growth, top products)
   - 3-5 key insights
   - Recommendations

2. Detailed Data Appendix (Excel):
   - Sheet 1: Monthly summary
   - Sheet 2: Category breakdown
   - Sheet 3: Top 20 products
   - Include appropriate formulas and formatting

3. Presentation Slides (Key points only):
   - Slide 1: Overview metrics
   - Slide 2: Trend analysis
   - Slide 3: Category performance
   - Slide 4: Recommendations

Provide all files for download."
```

## Workflow Automation

### Creating Processing Pipelines

```markdown
**Prompt:**
"Create a data processing pipeline that:

1. Input: CSV file uploaded weekly (sales_YYYYMMDD.csv)

2. Validation:
   - Check expected columns exist
   - Validate data types
   - Flag quality issues

3. Transformation:
   - Calculate derived fields (total, profit margin)
   - Add week number and month columns
   - Categorize amounts (Low/Medium/High)

4. Output:
   - Processed file (processed_YYYYMMDD.csv)
   - Validation report (validation_YYYYMMDD.txt)
   - Summary statistics (summary_YYYYMMDD.json)

Please process the uploaded file and provide all outputs.
Also provide the Python code so I can automate this weekly."
```

## Best Practices

```python
best_practices = {
    "validation": "Always validate outputs against expectations",
    "backup": "Keep original files before transformation",
    "documentation": "Request processing steps be documented",
    "incremental": "For large files, process in chunks",
    "error_handling": "Ask for graceful handling of edge cases",
    "reproducibility": "Request code for repeatable processes"
}
```

This concludes our July series on Microsoft Fabric and AI topics. Tomorrow we begin August with LLM fine-tuning strategies.

## Resources

- [Python File Processing](https://docs.python.org/3/library/filesys.html)
- [Pandas IO Tools](https://pandas.pydata.org/docs/user_guide/io.html)
- [Data Validation Libraries](https://great-expectations.io/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
