---
title: "UI Automation with AI: Beyond Traditional Scripting"
description: "AI-powered UI automation adapts to changes, understands context, and can recover from errors - capabilities that traditional automation simply cannot match."
author: "Michael John Peña"
draft: false
date: 2024-10-03
tags: ["UI Automation", "AI", "Computer Use", "Testing", "RPA"]
---

## Vision-Based UI Understanding

```python
import anthropic
import base64
from PIL import Image
import io

client = anthropic.Anthropic()

def analyze_ui(screenshot_path: str) -> dict:
    """Analyze a UI screenshot to understand its elements"""

    with open(screenshot_path, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode()

    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": image_data
                        }
                    },
                    {
                        "type": "text",
                        "text": """Analyze this UI screenshot and identify:
                        1. All interactive elements (buttons, links, inputs)
                        2. Their approximate locations (as percentages of screen)
                        3. Their current state (enabled/disabled, selected, etc.)
                        4. Any visible text or labels
                        5. The overall purpose of this screen

                        Return as structured JSON."""
                    }
                ]
            }
        ]
    )

    return response.content[0].text

def find_element(screenshot: str, description: str) -> dict:
    """Find a UI element by natural language description"""

    with open(screenshot, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode()

    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": image_data
                        }
                    },
                    {
                        "type": "text",
                        "text": f"""Find the UI element matching this description: "{description}"

                        Return JSON with:
                        - found: boolean
                        - element_type: type of element
                        - x_percent: horizontal position (0-100)
                        - y_percent: vertical position (0-100)
                        - confidence: how confident you are (0-1)
                        - alternative_descriptions: other ways to describe this element"""
                    }
                ]
            }
        ]
    )

    import json
    return json.loads(response.content[0].text)
```

## Adaptive Element Location

```python
import pyautogui
from dataclasses import dataclass
from typing import Optional, Tuple

@dataclass
class UIElement:
    """Represents a UI element with multiple location strategies"""
    description: str
    x_percent: float
    y_percent: float
    text: Optional[str] = None
    element_type: Optional[str] = None

class AdaptiveLocator:
    """Locate elements using multiple strategies"""

    def __init__(self, screen_width: int = 1920, screen_height: int = 1080):
        self.screen_width = screen_width
        self.screen_height = screen_height

    def locate(self, element: UIElement) -> Tuple[int, int]:
        """Get absolute coordinates for an element"""

        # Strategy 1: Text-based search (if text is available)
        if element.text:
            location = pyautogui.locateOnScreen(element.text)
            if location:
                return pyautogui.center(location)

        # Strategy 2: Percentage-based positioning
        x = int((element.x_percent / 100) * self.screen_width)
        y = int((element.y_percent / 100) * self.screen_height)

        return (x, y)

    def locate_with_ai(self, description: str, screenshot_path: str) -> Tuple[int, int]:
        """Locate element using AI vision"""

        result = find_element(screenshot_path, description)

        if not result.get("found"):
            raise ElementNotFoundError(f"Could not find: {description}")

        x = int((result["x_percent"] / 100) * self.screen_width)
        y = int((result["y_percent"] / 100) * self.screen_height)

        return (x, y)

class ElementNotFoundError(Exception):
    pass
```

## Intelligent Action Sequencing

