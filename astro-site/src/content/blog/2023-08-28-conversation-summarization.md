---
title: "Conversation Summarization: Managing Long Chat Histories"
author: Michael John Peña
draft: false
date: 2023-08-28
tags:
  - Summarization
  - Conversation
  - Memory
  - LLM
---

Conversation summarisation is the practical solution to the context window problem for long-running chat applications. The approach: when the accumulated conversation history exceeds a token threshold (say, 75% of the model's context window), trigger a summarisation call that compresses the oldest N turns into a concise summary paragraph. That summary replaces the raw turns in the next API call, and the conversation continues with the summary as a compact representation of what happened earlier. The model can still reference things that were said earlier (via the summary), but the token cost of carrying that history is a fraction of the original. The failure mode to watch: over-aggressive summarisation that loses specific details the user references later ("like I mentioned earlier, the account number is X"). The safest implementation preserves the last few raw turns verbatim and summarises only the older history — the most recent context stays intact.

## The Challenge

```python
challenges = {
    "context_limit": "Models have finite context windows",
    "cost": "Longer contexts = higher costs",
    "relevance": "Old messages may be less relevant",
    "coherence": "Need to maintain conversation flow"
}
```

## Basic Summarization

```python
from openai import AzureOpenAI

class ConversationSummarizer:
    def __init__(self, client):
        self.client = client

    def summarize(self, messages, max_tokens=500):
        """Summarize a conversation history."""
        conversation_text = self._format_messages(messages)

        prompt = f"""Summarize the following conversation, capturing:
1. Main topics discussed
2. Key decisions or conclusions
3. Important context for continuation

Conversation:
{conversation_text}

Summary:"""

        response = self.client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens
        )

        return response.choices[0].message.content

    def _format_messages(self, messages):
        formatted = []
        for msg in messages:
            role = msg["role"].capitalize()
            content = msg["content"]
            formatted.append(f"{role}: {content}")
        return "\n\n".join(formatted)
```

## Rolling Summary

```python
class RollingSummary:
    """Maintain a rolling summary of conversation."""

    def __init__(self, client, summary_threshold=10):
        self.client = client
        self.summarizer = ConversationSummarizer(client)
        self.threshold = summary_threshold
        self.summary = ""
        self.recent_messages = []

    def add_message(self, message):
        self.recent_messages.append(message)

        if len(self.recent_messages) >= self.threshold:
            self._update_summary()

    def _update_summary(self):
        # Combine old summary with messages to summarize
        messages_to_summarize = self.recent_messages[:self.threshold // 2]

        if self.summary:
            # Include previous summary as context
            combined = f"Previous summary: {self.summary}\n\nNew messages:\n"
            combined += self.summarizer._format_messages(messages_to_summarize)
        else:
            combined = self.summarizer._format_messages(messages_to_summarize)

        # Generate new summary
        self.summary = self.summarizer.summarize(
            [{"role": "user", "content": combined}]
        )

        # Keep only recent messages
        self.recent_messages = self.recent_messages[self.threshold // 2:]

    def get_context(self):
        """Get summary + recent messages for context."""
        context = []

        if self.summary:
            context.append({
                "role": "system",
                "content": f"Conversation summary: {self.summary}"
            })

        context.extend(self.recent_messages)
        return context
```

## Hierarchical Summarization

```python
class HierarchicalSummarizer:
    """Multi-level summarization for very long conversations."""

    def __init__(self, client):
        self.client = client
        self.hourly_summaries = []
        self.daily_summary = ""
        self.current_hour_messages = []

    def add_message(self, message, timestamp):
        self.current_hour_messages.append({
            **message,
            "timestamp": timestamp
        })

        # Summarize hourly
        if self._new_hour(timestamp):
            self._summarize_hour()

        # Summarize daily
        if self._new_day(timestamp):
            self._summarize_day()

    def _summarize_hour(self):
        if self.current_hour_messages:
            summary = self._generate_summary(self.current_hour_messages, "hour")
            self.hourly_summaries.append(summary)
            self.current_hour_messages = []

    def _summarize_day(self):
        if self.hourly_summaries:
            # Summarize all hourly summaries
            combined = "\n\n".join(self.hourly_summaries)
            self.daily_summary = self._generate_summary(
                [{"role": "system", "content": combined}],
                "day"
            )
            self.hourly_summaries = []

    def get_context(self, detail_level="recent"):
        """Get appropriate context based on detail level."""
        if detail_level == "full":
            return self.daily_summary + "\n" + "\n".join(self.hourly_summaries)
        elif detail_level == "recent":
            recent = self.hourly_summaries[-2:] if self.hourly_summaries else []
            return "\n".join(recent) + self._format_messages(self.current_hour_messages[-5:])
        else:
            return self.daily_summary
```

## Topic-Aware Summarization

```python
class TopicAwareSummarizer:
    """Summarize by topic clusters."""

    def __init__(self, client):
        self.client = client
        self.model = SentenceTransformer("all-MiniLM-L6-v2")

    def summarize_by_topics(self, messages, num_topics=3):
        # Cluster messages by topic
        topics = self._cluster_messages(messages, num_topics)

        summaries = {}
        for topic_id, topic_messages in topics.items():
            summaries[topic_id] = self._summarize_topic(topic_messages)

        return summaries

    def _cluster_messages(self, messages, num_topics):
        from sklearn.cluster import KMeans

        texts = [m["content"] for m in messages]
        embeddings = self.model.encode(texts)

        kmeans = KMeans(n_clusters=num_topics, random_state=42)
        labels = kmeans.fit_predict(embeddings)

        topics = {}
        for i, msg in enumerate(messages):
            label = labels[i]
            if label not in topics:
                topics[label] = []
            topics[label].append(msg)

        return topics

    def _summarize_topic(self, messages):
        text = "\n".join([m["content"] for m in messages])
        prompt = f"Summarize this discussion topic:\n{text}"

        response = self.client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200
        )
        return response.choices[0].message.content
```

## Selective Memory

```python
class SelectiveMemory:
    """Keep important messages, summarize others."""

    def __init__(self, client):
        self.client = client
        self.important_messages = []
        self.summarized_context = ""

    def add_message(self, message):
        importance = self._score_importance(message)

        if importance > 0.7:
            self.important_messages.append(message)
        else:
            # Add to summary queue
            self._update_summary(message)

    def _score_importance(self, message):
        """Score message importance (0-1)."""
        indicators = {
            "decision": 0.3,
            "action": 0.3,
            "question": 0.2,
            "agreement": 0.2
        }

        score = 0
        content = message["content"].lower()

        if any(word in content for word in ["decided", "conclude", "final"]):
            score += indicators["decision"]
        if any(word in content for word in ["will", "shall", "must", "need to"]):
            score += indicators["action"]
        if "?" in content:
            score += indicators["question"]

        return min(1.0, score)

    def get_context(self):
        context = []
        if self.summarized_context:
            context.append({
                "role": "system",
                "content": f"Background: {self.summarized_context}"
            })
        context.extend(self.important_messages[-10:])
        return context
```

Tomorrow we'll explore memory management patterns for LLM applications.

## Resources

- [LangChain Memory](https://python.langchain.com/docs/modules/memory/)
- [Summarization Techniques](https://arxiv.org/abs/2202.06417)
- [Conversation AI Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
