---
title: "Text Summarization API in Azure AI Language"
author: Michael John Peña
draft: false
date: 2023-09-21
description: "Learn how to use Azure AI Language's summarization capabilities for extractive and abstractive document summarization."
tags:
  - Azure
  - NLP
  - Summarization
  - AI
  - Text Analytics
---

## Introduction

Document summarization is essential for handling information overload in enterprise environments. Azure AI Language provides both extractive and abstractive summarization capabilities that can condense lengthy documents into concise summaries while preserving key information.

## Summarization Types

### Extractive vs Abstractive Summarization

```python
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

class SummarizationType(Enum):
    EXTRACTIVE = "extractive"
    ABSTRACTIVE = "abstractive"

@dataclass
class SummarySentence:
    text: str
    rank_score: float
    offset: int
    length: int

@dataclass
class Summary:
    summary_type: SummarizationType
    content: str
    sentences: Optional[List[SummarySentence]] = None
    original_length: int = 0
    summary_length: int = 0

    @property
    def compression_ratio(self) -> float:
        if self.original_length == 0:
            return 0
        return 1 - (self.summary_length / self.original_length)
```

### Azure Summarization Client

```python
import os
from azure.ai.textanalytics import TextAnalyticsClient, ExtractiveSummaryAction, AbstractiveSummaryAction
from azure.core.credentials import AzureKeyCredential
from typing import List, Dict

class AzureSummarizer:
    def __init__(self):
        self.client = TextAnalyticsClient(
            endpoint=os.getenv("AZURE_LANGUAGE_ENDPOINT"),
            credential=AzureKeyCredential(os.getenv("AZURE_LANGUAGE_KEY"))
        )

    def extractive_summarize(
        self,
        documents: List[str],
        max_sentences: int = 3,
        order_by: str = "Rank"  # "Rank" or "Offset"
    ) -> List[Summary]:
        """Perform extractive summarization"""
        poller = self.client.begin_analyze_actions(
            documents,
            actions=[
                ExtractiveSummaryAction(
                    max_sentence_count=max_sentences,
                    order_by=order_by
                )
            ]
        )
        results = poller.result()

        summaries = []
        for doc_results in results:
            for result in doc_results:
                if not result.is_error:
                    sentences = [
                        SummarySentence(
                            text=sent.text,
                            rank_score=sent.rank_score,
                            offset=sent.offset,
                            length=sent.length
                        )
                        for sent in result.sentences
                    ]

                    summary_text = " ".join(sent.text for sent in result.sentences)
                    summaries.append(Summary(
                        summary_type=SummarizationType.EXTRACTIVE,
                        content=summary_text,
                        sentences=sentences,
                        summary_length=len(summary_text)
                    ))
                else:
                    summaries.append(None)

        return summaries

    def abstractive_summarize(
        self,
        documents: List[str],
        sentence_count: int = 3
    ) -> List[Summary]:
        """Perform abstractive summarization"""
        poller = self.client.begin_analyze_actions(
            documents,
            actions=[
                AbstractiveSummaryAction(
                    sentence_count=sentence_count
                )
            ]
        )
        results = poller.result()

        summaries = []
        for doc_results in results:
            for result in doc_results:
                if not result.is_error:
                    # Abstractive returns multiple summary options
                    summary_texts = [s.text for s in result.summaries]
                    summaries.append(Summary(
                        summary_type=SummarizationType.ABSTRACTIVE,
                        content=summary_texts[0] if summary_texts else "",
                        summary_length=len(summary_texts[0]) if summary_texts else 0
                    ))
                else:
                    summaries.append(None)

        return summaries

    def hybrid_summarize(
        self,
        documents: List[str],
        extractive_sentences: int = 5,
        abstractive_sentences: int = 2
    ) -> List[Dict]:
        """Combine extractive and abstractive summarization"""
        # First pass: extractive to get key sentences
        extractive = self.extractive_summarize(documents, extractive_sentences)

        # Second pass: abstractive on extracted content
        extracted_texts = [s.content if s else "" for s in extractive]
        abstractive = self.abstractive_summarize(extracted_texts, abstractive_sentences)

        results = []
        for i, (ext, abst) in enumerate(zip(extractive, abstractive)):
            results.append({
                "extractive_summary": ext.content if ext else "",
                "abstractive_summary": abst.content if abst else "",
                "key_sentences": [s.text for s in (ext.sentences or [])] if ext else []
            })

        return results

# Usage
summarizer = AzureSummarizer()

documents = [
    """
    Microsoft Azure continues to expand its AI services portfolio with new capabilities
    announced at the recent tech conference. The company unveiled improvements to Azure
    OpenAI Service, including support for GPT-4 Turbo and enhanced vision capabilities.
    Enterprise customers can now leverage these advanced AI models with the security and
    compliance features they require. The updates also include new tools for responsible
    AI deployment, helping organizations implement AI solutions while managing risks.
    Additionally, Azure AI Speech received updates for improved accuracy in multi-speaker
    scenarios and better support for technical vocabulary in specialized domains.
    """
]

# Extractive summarization
extractive = summarizer.extractive_summarize(documents, max_sentences=2)
print("Extractive Summary:")
print(extractive[0].content)

# Abstractive summarization
abstractive = summarizer.abstractive_summarize(documents, sentence_count=2)
print("\nAbstractive Summary:")
print(abstractive[0].content)

# Hybrid approach
hybrid = summarizer.hybrid_summarize(documents)
print("\nHybrid Summary:")
print(hybrid[0]["abstractive_summary"])
```

