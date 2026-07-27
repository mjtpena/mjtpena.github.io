---
title: "GPT-3 for Enterprise: Practical Applications and Implementation Patterns"
author: Michael John Peña
draft: false
date: 2022-03-02
tags:
  - Azure
  - OpenAI
  - GPT-3
  - Enterprise
  - AI

---

I wrote "GPT-3 for Enterprise: Practical Applications and Implementation Patterns" to share practical, production-minded guidance on this topic.

## Pattern 1: Document Summarization

One of the most immediate applications - turning lengthy documents into concise summaries.

```python
import openai

def summarize_document(text, max_length=200):
    prompt = f"""Summarize the following document in {max_length} words or less.
Focus on key points and actionable items.

Document:
{text}

Summary:"""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=max_length * 2,  # Tokens != words, so buffer
        temperature=0.3,  # Lower temperature for factual accuracy
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0
    )

    return response.choices[0].text.strip()
```

**Key insight**: Lower temperature (0.1-0.3) works better for summarization where you want accuracy over creativity.

## Pattern 2: Classification with Few-Shot Learning

GPT-3 excels at classification when given examples:

```python
def classify_support_ticket(ticket_text):
    prompt = """Classify the following support tickets into categories:
Billing, Technical, Account, Feature Request, or Other.

Ticket: My card was charged twice for the same subscription
Category: Billing

Ticket: The app crashes when I try to upload files larger than 10MB
Category: Technical

Ticket: I need to change the email address on my account
Category: Account

Ticket: It would be great if you could add dark mode
Category: Feature Request

Ticket: {ticket_text}
Category:"""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt.format(ticket_text=ticket_text),
        max_tokens=10,
        temperature=0,  # Zero for deterministic classification
        stop=["\n"]
    )

    return response.choices[0].text.strip()
```

## Pattern 3: Data Extraction from Unstructured Text

Extract structured data from messy input:

```python
import json

def extract_invoice_data(invoice_text):
    prompt = f"""Extract the following information from this invoice text.
Return the result as JSON with keys: vendor_name, invoice_number, date, total_amount, line_items.
If a field is not found, use null.

Invoice text:
{invoice_text}

JSON:"""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=500,
        temperature=0
    )

    try:
        return json.loads(response.choices[0].text.strip())
    except json.JSONDecodeError:
        return {"error": "Failed to parse response", "raw": response.choices[0].text}
```

## Pattern 4: Code Generation for Business Logic

Generate code from natural language specifications:

```python
def generate_sql_query(natural_language_request, schema_description):
    prompt = f"""Given the following database schema:
{schema_description}

Write a SQL query for: {natural_language_request}

SQL Query:"""

    response = openai.Completion.create(
        engine="code-davinci-002",  # Use Codex for code
        prompt=prompt,
        max_tokens=200,
        temperature=0,
        stop=["--", ";"]  # Stop at comment or statement end
    )

    return response.choices[0].text.strip() + ";"
```

**Warning**: Always validate generated SQL before execution. Use parameterized queries and never execute against production without review.

## Pattern 5: Conversational Interface

Build a context-aware chatbot:

```python
class ConversationManager:
    def __init__(self, system_prompt):
        self.system_prompt = system_prompt
        self.history = []
        self.max_history = 10  # Limit context to control costs

    def get_response(self, user_message):
        self.history.append(f"User: {user_message}")

        # Build the full prompt
        conversation = "\n".join(self.history[-self.max_history:])
        prompt = f"""{self.system_prompt}

{conversation}
Assistant:"""

        response = openai.Completion.create(
            engine="text-davinci-002",
            prompt=prompt,
            max_tokens=300,
            temperature=0.7,
            stop=["User:", "\n\n"]
        )

        assistant_message = response.choices[0].text.strip()
        self.history.append(f"Assistant: {assistant_message}")

        return assistant_message

# Usage
bot = ConversationManager(
    "You are a helpful IT support assistant for Contoso Corporation. "
    "You help employees with technical issues and answer questions about company systems."
)

print(bot.get_response("My VPN isn't connecting"))
print(bot.get_response("I already tried that, still not working"))
```

