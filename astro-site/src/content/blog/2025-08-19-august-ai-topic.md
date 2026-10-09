---
title: "Prompt Engineering Best Practices for Enterprise Applications"
description: "A well-structured prompt includes context, instructions, examples, and output format specifications."
author: Michael John Peña
draft: false
date: 2025-08-19
tags:
  - Prompt Engineering
  - LLM
  - AI
  - Best Practices
  - Enterprise
---

## Structure Your Prompts

A well-structured prompt includes context, instructions, examples, and output format specifications.

```python
STRUCTURED_PROMPT = """
# Context
You are a customer service assistant for TechCorp, a software company.
You have access to our product documentation and can help with technical questions.

# Instructions
1. Always be professional and helpful
2. If you don't know the answer, say so clearly
3. For technical issues, provide step-by-step guidance
4. Never make up product features or pricing

# Output Format
Respond in this structure:
- **Understanding**: Brief restatement of the customer's question
- **Answer**: Your response
- **Next Steps**: Any follow-up actions (if applicable)

# Examples
User: How do I reset my password?
Assistant:
- **Understanding**: You need to reset your account password.
- **Answer**: Visit settings.techcorp.com/password, click "Forgot Password," and enter your email. You'll receive a reset link within 5 minutes.
- **Next Steps**: Check your spam folder if you don't see the email.

# Current Query
{user_query}
"""

def get_customer_response(user_query: str) -> str:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "user", "content": STRUCTURED_PROMPT.format(user_query=user_query)}
        ],
        temperature=0.3  # Lower for more consistent outputs
    )
    return response.choices[0].message.content
```

## Key Techniques

### Be Specific
Instead of "summarize this document," try "summarize this document in 3 bullet points, focusing on key decisions and action items."

### Use Delimiters
Clearly separate different sections with markers like `###`, `"""`, or XML tags to prevent prompt injection and improve parsing.

### Request Structured Output
Ask for JSON, markdown tables, or specific formats to get machine-parseable responses.

### Chain of Thought
For complex reasoning, prompt the model to "think step by step" before providing the final answer.

Invest time in prompt development. A 10% improvement in prompt quality often delivers a 50% improvement in application reliability.
