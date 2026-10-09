---
title: "Prompt Engineering Basics: Getting Better Results from AI"
description: "Poor prompt: \"Write code for a website\" Better prompt: \"Write HTML and CSS for a responsive landing page for a SaaS product. Include a hero section with…"
author: Michael John Peña
draft: false
date: 2022-12-04
tags:
  - AI
  - Prompt Engineering
  - ChatGPT
  - OpenAI
  - Best Practices
---

## Why Prompt Engineering Matters

The same AI model can produce vastly different results based on how you prompt it:

**Poor prompt**: "Write code for a website"

**Better prompt**: "Write HTML and CSS for a responsive landing page for a SaaS product. Include a hero section with headline and CTA button, three feature cards, and a footer with social links. Use a modern, clean design with a blue color scheme."

The difference in output quality is dramatic.

## Core Principles

### 1. Be Specific

```
❌ "Write a function to process data"

✅ "Write a Python function that:
- Takes a list of dictionaries as input
- Filters items where 'status' equals 'active'
- Sorts by 'created_date' descending
- Returns the top 10 items
- Handles empty input gracefully"
```

### 2. Provide Context

```
❌ "Fix this error: NullReferenceException"

✅ "I'm getting a NullReferenceException in my C# ASP.NET Core application.
Here's the code:
[code]
Here's the stack trace:
[stack trace]
The error occurs when a user isn't logged in.
What's wrong and how do I fix it?"
```

### 3. Specify the Format

```
❌ "Explain microservices"

✅ "Explain microservices architecture in the following format:
1. Definition (2-3 sentences)
2. Key benefits (bullet points)
3. Common challenges (bullet points)
4. When to use vs. when to avoid
5. Azure services that support microservices"
```

### 4. Give Examples

```
❌ "Convert these names to email format"

✅ "Convert these names to company email format.
Example:
Input: John Smith
Output: john.smith@company.com

Now convert:
- Jane Doe
- Robert Johnson III
- Mary-Anne Williams"
```

## Prompt Patterns

### The Role Pattern

Assign a role to get domain-specific responses:

```
"You are a senior Azure solutions architect with 10 years of experience.
A client wants to migrate their on-premises SQL Server data warehouse to Azure.
They have 5TB of data, need real-time analytics, and have a limited budget.
What would you recommend and why?"
```

### The Step-by-Step Pattern

Break complex tasks into steps:

```
"Help me design a CI/CD pipeline. Let's work through this step by step:

Step 1: What triggers should we use?
Step 2: What build steps do we need?
Step 3: What tests should run?
Step 4: How should we handle deployment to different environments?
Step 5: What monitoring should we add?

Let's start with Step 1."
```

### The Constraint Pattern

Add constraints to focus the output:

```
"Write a Python script to download files from Azure Blob Storage.
Constraints:
- Use the azure-storage-blob SDK
- Handle files up to 1GB
- Show progress during download
- Maximum 50 lines of code
- Include error handling"
```

### The Template Pattern

Provide a template to fill:

```
"Generate API documentation using this template:

## Endpoint: [HTTP method] [path]

### Description
[Brief description]

### Request
- Headers: [required headers]
- Body: [request body schema]

### Response
- Success (200): [response schema]
- Errors: [possible error codes]

### Example
[curl example]

Document this endpoint: POST /api/orders"
```

### The Refinement Pattern

Iteratively improve outputs:

```
Initial: "Write a function to validate email addresses"
[Output]

Refinement 1: "Good, but also check for disposable email domains"
[Updated output]

Refinement 2: "Add async DNS MX record validation"
[Updated output]

Refinement 3: "Now make it more efficient for batch validation"
[Final output]
```

## Advanced Techniques

### Chain of Thought

Encourage reasoning:

```
"Solve this problem step by step, showing your reasoning:

A Cosmos DB container has 10,000 RU/s provisioned.
A read operation costs 1 RU for 1KB items.
A write operation costs 5 RUs for 1KB items.
The workload is 70% reads, 30% writes.
Average item size is 4KB.

How many operations per second can this handle?"
```

### Few-Shot Learning

Provide examples of desired output:

```
"Convert natural language to SQL. Here are examples:

Natural: Show all customers from Australia
SQL: SELECT * FROM customers WHERE country = 'Australia';

Natural: Find orders over $1000 from last month
SQL: SELECT * FROM orders WHERE total > 1000 AND order_date >= DATEADD(month, -1, GETDATE());

Natural: Count products by category
SQL: SELECT category, COUNT(*) as product_count FROM products GROUP BY category;

Now convert:
Natural: List the top 5 customers by total order value"
```

### Negative Prompting

Specify what NOT to do:

```
"Write a Python script to parse JSON files.
- DO NOT use pandas (use built-in json module)
- DO NOT load entire file into memory (stream large files)
- DO NOT ignore encoding issues (handle UTF-8 properly)
- DO NOT suppress exceptions (log and re-raise)"
```

## Common Mistakes

### 1. Too Vague
```
❌ "Make it better"
✅ "Improve error handling by adding try-catch blocks and logging"
```

### 2. Too Much at Once
```
❌ "Build a complete e-commerce website with user auth, product catalog, cart, checkout, payment integration, order management, and admin dashboard"

✅ "Let's build an e-commerce website. Start with the user authentication module using ASP.NET Core Identity. Include registration, login, and password reset."
```

### 3. Missing Context
```
❌ "Why doesn't this work?"
✅ "Why doesn't this C# code compile? I'm using .NET 7 and getting error CS1061. [code]"
```

## Practical Examples for Azure Development

### Generating ARM Templates

```
"Generate an ARM template for:
- Resource Group: rg-production
- Location: Australia East
- Resources:
  - App Service Plan (P1v3, 2 instances)
  - Web App (Linux, .NET 7)
  - Application Insights
  - Key Vault with secrets for connection strings
- All resources should have tags: environment=production, owner=team-alpha"
```

### Writing Azure CLI Scripts

```
"Write an Azure CLI script that:
1. Creates a new resource group if it doesn't exist
2. Deploys an Azure Container Registry
3. Builds and pushes a Docker image from the current directory
4. Creates an Azure Container Instance running that image
Include error handling and colored output for status messages."
```

### Debugging Azure Issues

```
"I'm getting 'The specified resource does not exist' when trying to access Azure Blob Storage from my Azure Function.
Environment: Azure Functions v4, .NET 7
Connection string format: DefaultEndpointsProtocol=https;AccountName=...
Container name: 'data-uploads'
I've verified the container exists in the portal.
What could be wrong?"
```

## Conclusion

Prompt engineering is a skill that improves with practice. Start with specific, contextualized prompts, use patterns like roles and templates, and iterate to refine results. As AI tools become more integrated into development workflows, this skill will become increasingly valuable.

## Resources

- [OpenAI Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [ChatGPT](https://chat.openai.com/)
- [Prompt Engineering Techniques](https://www.promptingguide.ai/)
