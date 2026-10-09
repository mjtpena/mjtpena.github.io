---
title: "Desktop Automation with AI: Controlling Any Application"
description: "Desktop automation with AI brings human-like understanding to any application, enabling automation of complex workflows that were previously impossible to…"
author: "Michael John Peña"
draft: false
date: 2024-10-05
tags: ["Desktop Automation", "AI", "RPA", "Computer Use", "Productivity"]
---

## Cross-Platform Desktop Agent

```python
import pyautogui
import anthropic
import base64
from PIL import ImageGrab
import subprocess
import platform
from typing import Optional, Tuple
import time

client = anthropic.Anthropic()

class DesktopAutomationAgent:
    """AI-powered desktop automation agent"""

    def __init__(self):
        self.system = platform.system()
        pyautogui.PAUSE = 0.5  # Add small delay between actions
        pyautogui.FAILSAFE = True  # Move mouse to corner to abort

    def capture_screen(self) -> str:
        """Capture full screen as base64"""
        screenshot = ImageGrab.grab()
        import io
        buffer = io.BytesIO()
        screenshot.save(buffer, format="PNG")
        return base64.standard_b64encode(buffer.getvalue()).decode()

    def capture_region(self, x: int, y: int, width: int, height: int) -> str:
        """Capture a specific region"""
        screenshot = ImageGrab.grab(bbox=(x, y, x + width, y + height))
        import io
        buffer = io.BytesIO()
        screenshot.save(buffer, format="PNG")
        return base64.standard_b64encode(buffer.getvalue()).decode()

    def execute_task(self, task: str, max_iterations: int = 15) -> bool:
        """Execute a desktop automation task"""

        for i in range(max_iterations):
            screenshot = self.capture_screen()

            # Get next action from AI
            action = self._get_next_action(task, screenshot, i)

            if action["type"] == "complete":
                print(f"Task completed in {i + 1} iterations")
                return True

            if action["type"] == "failed":
                print(f"Task failed: {action.get('reason', 'Unknown error')}")
                return False

            # Execute the action
            self._execute_action(action)

            # Small delay for UI to update
            time.sleep(0.5)

        print("Max iterations reached")
        return False

    def _get_next_action(self, task: str, screenshot: str, iteration: int) -> dict:
        """Determine the next action using AI"""

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
                                "data": screenshot
                            }
                        },
                        {
                            "type": "text",
                            "text": f"""
                            Task: {task}
                            Iteration: {iteration + 1}
                            Operating System: {self.system}
                            Screen Resolution: {pyautogui.size()}

                            Determine the next action to accomplish this task.
                            Return JSON with:
                            - type: click/double_click/right_click/type/hotkey/scroll/move/complete/failed
                            - x: x coordinate (for mouse actions)
                            - y: y coordinate (for mouse actions)
                            - text: text to type (for type action)
                            - keys: list of keys (for hotkey action, e.g., ["ctrl", "c"])
                            - direction: up/down (for scroll)
                            - amount: scroll amount
                            - reasoning: explanation of why this action
                            """
                        }
                    ]
                }
            ]
        )

        import json
        return json.loads(response.content[0].text)

    def _execute_action(self, action: dict):
        """Execute a desktop action"""

        action_type = action["type"]

        if action_type == "click":
            pyautogui.click(action["x"], action["y"])

        elif action_type == "double_click":
            pyautogui.doubleClick(action["x"], action["y"])

        elif action_type == "right_click":
            pyautogui.rightClick(action["x"], action["y"])

        elif action_type == "type":
            pyautogui.write(action["text"], interval=0.05)

        elif action_type == "hotkey":
            pyautogui.hotkey(*action["keys"])

        elif action_type == "scroll":
            amount = action.get("amount", 3)
            if action.get("direction") == "up":
                pyautogui.scroll(amount)
            else:
                pyautogui.scroll(-amount)

        elif action_type == "move":
            pyautogui.moveTo(action["x"], action["y"])

        print(f"Executed: {action_type} - {action.get('reasoning', '')}")
```

## Application-Specific Automation

```python
class ApplicationAutomator:
    """Automate specific desktop applications"""

    def __init__(self, agent: DesktopAutomationAgent):
        self.agent = agent
        self.app_contexts = {}

    def open_application(self, app_name: str) -> bool:
        """Open a desktop application"""

        system = platform.system()

        if system == "Windows":
            # Use Windows search
            pyautogui.hotkey("win")
            time.sleep(0.5)
            pyautogui.write(app_name, interval=0.05)
            time.sleep(0.5)
            pyautogui.press("enter")

        elif system == "Darwin":  # macOS
            # Use Spotlight
            pyautogui.hotkey("command", "space")
            time.sleep(0.5)
            pyautogui.write(app_name, interval=0.05)
            time.sleep(0.5)
            pyautogui.press("return")

        elif system == "Linux":
            # Try common launchers
            subprocess.Popen([app_name.lower()])

        # Wait for app to open
        time.sleep(2)

        # Verify app is open
        return self._verify_app_opened(app_name)

    def _verify_app_opened(self, app_name: str) -> bool:
        """Verify the application opened successfully"""

        screenshot = self.agent.capture_screen()

        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=256,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": screenshot
                            }
                        },
                        {
                            "type": "text",
                            "text": f"""
                            Is {app_name} currently open and visible on screen?
                            Return JSON: {{"is_open": boolean, "confidence": 0-1}}
                            """
                        }
                    ]
                }
            ]
        )

        import json
        result = json.loads(response.content[0].text)
        return result["is_open"] and result["confidence"] > 0.7

    def use_excel(self, file_path: str, operations: list) -> bool:
        """Automate Excel operations"""

        # Open file
        self.open_application("Excel")
        time.sleep(2)

        # Open specific file
        pyautogui.hotkey("ctrl", "o")
        time.sleep(1)
        pyautogui.write(file_path)
        pyautogui.press("enter")
        time.sleep(2)

        # Execute operations
        for op in operations:
            self.agent.execute_task(f"In Excel: {op}")

        return True

    def use_email(self, email_client: str, action: str, **kwargs) -> bool:
        """Automate email operations"""

        task = f"Using {email_client}: {action}"

        if "recipient" in kwargs:
            task += f" to {kwargs['recipient']}"
        if "subject" in kwargs:
            task += f" with subject '{kwargs['subject']}'"
        if "body" in kwargs:
            task += f" containing: {kwargs['body'][:100]}"

        return self.agent.execute_task(task)
```

