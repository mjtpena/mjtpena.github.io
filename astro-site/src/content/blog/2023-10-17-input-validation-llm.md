---
title: "Input Validation for LLM Applications"
author: Michael John Peña
draft: false
date: 2023-10-17
description: "Comprehensive input validation strategies for securing LLM applications against malicious inputs."
tags:
  - Input Validation
  - LLM Security
  - Data Validation
  - Security
  - AI

---

I wrote "Input Validation for LLM Applications" to share practical, production-minded guidance on this topic.

## Introduction

Input validation is the first line of defense for LLM applications. Proper validation prevents injection attacks, ensures data quality, and protects against abuse. This post covers comprehensive validation strategies for production systems.

## Input Validation Architecture

```python
from dataclasses import dataclass
from typing import List, Dict, Optional, Callable
from enum import Enum
import re

class ValidationLevel(Enum):
    STRICT = "strict"
    MODERATE = "moderate"
    PERMISSIVE = "permissive"

@dataclass
class ValidationResult:
    valid: bool
    sanitized_input: Optional[str]
    issues: List[Dict]
    risk_score: float

class InputValidator:
    """Comprehensive input validation for LLM applications"""

    def __init__(self, level: ValidationLevel = ValidationLevel.MODERATE):
        self.level = level
        self.validators: List[Callable] = []
        self._setup_default_validators()

    def _setup_default_validators(self):
        """Setup default validation rules"""
        self.validators = [
            self._validate_length,
            self._validate_encoding,
            self._validate_characters,
            self._validate_structure,
            self._validate_content
        ]

    def validate(self, user_input: str) -> ValidationResult:
        """Run all validators on input"""
        issues = []
        risk_score = 0.0

        for validator in self.validators:
            result = validator(user_input)
            if result["issues"]:
                issues.extend(result["issues"])
                risk_score += result["risk_contribution"]

        # Sanitize if needed
        sanitized = self._sanitize(user_input, issues) if issues else user_input

        # Determine validity
        valid = risk_score < self._get_threshold()

        return ValidationResult(
            valid=valid,
            sanitized_input=sanitized,
            issues=issues,
            risk_score=min(1.0, risk_score)
        )

    def _get_threshold(self) -> float:
        """Get risk threshold based on level"""
        thresholds = {
            ValidationLevel.STRICT: 0.3,
            ValidationLevel.MODERATE: 0.5,
            ValidationLevel.PERMISSIVE: 0.7
        }
        return thresholds[self.level]

    def _validate_length(self, text: str) -> Dict:
        """Validate input length"""
        issues = []
        risk = 0.0

        min_length = 1
        max_length = 10000

        if len(text) < min_length:
            issues.append({
                "type": "too_short",
                "message": "Input is empty or too short",
                "severity": "medium"
            })
            risk = 0.3

        if len(text) > max_length:
            issues.append({
                "type": "too_long",
                "message": f"Input exceeds {max_length} characters",
                "severity": "medium"
            })
            risk = 0.2

        return {"issues": issues, "risk_contribution": risk}

    def _validate_encoding(self, text: str) -> Dict:
        """Validate text encoding"""
        issues = []
        risk = 0.0

        try:
            text.encode('utf-8').decode('utf-8')
        except UnicodeError:
            issues.append({
                "type": "encoding_error",
                "message": "Invalid UTF-8 encoding",
                "severity": "high"
            })
            risk = 0.4

        # Check for null bytes
        if '\x00' in text:
            issues.append({
                "type": "null_bytes",
                "message": "Input contains null bytes",
                "severity": "high"
            })
            risk += 0.3

        return {"issues": issues, "risk_contribution": risk}

    def _validate_characters(self, text: str) -> Dict:
        """Validate character composition"""
        issues = []
        risk = 0.0

        # Check for control characters
        control_chars = re.findall(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', text)
        if control_chars:
            issues.append({
                "type": "control_characters",
                "message": f"Found {len(control_chars)} control characters",
                "severity": "medium"
            })
            risk = 0.2

        # Check for excessive special characters
        special_ratio = len(re.findall(r'[^\w\s]', text)) / max(len(text), 1)
        if special_ratio > 0.5:
            issues.append({
                "type": "excessive_special_chars",
                "message": f"High ratio of special characters ({special_ratio:.1%})",
                "severity": "low"
            })
            risk = 0.1

        return {"issues": issues, "risk_contribution": risk}

    def _validate_structure(self, text: str) -> Dict:
        """Validate input structure"""
        issues = []
        risk = 0.0

        # Check for suspicious delimiters
        suspicious_delimiters = [
            r'<\|.*?\|>',
            r'\[INST\]',
            r'\[\/INST\]',
            r'<<SYS>>',
            r'<\/s>',
            r'###'
        ]

        for pattern in suspicious_delimiters:
            if re.search(pattern, text):
                issues.append({
                    "type": "suspicious_delimiter",
                    "message": f"Found suspicious delimiter pattern",
                    "pattern": pattern,
                    "severity": "high"
                })
                risk += 0.3

        return {"issues": issues, "risk_contribution": min(1.0, risk)}

    def _validate_content(self, text: str) -> Dict:
        """Validate content for suspicious patterns"""
        issues = []
        risk = 0.0

        # Injection patterns
        injection_patterns = [
            (r'ignore (all )?(previous|prior|above)', "instruction_override", 0.4),
            (r'you are now', "role_change", 0.3),
            (r'pretend (to be|you)', "roleplay_attempt", 0.3),
            (r'system prompt', "system_probe", 0.2),
        ]

        for pattern, issue_type, risk_contrib in injection_patterns:
            if re.search(pattern, text.lower()):
                issues.append({
                    "type": issue_type,
                    "message": f"Detected potential {issue_type.replace('_', ' ')}",
                    "severity": "high" if risk_contrib > 0.3 else "medium"
                })
                risk += risk_contrib

        return {"issues": issues, "risk_contribution": min(1.0, risk)}

    def _sanitize(self, text: str, issues: List[Dict]) -> str:
        """Sanitize input based on detected issues"""
        sanitized = text

        for issue in issues:
            if issue["type"] == "control_characters":
                sanitized = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', sanitized)
            elif issue["type"] == "null_bytes":
                sanitized = sanitized.replace('\x00', '')
            elif issue["type"] == "suspicious_delimiter":
                # Remove suspicious delimiters
                sanitized = re.sub(issue.get("pattern", ""), "[filtered]", sanitized)

        return sanitized
```