## Architecture for Production

A robust production architecture includes:

```
[User] -> [API Gateway] -> [Azure Function]
                              |
                              v
                    [Rate Limiter / Queue]
                              |
                              v
                    [Azure OpenAI Service]
                              |
                              v
                    [Response Cache (Redis)]
                              |
                              v
                    [Logging / Monitoring]
```

### Implementing the Queue Pattern

For high-volume scenarios, use a queue to manage rate limits:

```python
from azure.storage.queue import QueueClient
import json

queue_client = QueueClient.from_connection_string(
    os.environ["STORAGE_CONNECTION_STRING"],
    "openai-requests"
)

def submit_request(request_id, prompt):
    message = json.dumps({
        "request_id": request_id,
        "prompt": prompt,
        "timestamp": datetime.utcnow().isoformat()
    })
    queue_client.send_message(message)
    return request_id

# Processor function (separate Azure Function)
def process_queue_message(message):
    data = json.loads(message)

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=data["prompt"],
        max_tokens=200
    )

    # Store result for later retrieval
    store_result(data["request_id"], response.choices[0].text)
```

## Error Handling

GPT-3 can fail in subtle ways. Handle these cases:

```python
def safe_completion(prompt, **kwargs):
    try:
        response = openai.Completion.create(
            engine="text-davinci-002",
            prompt=prompt,
            **kwargs
        )

        result = response.choices[0].text.strip()

        # Check for empty or nonsensical responses
        if not result or len(result) < 5:
            return {"success": False, "error": "Empty response"}

        # Check for refusal patterns
        refusal_patterns = ["I cannot", "I'm not able to", "As an AI"]
        if any(pattern in result for pattern in refusal_patterns):
            return {"success": False, "error": "Model refused request"}

        return {"success": True, "result": result}

    except openai.error.RateLimitError:
        return {"success": False, "error": "Rate limited", "retry": True}
    except openai.error.InvalidRequestError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": f"Unexpected: {str(e)}"}
```

## Prompt Engineering Tips

1. **Be specific**: Vague prompts get vague results
2. **Provide examples**: Few-shot learning dramatically improves accuracy
3. **Use delimiters**: Clearly separate instructions from content
4. **Specify format**: Tell the model exactly what output format you want
5. **Iterate**: Prompt engineering is experimental - test and refine

```python
# Bad prompt
prompt = "Write about Azure"

# Better prompt
prompt = """Write a 200-word technical blog post introduction about Azure's
serverless computing options. The audience is experienced developers who are
new to cloud computing. Focus on Azure Functions and Logic Apps.
Use a professional but approachable tone."""
```

## Cost Management

Track and control costs:

```python
import tiktoken

def estimate_cost(prompt, max_tokens, model="text-davinci-002"):
    encoding = tiktoken.encoding_for_model(model)
    prompt_tokens = len(encoding.encode(prompt))
    total_tokens = prompt_tokens + max_tokens

    # Davinci pricing (as of March 2022)
    cost_per_1k = 0.02
    estimated_cost = (total_tokens / 1000) * cost_per_1k

    return {
        "prompt_tokens": prompt_tokens,
        "max_completion_tokens": max_tokens,
        "estimated_max_cost": estimated_cost
    }
```

## Conclusion

GPT-3 in the enterprise isn't about replacing systems - it's about augmenting capabilities. The patterns here represent practical starting points, but the real value comes from understanding your specific use cases and iterating on solutions.

Start with a single, well-defined problem. Build a proof of concept. Measure the results. Then expand.

## Resources

- [Azure OpenAI Best Practices](https://docs.microsoft.com/en-us/azure/cognitive-services/openai/concepts/best-practices)
- [Prompt Engineering Guide](https://platform.openai.com/docs/guides/completion/prompt-design)
- [Token Counting with tiktoken](https://github.com/openai/tiktoken)

