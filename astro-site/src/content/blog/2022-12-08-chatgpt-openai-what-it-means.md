---
title: "ChatGPT: What OpenAI's New AI Chatbot Means for Developers"
author: Michael John Peña
draft: false
date: 2022-12-08
tags:
  - AI
  - OpenAI
  - ChatGPT
  - GPT-3
  - Machine Learning
---

One week after ChatGPT's launch and it had crossed one million users—a milestone that took Netflix 3.5 years, Facebook 10 months, and Instagram 2.5 months. I'd spent the week alternating between genuine amazement and measured scepticism, trying to be honest about what this actually means for those of us building software on Azure. My clearest thought after a week: this changes the interface layer of software, not the underlying engineering. The hard problems—data modelling, distributed systems reliability, security architecture, performance at scale—remain hard problems. What changes is the input method for some of them: instead of writing a Kusto query from memory, you describe what you want to find in your logs and the AI drafts the query. Instead of writing boilerplate repository code, you describe the entity and the AI generates the initial scaffold. The 10x productivity gains that some early adopters were claiming felt overstated to me in December 2022; the "genuinely meaningful productivity improvement for specific tasks" framing felt right.

## What is ChatGPT?

ChatGPT is a conversational AI built on GPT-3.5, fine-tuned using Reinforcement Learning from Human Feedback (RLHF). The key difference from previous GPT models:
- It's designed for dialogue, not just text completion
- It can admit mistakes and refuse inappropriate requests
- It maintains context across a conversation

The user interface is brilliantly simple - just a chat box. No API keys, no setup, no cost (for now).

## What It Does Well

**Code Generation and Explanation**

I asked it to write a function for connecting to Azure Cosmos DB:

```python
from azure.cosmos import CosmosClient, exceptions

def get_cosmos_client(endpoint: str, key: str, database_name: str, container_name: str):
    """
    Creates a Cosmos DB client and returns the container reference.

    Args:
        endpoint: Your Cosmos DB account endpoint
        key: Your Cosmos DB account key
        database_name: Name of the database
        container_name: Name of the container

    Returns:
        Container client object
    """
    try:
        client = CosmosClient(endpoint, credential=key)
        database = client.get_database_client(database_name)
        container = database.get_container_client(container_name)
        return container
    except exceptions.CosmosHttpResponseError as e:
        raise Exception(f"Failed to connect to Cosmos DB: {e.message}")
```

The code is correct, idiomatic, includes error handling, and has documentation. It even used the `azure-cosmos` package correctly without me specifying it.

**Explaining Complex Concepts**

I asked it to explain Spark partitioning strategies:

> "Spark supports several partitioning strategies: hash partitioning distributes data based on a hash of the partition key, ensuring even distribution but not preserving order. Range partitioning keeps data sorted within partitions, useful for operations that benefit from sorted data like merge joins. Round-robin partitioning distributes rows evenly regardless of content..."

This is better than most documentation I've read.

**SQL Query Generation**

Given a schema description, it can generate SQL:

```sql
-- Request: Get the top 10 customers by total order value in the last 30 days

SELECT
    c.customer_id,
    c.customer_name,
    SUM(o.order_total) as total_value
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
WHERE o.order_date >= DATEADD(day, -30, GETDATE())
GROUP BY c.customer_id, c.customer_name
ORDER BY total_value DESC
LIMIT 10;
```

## Where It Struggles

**Accuracy on Specific Versions**
Asked about Azure Synapse features, it sometimes mixed up what's in preview vs. GA, or got version-specific syntax wrong. Always verify against current documentation.

**Recent Events**
Its training data has a cutoff (somewhere in 2021), so it doesn't know about recent releases like Unity Catalog GA or the latest Azure updates.

**Hallucination**
It will confidently generate plausible-looking code for APIs that don't exist, or cite documentation pages that were never written. It doesn't say "I don't know" often enough.

## Implications for Developers

**Short Term: Productivity Boost**
ChatGPT is already useful as:
- A first-draft code generator
- An explainer for unfamiliar codebases
- A rubber duck for debugging
- A documentation writer

I've been using it alongside my IDE, and it genuinely speeds up certain tasks.

**Medium Term: Changing Skills**
The value of writing boilerplate code is decreasing. The value of:
- Understanding system design
- Asking the right questions
- Reviewing and validating AI output
- Understanding what good code looks like

...is increasing.

**Long Term: API Integration**
What makes ChatGPT exciting for enterprise applications isn't the chat interface - it's the underlying model. OpenAI has an API, and Microsoft has exclusive licensing through Azure.

```python
import openai

response = openai.ChatCompletion.create(
    model="gpt-3.5-turbo",
    messages=[
        {"role": "system", "content": "You are a helpful data engineering assistant."},
        {"role": "user", "content": "Write a Spark job to deduplicate records based on customer_id, keeping the most recent."}
    ]
)
```

Imagine this embedded in:
- IDE plugins for code assistance
- Documentation tools that explain code
- Data catalogs that generate descriptions
- Testing frameworks that generate test cases

## The Microsoft Connection

Remember, Microsoft invested $1 billion in OpenAI and has exclusive licensing rights to GPT-3 for commercial products. We've already seen:
- GitHub Copilot (GPT-powered code completion)
- GPT-3 in Power Apps (natural language to formulas)
- Azure OpenAI Service (enterprise API access)

ChatGPT's success will accelerate Microsoft's AI integration across their stack. Expect to see conversational AI in:
- Azure Portal
- Power Platform
- Visual Studio
- Microsoft 365

## What I'm Doing Differently

1. **Using it for first drafts** - Code, documentation, even emails
2. **Learning prompt engineering** - How you ask matters enormously
3. **Building verification habits** - Always test, review, and validate
4. **Watching Azure OpenAI Service** - This is how we'll integrate it into products

## Concerns and Considerations

**Accuracy**: ChatGPT is often wrong. In production applications, you need guardrails.

**Security**: Don't paste sensitive code or data into public ChatGPT. Enterprise needs private deployment.

**Copyright**: The training data and output ownership questions are unresolved.

**Jobs**: Yes, some tasks will be automated. But new tasks will emerge. The net effect is unclear.

## Conclusion

ChatGPT is impressive, useful, and imperfect. It's not replacing developers - it's changing what we spend time on. The developers who learn to work with these tools effectively will be more productive. Those who ignore them will fall behind.

We're at an inflection point. GPT-3 was interesting but required effort to access. ChatGPT made it accessible. The next step is embedding these capabilities into every tool we use.

Start experimenting now.

## Resources

- [ChatGPT](https://chat.openai.com/)
- [OpenAI API Documentation](https://platform.openai.com/docs/)
- [Azure OpenAI Service](https://azure.microsoft.com/en-us/products/cognitive-services/openai-service/)
- [GitHub Copilot](https://github.com/features/copilot)
