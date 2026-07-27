---
title: "Browser Automation with AI: Intelligent Web Navigation"
author: "Michael John Peña"
draft: false
date: 2024-10-04
tags: ["Browser Automation", "AI", "Web Scraping", "Playwright", "Selenium"]

---

I wrote "Browser Automation with AI: Intelligent Web Navigation" to share practical, production-minded guidance on this topic.

## AI-Enhanced Browser Agent

```python
from playwright.sync_api import sync_playwright, Page
import anthropic
import base64
import json

client = anthropic.Anthropic()

class AIBrowserAgent:
    """Browser agent powered by AI"""

    def __init__(self, headless: bool = False):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=headless)
        self.context = self.browser.new_context(
            viewport={"width": 1920, "height": 1080}
        )
        self.page = self.context.new_page()

    def navigate_to_goal(self, url: str, goal: str, max_steps: int = 10) -> bool:
        """Navigate to URL and achieve a goal"""

        self.page.goto(url)

        for step in range(max_steps):
            # Capture current state
            screenshot = self._capture_screenshot()
            html = self.page.content()

            # Determine next action
            action = self._determine_action(goal, screenshot, html)

            if action["type"] == "complete":
                return True

            # Execute action
            success = self._execute_action(action)

            if not success:
                # Try to recover
                if not self._handle_failure(action, goal):
                    return False

        return False

    def _capture_screenshot(self) -> str:
        """Capture page screenshot as base64"""
        screenshot_bytes = self.page.screenshot()
        return base64.standard_b64encode(screenshot_bytes).decode()

    def _determine_action(self, goal: str, screenshot: str, html: str) -> dict:
        """Use AI to determine next action"""

        # Truncate HTML if too long
        html_preview = html[:5000] if len(html) > 5000 else html

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
                            Goal: {goal}

                            HTML (truncated):
                            ```html
                            {html_preview}
                            ```

                            Determine the next action to achieve the goal.
                            Return JSON with:
                            - type: click/type/scroll/wait/select/complete
                            - selector: CSS selector for element (if applicable)
                            - value: text to type or option to select (if applicable)
                            - reasoning: why this action helps achieve the goal
                            """
                        }
                    ]
                }
            ]
        )

        return json.loads(response.content[0].text)

    def _execute_action(self, action: dict) -> bool:
        """Execute a browser action"""

        try:
            action_type = action["type"]
            selector = action.get("selector")
            value = action.get("value")

            if action_type == "click":
                self.page.click(selector)

            elif action_type == "type":
                self.page.fill(selector, value)

            elif action_type == "scroll":
                self.page.evaluate("window.scrollBy(0, 500)")

            elif action_type == "wait":
                self.page.wait_for_timeout(int(value or 1000))

            elif action_type == "select":
                self.page.select_option(selector, value)

            elif action_type == "hover":
                self.page.hover(selector)

            # Wait for any navigation
            self.page.wait_for_load_state("networkidle", timeout=5000)
            return True

        except Exception as e:
            print(f"Action failed: {e}")
            return False

    def _handle_failure(self, failed_action: dict, goal: str) -> bool:
        """Handle action failure"""

        screenshot = self._capture_screenshot()

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
                            Action failed: {json.dumps(failed_action)}
                            Goal: {goal}

                            Suggest an alternative action to achieve the same effect.
                            Return JSON with alternative action or {{"type": "abort"}} if unrecoverable.
                            """
                        }
                    ]
                }
            ]
        )

        alternative = json.loads(response.content[0].text)

        if alternative["type"] == "abort":
            return False

        return self._execute_action(alternative)

    def close(self):
        """Clean up resources"""
        self.browser.close()
        self.playwright.stop()
```

## Intelligent Data Extraction

