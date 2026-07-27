---
title: "Output Filtering for LLM Applications"
author: Michael John Peña
draft: false
date: 2023-10-18
description: "Implementing robust output filtering to ensure LLM responses meet safety and quality standards."
tags:
  - Output Filtering
  - LLM Security
  - Content Moderation
  - Safety
  - AI

---

I wrote "Output Filtering for LLM Applications" to share practical, production-minded guidance on this topic.

## Introduction

Output filtering is the last line of defense before LLM responses reach users. Effective filtering catches harmful content, hallucinations, and policy violations that slip through other safety measures. This post covers comprehensive output filtering strategies.

## Output Filtering Architecture

```python
from dataclasses import dataclass
from typing import List, Dict, Optional, Callable
from enum import Enum
import re

class FilterAction(Enum):
    ALLOW = "allow"
    MODIFY = "modify"
    BLOCK = "block"
    FLAG = "flag"

@dataclass
class FilterResult:
    action: FilterAction
    original_output: str
    filtered_output: Optional[str]
    issues: List[Dict]
    confidence: float

class OutputFilter:
    """Comprehensive output filtering for LLM responses"""

    def __init__(self):
        self.filters: List[Callable] = []
        self._setup_default_filters()

    def _setup_default_filters(self):
        """Setup default output filters"""
        self.filters = [
            self._filter_harmful_content,
            self._filter_pii,
            self._filter_code_execution,
            self._filter_external_links,
            self._filter_confidential_info
        ]

    def filter(self, output: str) -> FilterResult:
        """Run all filters on output"""
        issues = []
        filtered_output = output
        max_severity = 0

        for filter_func in self.filters:
            result = filter_func(filtered_output)

            if result["issues"]:
                issues.extend(result["issues"])
                max_severity = max(max_severity, result["severity"])

            if result["modified_output"]:
                filtered_output = result["modified_output"]

        # Determine action
        action = self._determine_action(max_severity, issues)

        return FilterResult(
            action=action,
            original_output=output,
            filtered_output=filtered_output if action != FilterAction.BLOCK else None,
            issues=issues,
            confidence=1.0 - (max_severity / 10)
        )

    def _determine_action(self, severity: int, issues: List[Dict]) -> FilterAction:
        """Determine filtering action"""
        if severity >= 8:
            return FilterAction.BLOCK
        elif severity >= 5:
            return FilterAction.MODIFY
        elif severity >= 2:
            return FilterAction.FLAG
        return FilterAction.ALLOW

    def _filter_harmful_content(self, text: str) -> Dict:
        """Filter harmful content"""
        issues = []
        modified = text
        severity = 0

        harmful_patterns = [
            (r'\b(kill|murder|harm)\s+(yourself|himself|herself|themselves)\b', 'self_harm', 9),
            (r'\b(how to|instructions for)\s+(make|build)\s+(bomb|weapon|explosive)\b', 'violence', 10),
            (r'\b(hate|kill all)\s+\w+\s*(people|group)\b', 'hate_speech', 8),
        ]

        for pattern, issue_type, sev in harmful_patterns:
            if re.search(pattern, text.lower()):
                issues.append({
                    "type": issue_type,
                    "message": f"Detected {issue_type.replace('_', ' ')}",
                    "severity": sev
                })
                severity = max(severity, sev)
                modified = re.sub(pattern, '[content removed]', modified, flags=re.IGNORECASE)

        return {
            "issues": issues,
            "severity": severity,
            "modified_output": modified if modified != text else None
        }

    def _filter_pii(self, text: str) -> Dict:
        """Filter personally identifiable information"""
        issues = []
        modified = text
        severity = 0

        pii_patterns = [
            (r'\b\d{3}[-.]?\d{2}[-.]?\d{4}\b', 'ssn', 7, '[SSN REDACTED]'),
            (r'\b\d{16}\b', 'credit_card', 7, '[CARD REDACTED]'),
            (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', 'email', 4, '[EMAIL REDACTED]'),
            (r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', 'phone', 4, '[PHONE REDACTED]'),
        ]

        for pattern, issue_type, sev, replacement in pii_patterns:
            matches = re.findall(pattern, text)
            if matches:
                issues.append({
                    "type": f"pii_{issue_type}",
                    "message": f"Found {len(matches)} {issue_type} pattern(s)",
                    "count": len(matches),
                    "severity": sev
                })
                severity = max(severity, sev)
                modified = re.sub(pattern, replacement, modified)

        return {
            "issues": issues,
            "severity": severity,
            "modified_output": modified if modified != text else None
        }

    def _filter_code_execution(self, text: str) -> Dict:
        """Filter potentially dangerous code"""
        issues = []
        modified = text
        severity = 0

        # Patterns for dangerous code
        dangerous_code = [
            (r'rm\s+-rf\s+/', 'destructive_command', 9),
            (r':()\{\s*:\|:&\s*\};:', 'fork_bomb', 10),
            (r'eval\s*\([^)]*\$', 'code_injection', 8),
            (r'curl.*\|\s*(ba)?sh', 'remote_execution', 8),
        ]

        for pattern, issue_type, sev in dangerous_code:
            if re.search(pattern, text):
                issues.append({
                    "type": issue_type,
                    "message": f"Detected potentially dangerous code: {issue_type}",
                    "severity": sev
                })
                severity = max(severity, sev)
                modified = re.sub(pattern, '[DANGEROUS CODE REMOVED]', modified)

        return {
            "issues": issues,
            "severity": severity,
            "modified_output": modified if modified != text else None
        }

    def _filter_external_links(self, text: str) -> Dict:
        """Filter suspicious external links"""
        issues = []
        modified = text
        severity = 0

        # Find all URLs
        url_pattern = r'https?://[^\s<>"{}|\\^`\[\]]+'
        urls = re.findall(url_pattern, text)

        suspicious_domains = ['bit.ly', 'tinyurl', 'exe', '.ru', '.cn']

        for url in urls:
            for suspicious in suspicious_domains:
                if suspicious in url.lower():
                    issues.append({
                        "type": "suspicious_url",
                        "message": f"Suspicious URL detected",
                        "url": url,
                        "severity": 5
                    })
                    severity = max(severity, 5)
                    modified = modified.replace(url, '[URL FILTERED]')
                    break

        return {
            "issues": issues,
            "severity": severity,
            "modified_output": modified if modified != text else None
        }

    def _filter_confidential_info(self, text: str) -> Dict:
        """Filter confidential information leakage"""
        issues = []
        modified = text
        severity = 0

        confidential_patterns = [
            (r'api[_-]?key\s*[=:]\s*[\'"]?[\w-]{20,}', 'api_key', 8),
            (r'password\s*[=:]\s*[\'"]?\S+', 'password', 8),
            (r'secret\s*[=:]\s*[\'"]?[\w-]+', 'secret', 7),
            (r'token\s*[=:]\s*[\'"]?[\w.-]+', 'token', 7),
        ]

        for pattern, issue_type, sev in confidential_patterns:
            if re.search(pattern, text.lower()):
                issues.append({
                    "type": f"leaked_{issue_type}",
                    "message": f"Potential {issue_type} exposure",
                    "severity": sev
                })
                severity = max(severity, sev)
                modified = re.sub(pattern, f'{issue_type}=[REDACTED]', modified, flags=re.IGNORECASE)

        return {
            "issues": issues,
            "severity": severity,
            "modified_output": modified if modified != text else None
        }
