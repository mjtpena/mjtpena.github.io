---
title: "Model Context Protocol Six Weeks In: What It Is and Where It Fits"
description: "A practitioner's read on Anthropic's Model Context Protocol in January 2025: the primitives, a read-only SQL server in Python, and when not to use it."
author: Michael John Peña
draft: false
date: 2025-01-07
tags:
  - MCP
  - Anthropic
  - AI Agents
  - Python
---

Every team building on large language models ends up writing the same glue: a function that queries the warehouse, a wrapper around a ticketing API, a schema describing both so the model knows they exist. Then the next app, or the next model provider, needs the same glue written again. The Model Context Protocol (MCP) is an attempt to make that glue reusable, and six weeks after its release it's worth understanding what it actually standardises and what it leaves to you.

## What Anthropic actually released

Anthropic [announced MCP on 25 November 2024](https://www.anthropic.com/news/model-context-protocol) as an open protocol for connecting AI applications to data sources and tools. The release included a specification (the current revision is dated 2024-11-05), Python and TypeScript SDKs, a set of open-source reference servers (Google Drive, Slack, GitHub, Git, Postgres and Puppeteer), and local MCP server support in the Claude Desktop app. Block and Apollo were named as early adopters, and Zed, Replit, Codeium and Sourcegraph as developer-tool companies working with it.

The architecture has three roles:

- **Host**: the application the user interacts with, such as Claude Desktop or an IDE.
- **Client**: a connector inside the host that holds a one-to-one session with a server.
- **Server**: a lightweight process that exposes capabilities to the client.

Messages are JSON-RPC 2.0. The [2024-11-05 specification](https://modelcontextprotocol.io/specification/2024-11-05) defines two transports: **stdio**, where the host launches the server as a child process and talks over standard input and output, and **HTTP with Server-Sent Events** for servers running elsewhere. In practice, almost everything people are building today is a local stdio server, because that's what Claude Desktop supports.

### The three server primitives

| Primitive | Who decides to use it | Closest analogy | Example |
|---|---|---|---|
| Tools | The model | A POST endpoint | Run a query, create a ticket |
| Resources | The application or user | A GET endpoint | A table's schema, a file's contents |
| Prompts | The user | A saved template | "Review this table for data quality issues" |

That split is the most useful idea in the protocol. Tools are model-controlled: the LLM sees their names, descriptions and JSON Schema inputs, and decides when to call them. Resources are application-controlled context that the host chooses to attach. Prompts are user-invoked templates. Teams that expose everything as a tool lose that distinction and end up with a model making dozens of calls just to read reference data that could have been loaded once.

The spec also defines client-side features, notably **sampling** (a server asking the client's model for a completion) and **roots** (the client telling the server which locations it may work in). Client support for these is still thin, so I wouldn't design around them yet.

## What MCP doesn't standardise (yet)

This is where I'd temper the enthusiasm I'm seeing on social media. The 2024-11-05 revision has no standard authorisation flow. A stdio server runs with whatever credentials you hand it through environment variables, under the identity of the user who launched the host. For a developer's laptop that's fine. For anything shared across a team, it means:

- There's no protocol-level way to say "this user may call this tool but not that one". You enforce it in the server or, better, in the data source. I covered the options in [permission models for AI agents](/blog/2024-10-09-agent-permission-models/), and none of them come for free with MCP.
- Remote servers over HTTP with SSE need you to bring your own authentication in front of them.
- Tool descriptions are effectively prompt text written by whoever built the server. Installing a third-party MCP server is closer to installing a VS Code extension than to adding a REST connector, and it deserves the same scrutiny.

None of that makes MCP a bad idea. It means that, as of January 2025, MCP standardises *discovery and invocation*, not *governance*. Plan accordingly.

## A read-only SQL server in Python

The Python SDK's [1.2.0 release on 3 January 2025](https://pypi.org/project/mcp/1.2.0/) folded the FastMCP decorator API into the official package as `mcp.server.fastmcp`, which removes most of the boilerplate from the earlier low-level server. Here's a small server that lets a model explore an Azure SQL Database (or any SQL Server) through a read-only login.

```python
# sql_explorer.py
# pip install "mcp[cli]==1.2.0" pyodbc
import contextlib
import os
import sys

import pyodbc
from mcp.server.fastmcp import FastMCP

MAX_ROWS = 200

# dependencies tells `mcp dev` to install pyodbc in the environment it creates.
mcp = FastMCP("sql-explorer", dependencies=["pyodbc"])


def connect() -> pyodbc.Connection:
    # The connection string comes from the host config, never from the model.
    # Use a login that can only SELECT from the objects you intend to expose.
    # timeout=15 is the login timeout; conn.timeout is the per-query timeout.
    conn = pyodbc.connect(os.environ["SQL_CONNECTION_STRING"], timeout=15)
    conn.timeout = 30
    return conn


def format_rows(cursor: pyodbc.Cursor, rows: list) -> str:
    headers = [col[0] for col in cursor.description]
    lines = [" | ".join(headers)]
    lines += [" | ".join("" if v is None else str(v) for v in row) for row in rows]
    return "\n".join(lines)


@mcp.resource("schema://tables")
def list_tables() -> str:
    """All user tables in the database, as schema.table."""
    with contextlib.closing(connect()) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
            "WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME"
        )
        return "\n".join(f"{s}.{t}" for s, t in cursor.fetchall())


@mcp.tool()
def describe_table(schema: str, table: str) -> str:
    """Return column names, data types and nullability for one table."""
    with contextlib.closing(connect()) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE "
            "FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
            schema,
            table,
        )
        rows = cursor.fetchall()
        if not rows:
            return f"No table named {schema}.{table}."
        return format_rows(cursor, rows)


@mcp.tool()
def run_query(sql: str) -> str:
    """Run a read-only T-SQL SELECT and return at most 200 rows."""
    with contextlib.closing(connect()) as conn:
        cursor = conn.cursor()
        cursor.execute(sql)
        if cursor.description is None:
            return "The statement returned no result set."
        rows = cursor.fetchmany(MAX_ROWS)
        truncated = cursor.fetchone() is not None
        result = format_rows(cursor, rows)
        if truncated:
            result += f"\n(truncated to {MAX_ROWS} rows; add filters or aggregates)"
        return result


if __name__ == "__main__":
    print("sql-explorer starting on stdio", file=sys.stderr)
    mcp.run()  # stdio is the default transport
```

A few decisions in there are deliberate:

- **The read-only guarantee lives in the database, not in Python.** It's tempting to check that the SQL starts with `SELECT`. Don't rely on that; a model can produce a CTE, a batch, or something you didn't think of. Give the server a principal that can only read, and the worst a bad query can do is run slowly or read more than you intended. The [`db_datareader` fixed database role](https://learn.microsoft.com/en-us/sql/relational-databases/security/authentication-access/database-level-roles) is fine for a sandbox, but it grants SELECT on every user table and view, including the sensitive columns. For anything beyond a sandbox, I'd create a dedicated role and `GRANT SELECT` on a reporting schema or a set of curated views instead.
- **Query results go straight into the model's context.** Whatever the server returns, the model reads, and a model can be steered by prompt injection hidden in data or tool text. Deciding which objects this login can see is a data-exposure decision, not just a permissions chore.
- **Every query has a time limit and every connection is closed.** `timeout=15` in `pyodbc.connect` only bounds the login. Setting `conn.timeout = 30` cancels any query that runs longer than 30 seconds, and `contextlib.closing` closes the connection after each call, because a pyodbc connection used as a plain context manager commits on exit but stays open.
- **The table list is a resource, the schema lookup is a tool.** The host can attach the table list up front; the model calls `describe_table` only for tables it cares about.
- **Results are capped and the cap is explained.** Telling the model *why* a result was truncated gets a better follow-up query than silently returning 200 rows.
- **Nothing is written to stdout except protocol messages.** With the stdio transport, a stray `print()` corrupts the JSON-RPC stream. Log to stderr.

You can test it with the MCP Inspector via `mcp dev sql_explorer.py` before wiring it into a host. That command runs the server through `uv` in a fresh environment (which is why the constructor declares `pyodbc` in `dependencies`) and launches the Inspector with `npx`, so you need both uv and Node.js installed. Set `SQL_CONNECTION_STRING` in the Inspector's environment variables panel before connecting.

### Registering it in Claude Desktop

Claude Desktop reads `claude_desktop_config.json` (under `%APPDATA%\Claude\` on Windows and `~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "sql-explorer": {
      "command": "C:\\mcp\\.venv\\Scripts\\python.exe",
      "args": ["C:\\mcp\\sql_explorer.py"],
      "env": {
        "SQL_CONNECTION_STRING": "Driver={ODBC Driver 18 for SQL Server};Server=tcp:<your-server>.database.windows.net,1433;Database=<your-database>;Uid=<read-only-login>;Pwd=<password>;Encrypt=yes;"
      }
    }
  }
}
```

The `command` is the absolute path to the virtual environment's interpreter, not a bare `python`. Claude Desktop launches servers with its own PATH, so `python` often resolves to an interpreter that doesn't have `mcp` and `pyodbc` installed.

That plain-text password in a config file is exactly the governance gap I described above. For a personal sandbox database it's acceptable; for production data it isn't, and that alone is a reason to keep MCP to development and exploration scenarios for now.

## Using the same server from your own app

The portability argument is the real payoff. The SDK's `ClientSession` can launch any stdio server, list its tools and call them. Because each tool carries a JSON Schema in `inputSchema`, mapping it to the function-calling format of Azure OpenAI or the Anthropic API is a few lines. If you've used the Chat Completions `tools` parameter, the [function calling patterns](/blog/2023-06-18-azure-openai-function-calling-patterns/) I wrote about earlier carry straight over:

```python
# list_tools.py
import asyncio
import json
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import get_default_environment, stdio_client

# env replaces the child's environment rather than adding to it, so start
# from the SDK's safe defaults (PATH, HOME, SYSTEMROOT and so on).
server = StdioServerParameters(
    command=sys.executable,
    args=["sql_explorer.py"],
    env={
        **get_default_environment(),
        "SQL_CONNECTION_STRING": "<your-connection-string>",
    },
)


async def main() -> None:
    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            listed = await session.list_tools()

            # Shape expected by the Chat Completions "tools" parameter
            openai_tools = [
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description or "",
                        "parameters": tool.inputSchema,
                    },
                }
                for tool in listed.tools
            ]
            print(json.dumps(openai_tools, indent=2))

            result = await session.call_tool(
                "describe_table", arguments={"schema": "dbo", "table": "Customer"}
            )
            for item in result.content:
                if item.type == "text":
                    print(item.text)