### Meeting and Conversation Summarization

```python
class ConversationSummarizer:
    """Summarize conversations and meetings"""

    def __init__(self, base_summarizer: AzureSummarizer):
        self.summarizer = base_summarizer

    def summarize_conversation(
        self,
        turns: List[Dict],  # [{"speaker": "...", "text": "..."}]
        format_output: bool = True
    ) -> Dict:
        """Summarize a conversation"""
        # Format conversation for summarization
        formatted_text = self._format_conversation(turns)

        # Get summaries
        extractive = self.summarizer.extractive_summarize(
            [formatted_text],
            max_sentences=5,
            order_by="Offset"  # Maintain chronological order
        )[0]

        abstractive = self.summarizer.abstractive_summarize(
            [formatted_text],
            sentence_count=3
        )[0]

        # Extract action items and decisions (simplified)
        action_items = self._extract_action_items(turns)
        decisions = self._extract_decisions(turns)

        return {
            "summary": abstractive.content if abstractive else "",
            "key_points": [s.text for s in (extractive.sentences or [])] if extractive else [],
            "action_items": action_items,
            "decisions": decisions,
            "participant_count": len(set(t["speaker"] for t in turns)),
            "turn_count": len(turns)
        }

    def _format_conversation(self, turns: List[Dict]) -> str:
        """Format conversation turns into text"""
        lines = []
        for turn in turns:
            lines.append(f"{turn['speaker']}: {turn['text']}")
        return "\n".join(lines)

    def _extract_action_items(self, turns: List[Dict]) -> List[str]:
        """Extract action items from conversation"""
        action_keywords = [
            "will do", "action item", "need to", "should",
            "i'll", "we'll", "going to", "follow up"
        ]

        action_items = []
        for turn in turns:
            text_lower = turn["text"].lower()
            if any(kw in text_lower for kw in action_keywords):
                action_items.append(f"{turn['speaker']}: {turn['text']}")

        return action_items[:5]  # Return top 5

    def _extract_decisions(self, turns: List[Dict]) -> List[str]:
        """Extract decisions from conversation"""
        decision_keywords = [
            "decided", "agreed", "approved", "will go with",
            "let's do", "final decision", "confirmed"
        ]

        decisions = []
        for turn in turns:
            text_lower = turn["text"].lower()
            if any(kw in text_lower for kw in decision_keywords):
                decisions.append(turn["text"])

        return decisions

# Usage
conv_summarizer = ConversationSummarizer(summarizer)

conversation = [
    {"speaker": "Alice", "text": "Let's discuss the Q4 roadmap. We need to prioritize features."},
    {"speaker": "Bob", "text": "I think the authentication system should be our top priority."},
    {"speaker": "Alice", "text": "Agreed. We'll focus on OAuth integration first."},
    {"speaker": "Bob", "text": "I'll prepare the technical specification by Friday."},
    {"speaker": "Alice", "text": "Great. Let's also review the API documentation next week."},
]

result = conv_summarizer.summarize_conversation(conversation)
print(f"Summary: {result['summary']}")
print(f"Action Items: {result['action_items']}")
```

### Document Summarization Pipeline