```python
class UIAutomationAgent:
    """AI-powered UI automation agent"""

    def __init__(self):
        self.locator = AdaptiveLocator()
        self.action_history = []

    def execute_task(self, task: str, screenshot_path: str) -> bool:
        """Execute a high-level task on the UI"""

        # Analyze current UI state
        ui_state = analyze_ui(screenshot_path)

        # Generate action plan
        plan = self._generate_plan(task, ui_state)

        # Execute each action
        for action in plan:
            success = self._execute_action(action, screenshot_path)
            if not success:
                # Try to recover
                if not self._recover(action, screenshot_path):
                    return False

            # Capture new screenshot for next action
            screenshot_path = self._capture_screenshot()

        return True

    def _generate_plan(self, task: str, ui_state: str) -> list:
        """Generate action plan for task"""

        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=2048,
            messages=[
                {
                    "role": "user",
                    "content": f"""
                    Task: {task}

                    Current UI state:
                    {ui_state}

                    Generate a sequence of UI actions to complete this task.
                    Return JSON array with each action having:
                    - action_type: click/type/scroll/wait
                    - target: description of element to interact with
                    - value: value to type (for type actions)
                    - reasoning: why this action is needed
                    """
                }
            ]
        )

        import json
        return json.loads(response.content[0].text)

    def _execute_action(self, action: dict, screenshot_path: str) -> bool:
        """Execute a single action"""

        try:
            if action["action_type"] == "click":
                x, y = self.locator.locate_with_ai(
                    action["target"],
                    screenshot_path
                )
                pyautogui.click(x, y)

            elif action["action_type"] == "type":
                x, y = self.locator.locate_with_ai(
                    action["target"],
                    screenshot_path
                )
                pyautogui.click(x, y)
                pyautogui.write(action["value"])

            elif action["action_type"] == "scroll":
                pyautogui.scroll(int(action.get("value", 3)))

            elif action["action_type"] == "wait":
                import time
                time.sleep(float(action.get("value", 1)))

            self.action_history.append({
                "action": action,
                "success": True
            })
            return True

        except Exception as e:
            self.action_history.append({
                "action": action,
                "success": False,
                "error": str(e)
            })
            return False

    def _recover(self, failed_action: dict, screenshot_path: str) -> bool:
        """Attempt to recover from a failed action"""

        # Analyze what went wrong
        ui_state = analyze_ui(screenshot_path)

        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": f"""
                    An action failed: {failed_action}

                    Current UI state:
                    {ui_state}

                    Suggest an alternative way to achieve the same goal.
                    Return JSON with alternative action or null if unrecoverable.
                    """
                }
            ]
        )

        import json
        alternative = json.loads(response.content[0].text)

        if alternative:
            return self._execute_action(alternative, screenshot_path)

        return False

    def _capture_screenshot(self) -> str:
        """Capture current screen"""
        import tempfile
        screenshot = pyautogui.screenshot()
        path = tempfile.mktemp(suffix=".png")
        screenshot.save(path)
        return path
```

## Form Filling Automation

```python
class FormFiller:
    """AI-powered form filling"""

    def __init__(self):
        self.agent = UIAutomationAgent()

    def fill_form(self, form_data: dict, screenshot_path: str) -> bool:
        """Fill a form with provided data"""

        # Analyze form structure
        form_analysis = self._analyze_form(screenshot_path)

        # Map data to fields
        field_mapping = self._map_fields(form_data, form_analysis)

        # Fill each field
        for field_name, field_info in field_mapping.items():
            value = form_data.get(field_name)
            if value:
                success = self._fill_field(field_info, value, screenshot_path)
                if not success:
                    return False

                # Update screenshot
                screenshot_path = self.agent._capture_screenshot()

        return True

    def _analyze_form(self, screenshot_path: str) -> dict:
        """Analyze form structure"""

        with open(screenshot_path, "rb") as f:
            image_data = base64.standard_b64encode(f.read()).decode()

        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=2048,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": image_data
                            }
                        },
                        {
                            "type": "text",
                            "text": """Analyze this form and identify all fields.
                            For each field return:
                            - field_name: likely data field name
                            - label: visible label
                            - field_type: text/dropdown/checkbox/radio
                            - position: {x_percent, y_percent}
                            - required: boolean"""
                        }
                    ]
                }
            ]
        )

        import json
        return json.loads(response.content[0].text)

    def _map_fields(self, data: dict, form: dict) -> dict:
        """Map data keys to form fields"""

        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": f"""
                    Match data fields to form fields:

                    Data keys: {list(data.keys())}

                    Form fields: {form}

                    Return mapping as JSON: {{"data_key": form_field_info}}
                    """
                }
            ]
        )

        import json
        return json.loads(response.content[0].text)

    def _fill_field(self, field: dict, value: str, screenshot_path: str) -> bool:
        """Fill a single form field"""

        action = {
            "action_type": "type",
            "target": field["label"],
            "value": value
        }

        return self.agent._execute_action(action, screenshot_path)
```

AI-powered UI automation adapts to changes, understands context, and can recover from errors - capabilities that traditional automation simply cannot match.
