---
title: "PII Detection and Protection in AI Applications"
author: Michael John Peña
draft: false
date: 2023-10-22
description: "Implementing comprehensive PII detection and protection strategies for AI applications."
tags:
  - PII Detection
  - Privacy
  - Data Protection
  - Security
  - AI

---

I wrote "PII Detection and Protection in AI Applications" to share practical, production-minded guidance on this topic.

## Introduction

Personally Identifiable Information (PII) detection is critical for privacy-preserving AI applications. This post covers techniques for detecting, masking, and protecting PII in text data processed by AI systems.

## PII Types and Patterns

```python
from dataclasses import dataclass
from typing import List, Dict, Pattern
from enum import Enum
import re

class PIIType(Enum):
    SSN = "social_security_number"
    CREDIT_CARD = "credit_card"
    EMAIL = "email"
    PHONE = "phone_number"
    ADDRESS = "address"
    NAME = "person_name"
    DOB = "date_of_birth"
    PASSPORT = "passport_number"
    DRIVER_LICENSE = "driver_license"
    BANK_ACCOUNT = "bank_account"
    IP_ADDRESS = "ip_address"
    MEDICAL_RECORD = "medical_record"

@dataclass
class PIIPattern:
    pii_type: PIIType
    pattern: str
    description: str
    confidence: float
    region: str = "US"

class PIIPatternLibrary:
    """Library of PII detection patterns"""

    @staticmethod
    def get_patterns() -> List[PIIPattern]:
        return [
            PIIPattern(
                pii_type=PIIType.SSN,
                pattern=r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b",
                description="US Social Security Number",
                confidence=0.9,
                region="US"
            ),
            PIIPattern(
                pii_type=PIIType.CREDIT_CARD,
                pattern=r"\b(?:\d{4}[-\s]?){3}\d{4}\b",
                description="Credit Card Number (16 digits)",
                confidence=0.85
            ),
            PIIPattern(
                pii_type=PIIType.EMAIL,
                pattern=r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
                description="Email Address",
                confidence=0.95
            ),
            PIIPattern(
                pii_type=PIIType.PHONE,
                pattern=r"\b(?:\+1[-\s]?)?\(?[2-9]\d{2}\)?[-\s]?\d{3}[-\s]?\d{4}\b",
                description="US Phone Number",
                confidence=0.8,
                region="US"
            ),
            PIIPattern(
                pii_type=PIIType.DOB,
                pattern=r"\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}\b",
                description="Date of Birth (MM/DD/YYYY)",
                confidence=0.7
            ),
            PIIPattern(
                pii_type=PIIType.IP_ADDRESS,
                pattern=r"\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b",
                description="IPv4 Address",
                confidence=0.9
            ),
            PIIPattern(
                pii_type=PIIType.PASSPORT,
                pattern=r"\b[A-Z]{1,2}\d{6,9}\b",
                description="Passport Number",
                confidence=0.6
            )
        ]
```

## PII Detector Implementation