```python
from typing import Generator
import math

class DocumentSummarizationPipeline:
    """Pipeline for summarizing long documents"""

    def __init__(self, summarizer: AzureSummarizer):
        self.summarizer = summarizer
        self.max_doc_length = 125000  # API limit in characters

    def summarize_long_document(
        self,
        document: str,
        target_length: int = 500,
        method: str = "hierarchical"
    ) -> str:
        """Summarize documents of any length"""
        if len(document) <= self.max_doc_length:
            # Document fits in single call
            result = self.summarizer.abstractive_summarize([document], 5)
            return result[0].content if result[0] else ""

        if method == "hierarchical":
            return self._hierarchical_summarize(document, target_length)
        elif method == "map_reduce":
            return self._map_reduce_summarize(document, target_length)
        else:
            raise ValueError(f"Unknown method: {method}")

    def _split_document(self, document: str, chunk_size: int) -> List[str]:
        """Split document into chunks"""
        # Split by paragraphs first
        paragraphs = document.split("\n\n")

        chunks = []
        current_chunk = ""

        for para in paragraphs:
            if len(current_chunk) + len(para) < chunk_size:
                current_chunk += para + "\n\n"
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = para + "\n\n"

        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks

    def _hierarchical_summarize(self, document: str, target_length: int) -> str:
        """Hierarchical summarization - summarize chunks, then summarize summaries"""
        chunk_size = self.max_doc_length - 1000  # Leave margin
        chunks = self._split_document(document, chunk_size)

        # First level: summarize each chunk
        chunk_summaries = []
        for chunk in chunks:
            result = self.summarizer.abstractive_summarize([chunk], 3)
            if result[0]:
                chunk_summaries.append(result[0].content)

        # Combine chunk summaries
        combined = " ".join(chunk_summaries)

        # Second level: summarize combined summaries
        if len(combined) > self.max_doc_length:
            return self._hierarchical_summarize(combined, target_length)
        else:
            sentences = max(2, target_length // 100)
            result = self.summarizer.abstractive_summarize([combined], sentences)
            return result[0].content if result[0] else combined

    def _map_reduce_summarize(self, document: str, target_length: int) -> str:
        """Map-reduce style summarization"""
        chunk_size = self.max_doc_length - 1000
        chunks = self._split_document(document, chunk_size)

        # Map: Extract key points from each chunk
        all_key_points = []
        for chunk in chunks:
            result = self.summarizer.extractive_summarize([chunk], 3)
            if result[0] and result[0].sentences:
                all_key_points.extend([s.text for s in result[0].sentences])

        # Reduce: Combine and summarize key points
        combined_points = " ".join(all_key_points)

        if len(combined_points) > self.max_doc_length:
            combined_points = combined_points[:self.max_doc_length]

        result = self.summarizer.abstractive_summarize([combined_points], 3)
        return result[0].content if result[0] else combined_points[:target_length]

    def summarize_with_sections(
        self,
        document: str,
        section_markers: List[str] = None
    ) -> Dict:
        """Summarize document preserving section structure"""
        if section_markers is None:
            section_markers = ["#", "##", "Introduction", "Conclusion", "Summary"]

        # Split into sections
        sections = self._identify_sections(document, section_markers)

        section_summaries = {}
        for section_name, section_text in sections.items():
            if len(section_text.strip()) > 50:
                result = self.summarizer.abstractive_summarize([section_text], 2)
                section_summaries[section_name] = result[0].content if result[0] else ""

        # Overall summary
        full_text = document[:self.max_doc_length]
        overall = self.summarizer.abstractive_summarize([full_text], 3)

        return {
            "overall_summary": overall[0].content if overall[0] else "",
            "section_summaries": section_summaries
        }

    def _identify_sections(self, document: str, markers: List[str]) -> Dict[str, str]:
        """Identify and extract sections from document"""
        sections = {"main": ""}
        current_section = "main"

        for line in document.split("\n"):
            # Check if line is a section header
            is_header = False
            for marker in markers:
                if line.strip().startswith(marker):
                    current_section = line.strip()
                    sections[current_section] = ""
                    is_header = True
                    break

            if not is_header:
                sections[current_section] += line + "\n"

        return sections

# Usage
pipeline = DocumentSummarizationPipeline(summarizer)

# Summarize a long document
long_document = "..." * 1000  # Very long document
summary = pipeline.summarize_long_document(long_document, target_length=300)
print(f"Summary ({len(summary)} chars): {summary}")

# Summarize with sections
sectioned_doc = """
# Introduction
This document discusses...

# Background
The historical context...

# Methods
We used the following approach...

# Results
Our findings show...

# Conclusion
In summary...
"""

sectioned_summary = pipeline.summarize_with_sections(sectioned_doc)
print(f"Overall: {sectioned_summary['overall_summary']}")
for section, summary in sectioned_summary['section_summaries'].items():
    print(f"{section}: {summary}")
```

## Conclusion

Azure AI Language's summarization capabilities enable efficient processing of large amounts of text content. By combining extractive and abstractive approaches, implementing hierarchical summarization for long documents, and preserving document structure, you can build robust summarization systems that help users quickly understand key information from any document.