## Type-Specific Validators

```python
from typing import Any
import json

class TypeValidator:
    """Validate specific input types"""

    @staticmethod
    def validate_json(text: str) -> ValidationResult:
        """Validate JSON input"""
        issues = []

        try:
            data = json.loads(text)

            # Check depth
            depth = TypeValidator._get_json_depth(data)
            if depth > 10:
                issues.append({
                    "type": "excessive_depth",
                    "message": f"JSON depth ({depth}) exceeds limit",
                    "severity": "medium"
                })

            # Check size
            if len(text) > 100000:
                issues.append({
                    "type": "excessive_size",
                    "message": "JSON too large",
                    "severity": "medium"
                })

        except json.JSONDecodeError as e:
            issues.append({
                "type": "invalid_json",
                "message": f"Invalid JSON: {str(e)}",
                "severity": "high"
            })

        return ValidationResult(
            valid=len(issues) == 0,
            sanitized_input=text,
            issues=issues,
            risk_score=0.5 if issues else 0.0
        )

    @staticmethod
    def _get_json_depth(obj: Any, current_depth: int = 0) -> int:
        """Calculate JSON nesting depth"""
        if isinstance(obj, dict):
            if not obj:
                return current_depth
            return max(TypeValidator._get_json_depth(v, current_depth + 1) for v in obj.values())
        elif isinstance(obj, list):
            if not obj:
                return current_depth
            return max(TypeValidator._get_json_depth(item, current_depth + 1) for item in obj)
        return current_depth

    @staticmethod
    def validate_url(text: str) -> ValidationResult:
        """Validate URL input"""
        import urllib.parse
        issues = []

        try:
            parsed = urllib.parse.urlparse(text)

            # Check scheme
            if parsed.scheme not in ['http', 'https']:
                issues.append({
                    "type": "invalid_scheme",
                    "message": f"Invalid URL scheme: {parsed.scheme}",
                    "severity": "medium"
                })

            # Check for suspicious patterns
            if re.search(r'(localhost|127\.0\.0\.1|0\.0\.0\.0)', text):
                issues.append({
                    "type": "localhost_url",
                    "message": "URL points to localhost",
                    "severity": "high"
                })

            # Check for common SSRF patterns
            if re.search(r'(169\.254\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)', text):
                issues.append({
                    "type": "internal_ip",
                    "message": "URL points to internal IP",
                    "severity": "high"
                })

        except Exception as e:
            issues.append({
                "type": "invalid_url",
                "message": str(e),
                "severity": "high"
            })

        return ValidationResult(
            valid=len([i for i in issues if i["severity"] == "high"]) == 0,
            sanitized_input=text,
            issues=issues,
            risk_score=0.7 if issues else 0.0
        )

    @staticmethod
    def validate_code(text: str, language: str = "python") -> ValidationResult:
        """Validate code input"""
        issues = []

        dangerous_patterns = {
            "python": [
                (r'import\s+os', "os_import", "medium"),
                (r'import\s+subprocess', "subprocess_import", "high"),
                (r'exec\s*\(', "exec_call", "high"),
                (r'eval\s*\(', "eval_call", "high"),
                (r'__import__', "dynamic_import", "high"),
                (r'open\s*\(', "file_open", "medium"),
            ],
            "javascript": [
                (r'eval\s*\(', "eval_call", "high"),
                (r'Function\s*\(', "function_constructor", "high"),
                (r'require\s*\([\'"]child_process', "child_process", "high"),
            ]
        }

        patterns = dangerous_patterns.get(language, [])

        for pattern, issue_type, severity in patterns:
            if re.search(pattern, text):
                issues.append({
                    "type": issue_type,
                    "message": f"Detected potentially dangerous pattern",
                    "severity": severity
                })

        high_severity = sum(1 for i in issues if i["severity"] == "high")

        return ValidationResult(
            valid=high_severity == 0,
            sanitized_input=text,
            issues=issues,
            risk_score=min(1.0, high_severity * 0.3 + len(issues) * 0.1)
        )
```