```python
@dataclass
class PIIMatch:
    pii_type: PIIType
    value: str
    start: int
    end: int
    confidence: float
    masked_value: str

class PIIDetector:
    """Comprehensive PII detection"""

    def __init__(self):
        self.patterns = PIIPatternLibrary.get_patterns()
        self.compiled_patterns = {
            p.pii_type: re.compile(p.pattern, re.IGNORECASE)
            for p in self.patterns
        }
        self.pattern_confidence = {
            p.pii_type: p.confidence
            for p in self.patterns
        }

    def detect(self, text: str) -> List[PIIMatch]:
        """Detect all PII in text"""
        matches = []

        for pii_type, pattern in self.compiled_patterns.items():
            for match in pattern.finditer(text):
                value = match.group()

                # Validate match
                if self._validate_match(pii_type, value):
                    matches.append(PIIMatch(
                        pii_type=pii_type,
                        value=value,
                        start=match.start(),
                        end=match.end(),
                        confidence=self.pattern_confidence[pii_type],
                        masked_value=self._mask_value(pii_type, value)
                    ))

        # Sort by position
        matches.sort(key=lambda m: m.start)

        # Remove overlapping matches (keep higher confidence)
        matches = self._remove_overlaps(matches)

        return matches

    def _validate_match(self, pii_type: PIIType, value: str) -> bool:
        """Validate detected PII"""
        if pii_type == PIIType.SSN:
            return self._validate_ssn(value)
        elif pii_type == PIIType.CREDIT_CARD:
            return self._validate_credit_card(value)
        elif pii_type == PIIType.EMAIL:
            return self._validate_email(value)
        return True

    def _validate_ssn(self, value: str) -> bool:
        """Validate SSN format"""
        digits = re.sub(r'\D', '', value)
        if len(digits) != 9:
            return False
        # Check for invalid area numbers
        area = int(digits[:3])
        if area == 0 or area == 666 or area >= 900:
            return False
        return True

    def _validate_credit_card(self, value: str) -> bool:
        """Validate credit card using Luhn algorithm"""
        digits = re.sub(r'\D', '', value)
        if len(digits) != 16:
            return False

        # Luhn algorithm
        total = 0
        for i, digit in enumerate(reversed(digits)):
            d = int(digit)
            if i % 2 == 1:
                d *= 2
                if d > 9:
                    d -= 9
            total += d

        return total % 10 == 0

    def _validate_email(self, value: str) -> bool:
        """Validate email format"""
        # Additional validation beyond regex
        if '..' in value:
            return False
        if value.startswith('.') or value.endswith('.'):
            return False
        return True

    def _mask_value(self, pii_type: PIIType, value: str) -> str:
        """Mask PII value"""
        masking_strategies = {
            PIIType.SSN: lambda v: "***-**-" + v[-4:] if len(v) >= 4 else "***",
            PIIType.CREDIT_CARD: lambda v: "**** **** **** " + re.sub(r'\D', '', v)[-4:],
            PIIType.EMAIL: lambda v: v[0] + "***@" + v.split('@')[-1] if '@' in v else "***",
            PIIType.PHONE: lambda v: "***-***-" + re.sub(r'\D', '', v)[-4:],
            PIIType.DOB: lambda v: "**/**/****",
            PIIType.IP_ADDRESS: lambda v: ".".join(["***"] * 4),
        }

        strategy = masking_strategies.get(pii_type, lambda v: "***")
        return strategy(value)

    def _remove_overlaps(self, matches: List[PIIMatch]) -> List[PIIMatch]:
        """Remove overlapping matches, keeping higher confidence"""
        if not matches:
            return matches

        result = [matches[0]]

        for match in matches[1:]:
            prev = result[-1]
            # Check for overlap
            if match.start < prev.end:
                # Keep higher confidence
                if match.confidence > prev.confidence:
                    result[-1] = match
            else:
                result.append(match)

        return result

# Usage
detector = PIIDetector()

text = """
Contact John Doe at john.doe@email.com or call 555-123-4567.
SSN: 123-45-6789, Credit Card: 4532-1234-5678-9012
"""

matches = detector.detect(text)
for match in matches:
    print(f"Type: {match.pii_type.value}")
    print(f"Value: {match.value} -> {match.masked_value}")
    print(f"Confidence: {match.confidence}")
    print()
```

## PII Redaction and Masking