```python
class AIDataExtractor:
    """Extract structured data from web pages using AI"""

    def __init__(self, browser_agent: AIBrowserAgent):
        self.agent = browser_agent

    def extract_structured_data(self, url: str, schema: dict) -> dict:
        """Extract data matching a schema from a URL"""

        self.agent.page.goto(url)
        self.agent.page.wait_for_load_state("networkidle")

        screenshot = self.agent._capture_screenshot()
        html = self.agent.page.content()

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
                                "data": screenshot
                            }
                        },
                        {
                            "type": "text",
                            "text": f"""
                            Extract data from this page matching this schema:
                            {json.dumps(schema, indent=2)}

                            HTML:
                            ```html
                            {html[:10000]}
                            ```

                            Return the extracted data as JSON matching the schema.
                            Include null for fields that cannot be found.
                            """
                        }
                    ]
                }
            ]
        )

        return json.loads(response.content[0].text)

    def extract_table_data(self, url: str, table_description: str) -> list:
        """Extract data from a table on a page"""

        self.agent.page.goto(url)

        # Find and extract table
        html = self.agent.page.content()

        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=4096,
            messages=[
                {
                    "role": "user",
                    "content": f"""
                    Find and extract the table matching this description: {table_description}

                    HTML:
                    ```html
                    {html[:15000]}
                    ```

                    Return JSON array of objects, one per table row.
                    Use column headers as keys.
                    """
                }
            ]
        )

        return json.loads(response.content[0].text)

    def extract_with_pagination(self, url: str, schema: dict,
                               max_pages: int = 10) -> list:
        """Extract data across paginated pages"""

        all_data = []
        self.agent.page.goto(url)

        for page_num in range(max_pages):
            # Extract from current page
            data = self._extract_current_page(schema)
            all_data.extend(data)

            # Find and click next page
            has_next = self._navigate_to_next_page()
            if not has_next:
                break

        return all_data

    def _extract_current_page(self, schema: dict) -> list:
        """Extract data from current page"""

        screenshot = self.agent._capture_screenshot()
        html = self.agent.page.content()

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
                                "data": screenshot
                            }
                        },
                        {
                            "type": "text",
                            "text": f"""
                            Extract all items matching this schema:
                            {json.dumps(schema, indent=2)}

                            Return JSON array of matching items.
                            """
                        }
                    ]
                }
            ]
        )

        return json.loads(response.content[0].text)

    def _navigate_to_next_page(self) -> bool:
        """Navigate to next page if available"""

        screenshot = self.agent._capture_screenshot()

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
                            "text": """
                            Is there a "Next" or pagination button to go to the next page?
                            Return JSON: {"has_next": boolean, "selector": "css selector or null"}
                            """
                        }
                    ]
                }
            ]
        )

        result = json.loads(response.content[0].text)

        if result["has_next"] and result["selector"]:
            try:
                self.agent.page.click(result["selector"])
                self.agent.page.wait_for_load_state("networkidle")
                return True
            except:
                return False

        return False
```

## Authentication Handling

```python
class AIAuthHandler:
    """Handle authentication flows intelligently"""

    def __init__(self, browser_agent: AIBrowserAgent):
        self.agent = browser_agent

    def login(self, url: str, credentials: dict) -> bool:
        """Log into a website with provided credentials"""

        self.agent.page.goto(url)

        # Analyze login form
        screenshot = self.agent._capture_screenshot()

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
                            Analyze this login page.
                            Available credentials: {list(credentials.keys())}

                            Return JSON with login steps:
                            {{
                                "username_selector": "css selector",
                                "password_selector": "css selector",
                                "submit_selector": "css selector",
                                "credential_mapping": {{"field": "credential_key"}}
                            }}
                            """
                        }
                    ]
                }
            ]
        )

        login_info = json.loads(response.content[0].text)

        try:
            # Fill username
            username_key = login_info["credential_mapping"].get("username", "username")
            self.agent.page.fill(
                login_info["username_selector"],
                credentials[username_key]
            )

            # Fill password
            password_key = login_info["credential_mapping"].get("password", "password")
            self.agent.page.fill(
                login_info["password_selector"],
                credentials[password_key]
            )

            # Submit
            self.agent.page.click(login_info["submit_selector"])
            self.agent.page.wait_for_load_state("networkidle")

            # Verify login success
            return self._verify_login_success()

        except Exception as e:
            print(f"Login failed: {e}")
            return False

    def _verify_login_success(self) -> bool:
        """Verify that login was successful"""

        screenshot = self.agent._capture_screenshot()

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
                            "text": """
                            Was the login successful?
                            Return JSON: {"success": boolean, "reason": "explanation"}
                            """
                        }
                    ]
                }
            ]
        )

        result = json.loads(response.content[0].text)
        return result["success"]
```

AI-powered browser automation understands context, adapts to changes, and can handle complex scenarios that break traditional automation scripts.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