## Multi-Window Management

```python
class WindowManager:
    """Manage multiple windows during automation"""

    def __init__(self, agent: DesktopAutomationAgent):
        self.agent = agent
        self.windows = {}

    def find_window(self, window_title: str) -> Optional[dict]:
        """Find a window by title"""

        screenshot = self.agent.capture_screen()

        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=512,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": screenshot
                            }
                        },
                        {
                            "type": "text",
                            "text": f"""
                            Find a window with title containing: "{window_title}"
                            Return JSON:
                            {{
                                "found": boolean,
                                "title_bar_x": int,
                                "title_bar_y": int,
                                "is_maximized": boolean,
                                "is_active": boolean
                            }}
                            """
                        }
                    ]
                }
            ]
        )

        import json
        return json.loads(response.content[0].text)

    def focus_window(self, window_title: str) -> bool:
        """Bring a window to focus"""

        window = self.find_window(window_title)

        if not window or not window["found"]:
            return False

        # Click on the title bar to focus
        pyautogui.click(window["title_bar_x"], window["title_bar_y"])
        time.sleep(0.3)

        return True

    def arrange_windows(self, arrangement: str) -> bool:
        """Arrange windows in a specific layout"""

        if arrangement == "side_by_side":
            # Windows: Win + Left/Right arrows
            pyautogui.hotkey("win", "left")
            time.sleep(0.5)

            # Need to select second window for right side
            pyautogui.hotkey("alt", "tab")
            time.sleep(0.3)
            pyautogui.hotkey("win", "right")

        elif arrangement == "cascade":
            pyautogui.hotkey("win", "down")  # Restore all
            time.sleep(0.5)

        return True

    def close_window(self, window_title: str) -> bool:
        """Close a specific window"""

        if self.focus_window(window_title):
            pyautogui.hotkey("alt", "F4")
            return True

        return False
```

## Workflow Automation

```python
class WorkflowAutomator:
    """Automate complex multi-application workflows"""

    def __init__(self):
        self.agent = DesktopAutomationAgent()
        self.app_automator = ApplicationAutomator(self.agent)
        self.window_manager = WindowManager(self.agent)

    def execute_workflow(self, workflow: dict) -> dict:
        """Execute a multi-step workflow"""

        results = {
            "success": True,
            "steps_completed": 0,
            "steps_total": len(workflow["steps"]),
            "errors": []
        }

        for i, step in enumerate(workflow["steps"]):
            print(f"Executing step {i + 1}: {step['name']}")

            try:
                success = self._execute_step(step)

                if not success:
                    results["errors"].append(f"Step {i + 1} failed")
                    if not step.get("continue_on_failure", False):
                        results["success"] = False
                        break

                results["steps_completed"] = i + 1

            except Exception as e:
                results["errors"].append(f"Step {i + 1} error: {str(e)}")
                results["success"] = False
                break

        return results

    def _execute_step(self, step: dict) -> bool:
        """Execute a single workflow step"""

        step_type = step["type"]

        if step_type == "open_app":
            return self.app_automator.open_application(step["app_name"])

        elif step_type == "ai_task":
            return self.agent.execute_task(step["task"])

        elif step_type == "focus_window":
            return self.window_manager.focus_window(step["window"])

        elif step_type == "hotkey":
            pyautogui.hotkey(*step["keys"])
            return True

        elif step_type == "wait":
            time.sleep(step.get("seconds", 1))
            return True

        elif step_type == "type":
            pyautogui.write(step["text"], interval=0.05)
            return True

        else:
            print(f"Unknown step type: {step_type}")
            return False

# Example workflow
example_workflow = {
    "name": "Daily Report Generation",
    "steps": [
        {"type": "open_app", "app_name": "Excel", "name": "Open Excel"},
        {"type": "ai_task", "task": "Open the file 'sales_data.xlsx'", "name": "Open sales file"},
        {"type": "ai_task", "task": "Create a pivot table summarizing sales by region", "name": "Create pivot"},
        {"type": "hotkey", "keys": ["ctrl", "c"], "name": "Copy chart"},
        {"type": "open_app", "app_name": "Outlook", "name": "Open Outlook"},
        {"type": "ai_task", "task": "Create a new email to team@company.com", "name": "New email"},
        {"type": "type", "text": "Daily Sales Report", "name": "Enter subject"},
        {"type": "hotkey", "keys": ["tab"], "name": "Move to body"},
        {"type": "hotkey", "keys": ["ctrl", "v"], "name": "Paste chart"},
    ]
}

# automator = WorkflowAutomator()
# results = automator.execute_workflow(example_workflow)
```

Desktop automation with AI brings human-like understanding to any application, enabling automation of complex workflows that were previously impossible to script reliably.