```python
class PIIRedactor:
    """Redact PII from text"""

    def __init__(self, detector: PIIDetector = None):
        self.detector = detector or PIIDetector()

    def redact(self, text: str, replacement: str = "[REDACTED]") -> Dict:
        """Redact all PII from text"""
        matches = self.detector.detect(text)

        if not matches:
            return {
                "original": text,
                "redacted": text,
                "pii_count": 0,
                "pii_found": []
            }

        # Redact from end to start to preserve positions
        redacted = text
        for match in reversed(matches):
            redacted = redacted[:match.start] + replacement + redacted[match.end:]

        return {
            "original": text,
            "redacted": redacted,
            "pii_count": len(matches),
            "pii_found": [
                {
                    "type": m.pii_type.value,
                    "masked": m.masked_value,
                    "position": (m.start, m.end)
                }
                for m in matches
            ]
        }

    def mask(self, text: str) -> Dict:
        """Mask PII while preserving format"""
        matches = self.detector.detect(text)

        if not matches:
            return {
                "original": text,
                "masked": text,
                "pii_count": 0
            }

        masked = text
        for match in reversed(matches):
            masked = masked[:match.start] + match.masked_value + masked[match.end:]

        return {
            "original": text,
            "masked": masked,
            "pii_count": len(matches)
        }

    def tokenize(self, text: str) -> Dict:
        """Replace PII with tokens for later restoration"""
        matches = self.detector.detect(text)

        if not matches:
            return {
                "tokenized": text,
                "tokens": {},
                "pii_count": 0
            }

        import uuid
        tokens = {}
        tokenized = text

        for match in reversed(matches):
            token = f"[PII_{match.pii_type.name}_{uuid.uuid4().hex[:8]}]"
            tokens[token] = match.value
            tokenized = tokenized[:match.start] + token + tokenized[match.end:]

        return {
            "tokenized": tokenized,
            "tokens": tokens,
            "pii_count": len(matches)
        }

    def restore(self, tokenized_text: str, tokens: Dict) -> str:
        """Restore PII from tokens"""
        restored = tokenized_text
        for token, value in tokens.items():
            restored = restored.replace(token, value)
        return restored

# Usage
redactor = PIIRedactor()

text = "Email me at john@example.com or call 555-123-4567"

# Redact
result = redactor.redact(text)
print(f"Redacted: {result['redacted']}")

# Mask
result = redactor.mask(text)
print(f"Masked: {result['masked']}")

# Tokenize
result = redactor.tokenize(text)
print(f"Tokenized: {result['tokenized']}")
restored = redactor.restore(result['tokenized'], result['tokens'])
print(f"Restored: {restored}")
```

## Context-Aware PII Detection

```python
class ContextAwarePIIDetector:
    """PII detection with context awareness"""

    def __init__(self):
        self.base_detector = PIIDetector()
        self.context_indicators = {
            PIIType.SSN: ["ssn", "social security", "social sec"],
            PIIType.CREDIT_CARD: ["card", "credit", "visa", "mastercard", "payment"],
            PIIType.PHONE: ["phone", "call", "tel", "mobile", "cell"],
            PIIType.EMAIL: ["email", "e-mail", "contact", "mail"],
            PIIType.DOB: ["born", "birthday", "dob", "birth date", "date of birth"],
            PIIType.ADDRESS: ["address", "street", "city", "zip", "postal"]
        }

    def detect_with_context(self, text: str) -> List[Dict]:
        """Detect PII with context boost"""
        # Base detection
        matches = self.base_detector.detect(text)

        # Boost confidence based on context
        text_lower = text.lower()
        enhanced_matches = []

        for match in matches:
            context_boost = self._calculate_context_boost(
                text_lower,
                match.start,
                match.pii_type
            )

            enhanced_confidence = min(1.0, match.confidence + context_boost)

            enhanced_matches.append({
                "pii_type": match.pii_type.value,
                "value": match.value,
                "masked_value": match.masked_value,
                "base_confidence": match.confidence,
                "context_boost": context_boost,
                "final_confidence": enhanced_confidence,
                "position": (match.start, match.end)
            })

        return enhanced_matches

    def _calculate_context_boost(
        self,
        text: str,
        position: int,
        pii_type: PIIType
    ) -> float:
        """Calculate confidence boost from context"""
        # Look at surrounding text (50 chars before)
        start = max(0, position - 50)
        context = text[start:position]

        indicators = self.context_indicators.get(pii_type, [])
        boost = 0.0

        for indicator in indicators:
            if indicator in context:
                boost += 0.1

        return min(0.2, boost)  # Cap boost at 0.2

class NamedEntityPIIDetector:
    """Detect names and other entities as PII"""

    def __init__(self):
        # In production, use spaCy or similar NER model
        self.name_patterns = [
            r"\b[A-Z][a-z]+\s+[A-Z][a-z]+\b",  # First Last
            r"\b[A-Z][a-z]+\s+[A-Z]\.\s+[A-Z][a-z]+\b",  # First M. Last
        ]
        self.title_prefixes = ["mr", "mrs", "ms", "dr", "prof"]

    def detect_names(self, text: str) -> List[Dict]:
        """Detect potential names in text"""
        matches = []

        for pattern in self.name_patterns:
            for match in re.finditer(pattern, text):
                value = match.group()

                # Check for title prefix
                has_title = any(
                    text[max(0, match.start()-5):match.start()].lower().endswith(title)
                    for title in self.title_prefixes
                )

                confidence = 0.7 if has_title else 0.5

                matches.append({
                    "type": "person_name",
                    "value": value,
                    "position": (match.start(), match.end()),
                    "confidence": confidence
                })

        return matches
```