```

## Content Classification

```python
class ContentClassifier:
    """Classify output content for filtering decisions"""

    def __init__(self):
        self.categories = [
            'safe', 'violence', 'hate', 'sexual', 'self_harm',
            'harassment', 'illegal', 'misinformation'
        ]

    def classify(self, text: str) -> Dict:
        """Classify text content"""
        # In production, use actual ML classifier
        scores = self._rule_based_classification(text)

        return {
            "scores": scores,
            "primary_category": max(scores, key=scores.get),
            "is_safe": scores.get('safe', 0) > 0.5,
            "flagged_categories": [
                cat for cat, score in scores.items()
                if score > 0.5 and cat != 'safe'
            ]
        }

    def _rule_based_classification(self, text: str) -> Dict:
        """Simple rule-based classification"""
        text_lower = text.lower()
        scores = {cat: 0.0 for cat in self.categories}
        scores['safe'] = 1.0

        # Violence indicators
        violence_terms = ['kill', 'murder', 'attack', 'weapon', 'bomb']
        violence_count = sum(1 for term in violence_terms if term in text_lower)
        if violence_count > 0:
            scores['violence'] = min(1.0, violence_count * 0.3)
            scores['safe'] -= scores['violence']

        # Hate indicators
        hate_patterns = [r'hate\s+\w+\s+people', r'all\s+\w+\s+should']
        for pattern in hate_patterns:
            if re.search(pattern, text_lower):
                scores['hate'] = 0.8
                scores['safe'] -= 0.8
                break

        return scores