## Context-Aware Validation

```python
class ContextAwareValidator:
    """Validate input based on application context"""

    def __init__(self, context: Dict):
        self.context = context
        self.base_validator = InputValidator()

    def validate(self, user_input: str) -> ValidationResult:
        """Validate with context awareness"""
        # Base validation
        base_result = self.base_validator.validate(user_input)

        # Context-specific validation
        context_issues = self._validate_for_context(user_input)

        # Combine results
        all_issues = base_result.issues + context_issues
        risk_score = min(1.0, base_result.risk_score + len(context_issues) * 0.1)

        return ValidationResult(
            valid=base_result.valid and len(context_issues) == 0,
            sanitized_input=base_result.sanitized_input,
            issues=all_issues,
            risk_score=risk_score
        )

    def _validate_for_context(self, text: str) -> List[Dict]:
        """Apply context-specific validations"""
        issues = []

        app_type = self.context.get("app_type", "general")

        if app_type == "customer_service":
            issues.extend(self._validate_customer_service(text))
        elif app_type == "code_assistant":
            issues.extend(self._validate_code_assistant(text))
        elif app_type == "medical":
            issues.extend(self._validate_medical(text))

        return issues

    def _validate_customer_service(self, text: str) -> List[Dict]:
        """Validation for customer service context"""
        issues = []

        # Check for competitor mentions (might be relevant)
        # Check for profanity
        profanity_pattern = r'\b(damn|hell|crap)\b'  # Simplified example
        if re.search(profanity_pattern, text.lower()):
            issues.append({
                "type": "profanity",
                "message": "Input contains profanity",
                "severity": "low"
            })

        return issues

    def _validate_code_assistant(self, text: str) -> List[Dict]:
        """Validation for code assistant context"""
        issues = []

        # Check for attempts to access file system
        if re.search(r'(\/etc\/passwd|\.env|credentials)', text):
            issues.append({
                "type": "sensitive_path",
                "message": "Reference to sensitive file paths",
                "severity": "high"
            })

        return issues

    def _validate_medical(self, text: str) -> List[Dict]:
        """Validation for medical context"""
        issues = []

        # Flag potential emergencies
        emergency_patterns = [
            r'(heart attack|stroke|can\'t breathe|overdose)',
            r'(bleeding heavily|severe pain|unconscious)'
        ]

        for pattern in emergency_patterns:
            if re.search(pattern, text.lower()):
                issues.append({
                    "type": "potential_emergency",
                    "message": "Input may indicate medical emergency",
                    "severity": "high",
                    "action": "escalate"
                })

        return issues

# Usage
context = {"app_type": "customer_service", "user_tier": "premium"}
validator = ContextAwareValidator(context)

result = validator.validate("I need help with my order, this is frustrating!")
print(f"Valid: {result.valid}")
print(f"Issues: {result.issues}")
```