if __name__ == "__main__":
    asyncio.run(main())
```

From there, the usual tool-calling loop applies: pass `openai_tools` to the model, and when it returns a tool call, forward the name and arguments to `session.call_tool`. The integration is written once, as a server, and every client that speaks MCP can use it.

## When I'd use it, and when I wouldn't

**Use MCP when** the same capability needs to show up in more than one AI client: a developer's Claude Desktop, an IDE assistant, and an internal agent. It's also a clean way to give engineers and analysts governed, read-only exploration of a data source from their own machine.

**Don't reach for it when:**

- You have one application calling one model. A plain function-calling implementation is simpler, has one fewer process to run, and you lose nothing.
- The tools need per-user authorisation or an audit trail. The current spec gives you nothing here; build that into an API you control and expose the API, not the database.
- You need a hosted, multi-tenant service today. Remote transport exists, but the client ecosystem is overwhelmingly local stdio.

My take: MCP is the right shape for the problem, and the separation of tools, resources and prompts is better thought through than most of the ad hoc tool frameworks it competes with. But it's six weeks old, the authorisation story is missing, and adoption outside Anthropic's own products is still early. Build one small, read-only server against a non-production source, learn the primitives, and keep your business logic in services that don't depend on MCP surviving in its current form. The [Python SDK repository](https://github.com/modelcontextprotocol/python-sdk) is the place to watch for what changes next.