class QualityFilter:
    """Filter based on output quality"""

    def check_quality(self, output: str) -> Dict:
        """Check output quality metrics"""
        issues = []

        # Check for repetition
        repetition_score = self._check_repetition(output)
        if repetition_score > 0.5:
            issues.append({
                "type": "excessive_repetition",
                "score": repetition_score,
                "severity": 3
            })

        # Check for coherence
        coherence_score = self._check_coherence(output)
        if coherence_score < 0.5:
            issues.append({
                "type": "low_coherence",
                "score": coherence_score,
                "severity": 4
            })

        # Check for completeness
        if self._is_truncated(output):
            issues.append({
                "type": "truncated_response",
                "severity": 5
            })

        return {
            "quality_score": 1.0 - len(issues) * 0.2,
            "issues": issues,
            "passed": len(issues) == 0
        }

    def _check_repetition(self, text: str) -> float:
        """Check for text repetition"""
        words = text.split()
        if len(words) < 10:
            return 0.0

        # Check for repeated phrases
        phrases = [' '.join(words[i:i+3]) for i in range(len(words)-2)]
        unique_phrases = set(phrases)

        repetition_ratio = 1 - (len(unique_phrases) / len(phrases))
        return repetition_ratio

    def _check_coherence(self, text: str) -> float:
        """Simple coherence check"""
        sentences = text.split('.')
        if len(sentences) < 2:
            return 1.0

        # Check if sentences have reasonable length
        avg_length = sum(len(s.split()) for s in sentences) / len(sentences)

        if avg_length < 3 or avg_length > 50:
            return 0.3

        return 0.8

    def _is_truncated(self, text: str) -> bool:
        """Check if response appears truncated"""
        # Check for incomplete sentences
        text = text.strip()

        if not text:
            return True

        # Ends mid-sentence
        if text[-1] not in '.!?"\')':
            if len(text) > 100:  # Only flag longer responses
                return True

        return False