## Rate Limiting and Abuse Prevention

```python
from datetime import datetime, timedelta
from collections import defaultdict

class RateLimiter:
    """Rate limiting for input validation"""

    def __init__(self, max_requests: int = 100, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = timedelta(seconds=window_seconds)
        self.requests: Dict[str, List[datetime]] = defaultdict(list)

    def check_rate_limit(self, user_id: str) -> Dict:
        """Check if user is within rate limit"""
        now = datetime.now()
        cutoff = now - self.window

        # Clean old requests
        self.requests[user_id] = [
            t for t in self.requests[user_id] if t > cutoff
        ]

        # Check limit
        current_count = len(self.requests[user_id])

        if current_count >= self.max_requests:
            return {
                "allowed": False,
                "current_count": current_count,
                "reset_time": min(self.requests[user_id]) + self.window
            }

        # Record this request
        self.requests[user_id].append(now)

        return {
            "allowed": True,
            "current_count": current_count + 1,
            "remaining": self.max_requests - current_count - 1
        }

class InputValidationPipeline:
    """Complete input validation pipeline"""

    def __init__(self):
        self.validator = InputValidator()
        self.rate_limiter = RateLimiter()
        self.type_validator = TypeValidator()

    def process(
        self,
        user_input: str,
        user_id: str,
        input_type: str = "text"
    ) -> Dict:
        """Process input through validation pipeline"""
        # Check rate limit
        rate_check = self.rate_limiter.check_rate_limit(user_id)
        if not rate_check["allowed"]:
            return {
                "success": False,
                "error": "rate_limit_exceeded",
                "reset_time": rate_check["reset_time"].isoformat()
            }

        # Base validation
        base_result = self.validator.validate(user_input)

        # Type-specific validation
        if input_type == "json":
            type_result = self.type_validator.validate_json(user_input)
        elif input_type == "url":
            type_result = self.type_validator.validate_url(user_input)
        elif input_type == "code":
            type_result = self.type_validator.validate_code(user_input)
        else:
            type_result = None

        # Combine results
        all_issues = base_result.issues
        if type_result:
            all_issues.extend(type_result.issues)

        valid = base_result.valid and (type_result is None or type_result.valid)

        return {
            "success": valid,
            "sanitized_input": base_result.sanitized_input,
            "issues": all_issues,
            "risk_score": base_result.risk_score,
            "rate_limit_remaining": rate_check["remaining"]
        }

# Usage
pipeline = InputValidationPipeline()

result = pipeline.process(
    user_input="What is the capital of France?",
    user_id="user_123",
    input_type="text"
)

print(f"Success: {result['success']}")
print(f"Risk Score: {result['risk_score']:.2f}")
```

## Conclusion

Input validation is critical for LLM application security. A comprehensive approach includes length and encoding checks, structure validation, content analysis, type-specific validation, context awareness, and rate limiting. Implementing these layers protects against injection attacks and abuse while ensuring data quality.