## PII Protection Pipeline

```python
class PIIProtectionPipeline:
    """Complete PII protection pipeline"""

    def __init__(self, mode: str = "mask"):
        self.detector = PIIDetector()
        self.context_detector = ContextAwarePIIDetector()
        self.redactor = PIIRedactor(self.detector)
        self.mode = mode  # mask, redact, or tokenize

    def process(self, text: str) -> Dict:
        """Process text through PII protection pipeline"""
        # Detect with context
        detections = self.context_detector.detect_with_context(text)

        # Apply protection based on mode
        if self.mode == "mask":
            protected = self.redactor.mask(text)
        elif self.mode == "redact":
            protected = self.redactor.redact(text)
        elif self.mode == "tokenize":
            protected = self.redactor.tokenize(text)
        else:
            protected = {"processed": text}

        return {
            "original_length": len(text),
            "detections": detections,
            "pii_count": len(detections),
            "protection_mode": self.mode,
            **protected
        }

    def process_for_llm(self, text: str) -> Dict:
        """Process text for LLM input with PII tokenization"""
        # Tokenize PII
        result = self.redactor.tokenize(text)

        return {
            "llm_safe_text": result["tokenized"],
            "pii_tokens": result["tokens"],
            "pii_count": result["pii_count"],
            "can_restore": True
        }

    def restore_from_llm(self, llm_output: str, tokens: Dict) -> str:
        """Restore PII in LLM output"""
        return self.redactor.restore(llm_output, tokens)

# Usage
pipeline = PIIProtectionPipeline(mode="mask")

text = """
Customer: John Smith
Email: john.smith@company.com
Phone: (555) 123-4567
SSN: 123-45-6789
"""

result = pipeline.process(text)
print(f"PII found: {result['pii_count']}")
print(f"Protected text:\n{result['masked']}")

# For LLM processing
llm_prep = pipeline.process_for_llm(text)
print(f"\nLLM-safe text:\n{llm_prep['llm_safe_text']}")
```

## Compliance and Reporting

```python
from datetime import datetime

class PIIComplianceReporter:
    """Generate PII compliance reports"""

    def __init__(self):
        self.pipeline = PIIProtectionPipeline()
        self.processing_log = []

    def process_and_log(self, text: str, source: str = "unknown") -> Dict:
        """Process text and log for compliance"""
        result = self.pipeline.process(text)

        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "source": source,
            "pii_count": result["pii_count"],
            "pii_types": [d["pii_type"] for d in result["detections"]],
            "protection_applied": result["protection_mode"]
        }
        self.processing_log.append(log_entry)

        return result

    def generate_report(self) -> Dict:
        """Generate compliance report"""
        if not self.processing_log:
            return {"error": "No processing history"}

        total_processed = len(self.processing_log)
        total_pii = sum(e["pii_count"] for e in self.processing_log)

        # Count by type
        type_counts = {}
        for entry in self.processing_log:
            for pii_type in entry["pii_types"]:
                type_counts[pii_type] = type_counts.get(pii_type, 0) + 1

        return {
            "report_generated": datetime.now().isoformat(),
            "total_texts_processed": total_processed,
            "total_pii_detected": total_pii,
            "pii_by_type": type_counts,
            "protection_rate": 1.0,  # All detected PII was protected
            "compliance_status": "compliant"
        }

# Usage
reporter = PIIComplianceReporter()

texts = [
    "Contact me at user@email.com",
    "My SSN is 123-45-6789",
    "Call 555-0123 for support"
]

for text in texts:
    reporter.process_and_log(text, source="user_input")

report = reporter.generate_report()
print(f"Total PII detected: {report['total_pii_detected']}")
print(f"PII by type: {report['pii_by_type']}")
```

## Conclusion

PII detection and protection is essential for privacy-preserving AI applications. A comprehensive approach includes pattern-based detection, validation, context-aware confidence boosting, and flexible protection modes. Compliance reporting and audit logging ensure regulatory requirements are met while maintaining user privacy.

