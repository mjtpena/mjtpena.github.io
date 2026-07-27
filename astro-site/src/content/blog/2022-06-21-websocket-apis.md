---
title: "GitHub Copilot is Now Generally Available: The AI Pair Programmer for Everyone"
author: Michael John Peña
draft: false
date: 2022-06-21
tags:
  - GitHub Copilot
  - AI
  - Developer Tools
  - Code Completion
  - OpenAI

---

I wrote "GitHub Copilot is Now Generally Available: The AI Pair Programmer for Everyone" to share practical, production-minded guidance on this topic.

## What is GitHub Copilot?

GitHub Copilot is an AI-powered code completion tool developed by GitHub in collaboration with OpenAI. It uses the Codex model (a descendant of GPT-3 specifically trained on code) to suggest entire lines or blocks of code as you type.

## Key Features at GA

### 1. Multi-Language Support

Copilot works across dozens of programming languages:

```python
# Just type a comment, Copilot completes the function
# Function to calculate fibonacci sequence up to n terms
def fibonacci(n):
    if n <= 0:
        return []
    elif n == 1:
        return [0]
    elif n == 2:
        return [0, 1]

    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[i-1] + fib[i-2])
    return fib
```

### 2. Context-Aware Completions

Copilot understands your codebase context:

```typescript
// It learns from your existing code patterns
interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

// Copilot suggests consistent patterns
interface Post {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}

// Type a function name and it infers the implementation
function getUserPosts(userId: string, posts: Post[]): Post[] {
  return posts.filter(post => post.authorId === userId);
}
```

### 3. Test Generation

```python
# Copilot excels at generating test cases
import pytest
from my_module import fibonacci

def test_fibonacci_empty():
    assert fibonacci(0) == []

def test_fibonacci_single():
    assert fibonacci(1) == [0]

def test_fibonacci_two():
    assert fibonacci(2) == [0, 1]

def test_fibonacci_ten():
    assert fibonacci(10) == [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]

def test_fibonacci_negative():
    assert fibonacci(-5) == []
```

### 4. Documentation Generation

```javascript
/**
 * Calculates the distance between two geographic coordinates
 * using the Haversine formula.
 *
 * @param {number} lat1 - Latitude of the first point in degrees
 * @param {number} lon1 - Longitude of the first point in degrees
 * @param {number} lat2 - Latitude of the second point in degrees
 * @param {number} lon2 - Longitude of the second point in degrees
 * @returns {number} Distance in kilometers
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}
```

## Pricing

GitHub Copilot is available at:

- **$10/month** or **$100/year** for individuals
- **Free** for verified students and maintainers of popular open-source projects
- **Enterprise pricing** coming soon (GitHub Copilot for Business)

## IDE Support

At launch, Copilot supports:

- **Visual Studio Code** (primary)
- **JetBrains IDEs** (IntelliJ, PyCharm, WebStorm, etc.)
- **Neovim**
- **Visual Studio 2022** (preview)

## Getting Started

### Installation in VS Code

1. Install the GitHub Copilot extension
2. Sign in with your GitHub account
3. Start coding!

```bash
# After installation, open any file and start typing
# Copilot suggestions appear as ghost text
```

### Tips for Effective Use

```python
# 1. Write clear comments - Copilot uses them as context
# Parse a CSV file and return a list of dictionaries
def parse_csv(filename):
    import csv
    with open(filename, 'r') as f:
        reader = csv.DictReader(f)
        return list(reader)

# 2. Provide good function names
def send_welcome_email_to_new_user(user):
    # Copilot understands the intent from the name
    subject = f"Welcome to our platform, {user.name}!"
    body = f"""
    Hi {user.name},

    Thank you for joining us. We're excited to have you!

    Best regards,
    The Team
    """
    send_email(user.email, subject, body)

# 3. Start with the structure you want
class DatabaseConnection:
    def __init__(self, host, port, database):
        # Copilot completes based on the pattern
        self.host = host
        self.port = port
        self.database = database
        self.connection = None

    def connect(self):
        # Implementation suggested by Copilot
        pass

    def disconnect(self):
        pass

    def execute(self, query):
        pass
```

## Privacy and Security Considerations

GitHub has addressed several concerns:

- **Code Suggestions**: Based on public code, but filtered to avoid verbatim copying
- **Telemetry**: User engagement data collected (opt-out available)
- **Enterprise**: Private code remains private; future enterprise version will have additional controls

```yaml
# VS Code settings for privacy-conscious users
{
  "github.copilot.enable": {
    "*": true,
    "plaintext": false,
    "markdown": false,
    "yaml": false  # Disable for config files
  }
}
```

## My First Impressions

After using Copilot in the technical preview for months, here's what stands out:

### Strengths

1. **Boilerplate elimination**: It handles repetitive code patterns incredibly well
2. **API usage**: It suggests correct API calls based on imports
3. **Learning acceleration**: Great for exploring unfamiliar libraries
4. **Test writing**: Generates comprehensive test cases quickly

### Areas for Improvement

1. **Accuracy**: Suggestions aren't always correct - always review
2. **Context limits**: Large codebases can exceed its understanding
3. **Outdated patterns**: Sometimes suggests deprecated approaches

## What This Means for Developers

This is not about replacing developers - it's about augmentation. Think of Copilot as:

- An always-available pair programmer
- A smart autocomplete on steroids
- A learning tool for new technologies
- A productivity multiplier for routine tasks

## The Future of AI-Assisted Development

GitHub Copilot's GA release signals a shift in how we write code. We're moving from:

- Writing every character manually
- Searching Stack Overflow for patterns
- Copy-pasting from documentation

To:

- Describing intent, reviewing suggestions
- Focusing on architecture and logic
- Iterating faster with AI assistance

## Getting Started Today

```bash
# Sign up at github.com/features/copilot
# Install the extension for your IDE
# Start your free trial and experience the future of coding
```

This is just the beginning. With GitHub's backing and OpenAI's technology, Copilot will only get better. Today, I'm celebrating a milestone in developer tooling - the AI pair programmer is here for everyone.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