```

## Hallucination Detection

```python
class HallucinationDetector:
    """Detect potential hallucinations in output"""

    def __init__(self):
        self.confidence_phrases = [
            "I'm not sure",
            "I believe",
            "I think",
            "It's possible",
            "might be"
        ]

    def detect(self, output: str, context: Optional[str] = None) -> Dict:
        """Detect potential hallucinations"""
        issues = []

        # Check for fabricated citations
        citation_issues = self._check_citations(output)
        issues.extend(citation_issues)

        # Check for over-confident claims
        confidence_issues = self._check_confidence(output)
        issues.extend(confidence_issues)

        # Check against context if provided
        if context:
            grounding_issues = self._check_grounding(output, context)
            issues.extend(grounding_issues)

        return {
            "potential_hallucinations": len(issues) > 0,
            "issues": issues,
            "risk_score": min(1.0, len(issues) * 0.3)
        }

    def _check_citations(self, text: str) -> List[Dict]:
        """Check for potentially fabricated citations"""
        issues = []

        # Pattern for citations
        citation_pattern = r'\(([A-Z][a-z]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-z]+))?),?\s*\d{4}\)'
        citations = re.findall(citation_pattern, text)

        if len(citations) > 3:
            issues.append({
                "type": "many_citations",
                "message": f"Found {len(citations)} citations - verify accuracy",
                "citations": citations,
                "severity": 4
            })

        # Check for specific numbers that might be hallucinated
        specific_stats = re.findall(r'\d+(?:\.\d+)?%', text)
        if len(specific_stats) > 5:
            issues.append({
                "type": "many_statistics",
                "message": "Many specific statistics - verify sources",
                "severity": 3
            })

        return issues

    def _check_confidence(self, text: str) -> List[Dict]:
        """Check for overconfident claims"""
        issues = []

        # Strong certainty phrases
        certainty_phrases = [
            "definitely", "certainly", "absolutely", "always",
            "never", "proven fact", "everyone knows"
        ]

        for phrase in certainty_phrases:
            if phrase in text.lower():
                issues.append({
                    "type": "overconfident_claim",
                    "message": f"Strong certainty phrase: '{phrase}'",
                    "severity": 2
                })

        return issues

    def _check_grounding(self, output: str, context: str) -> List[Dict]:
        """Check if output is grounded in context"""
        issues = []

        # Simple check: key terms in output should be in context
        output_words = set(output.lower().split())
        context_words = set(context.lower().split())

        # Find words in output not in context (potential fabrication)
        novel_words = output_words - context_words
        common_words = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'and', 'in'}
        novel_words = novel_words - common_words

        novel_ratio = len(novel_words) / max(len(output_words), 1)

        if novel_ratio > 0.5:
            issues.append({
                "type": "low_grounding",
                "message": f"High proportion of terms not in context ({novel_ratio:.1%})",
                "severity": 5
            })

        return issues
```

## Integrated Output Pipeline

```python
class OutputFilteringPipeline:
    """Complete output filtering pipeline"""

    def __init__(self):
        self.content_filter = OutputFilter()
        self.classifier = ContentClassifier()
        self.quality_filter = QualityFilter()
        self.hallucination_detector = HallucinationDetector()

    def process(
        self,
        output: str,
        context: Optional[str] = None,
        strict_mode: bool = False
    ) -> Dict:
        """Process output through filtering pipeline"""
        results = {}

        # Content filtering
        filter_result = self.content_filter.filter(output)
        results["content_filter"] = {
            "action": filter_result.action.value,
            "issues": filter_result.issues
        }

        # Classification
        classification = self.classifier.classify(output)
        results["classification"] = classification

        # Quality check
        quality_check = self.quality_filter.check_quality(output)
        results["quality"] = quality_check

        # Hallucination detection
        hallucination_check = self.hallucination_detector.detect(output, context)
        results["hallucination"] = hallucination_check

        # Final decision
        final_output = output
        final_action = "allow"

        if filter_result.action == FilterAction.BLOCK:
            final_output = None
            final_action = "block"
        elif filter_result.action == FilterAction.MODIFY:
            final_output = filter_result.filtered_output
            final_action = "modify"
        elif not classification["is_safe"]:
            if strict_mode:
                final_output = None
                final_action = "block"
            else:
                final_action = "flag"

        return {
            "final_output": final_output,
            "action": final_action,
            "details": results,
            "safe_to_display": final_action in ["allow", "flag", "modify"]
        }

# Usage
pipeline = OutputFilteringPipeline()

test_output = """
Based on my analysis, the answer is definitely correct.
You can contact support at john.doe@example.com or call 555-123-4567.
The API key is: sk-abc123xyz789
"""

result = pipeline.process(test_output, strict_mode=True)

print(f"Action: {result['action']}")
print(f"Safe to display: {result['safe_to_display']}")
print(f"Final output: {result['final_output']}")
```

## Conclusion

Output filtering provides critical protection against harmful content, PII leakage, dangerous code, and hallucinations. A comprehensive approach combines content classification, quality checks, hallucination detection, and context-aware filtering. Regular updates to filtering rules and continuous monitoring ensure effective protection as new risks emerge.

