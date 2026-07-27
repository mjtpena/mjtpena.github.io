---
title: "Long Polling: Real-Time Patterns for Legacy Systems"
author: Michael John Peña
draft: false
date: 2022-06-23
tags:
  - polling
  - real-time
  - api
  - patterns
---

Long polling is the workaround for near-real-time notifications in environments where WebSocket connections aren't available—the client sends an HTTP request to the server; the server holds the connection open until it has data to send (or a timeout occurs); the client receives the response and immediately sends another request, creating a continuous long-polling cycle. The implementation: the client sends a GET request with a `timeout` parameter; the server returns data when available or a "no data" response after the timeout; the client loops. Long polling works within standard HTTP infrastructure (firewalls, proxies, load balancers) that might block WebSocket connections, making it the fallback for enterprise environments with restrictive network policies. The operational downsides: each connected client holds a server thread (or async I/O slot) for the duration of the poll timeout; high-concurrency long-polling consumes significantly more server resources than WebSocket at equivalent scale; and the polling cycle introduces latency proportional to the timeout interval for events that arrive just after a poll completes. With WebSocket and SSE broadly supported in 2022, long polling is primarily a fallback mechanism rather than a first-choice architecture.

## Server Implementation

```csharp
[ApiController]
[Route("api/[controller]")]
public class UpdatesController : ControllerBase
{
    private readonly IUpdateService _updateService;

    [HttpGet("poll")]
    public async Task<IActionResult> LongPoll(
        [FromQuery] string lastEventId,
        CancellationToken cancellationToken)
    {
        var timeout = TimeSpan.FromSeconds(30);
        var deadline = DateTime.UtcNow + timeout;

        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var updates = await _updateService.GetUpdatesSinceAsync(lastEventId);

            if (updates.Any())
            {
                return Ok(new
                {
                    updates,
                    lastEventId = updates.Last().Id
                });
            }

            await Task.Delay(TimeSpan.FromMilliseconds(500), cancellationToken);
        }

        // Timeout - return empty to trigger reconnect
        return Ok(new { updates = Array.Empty<object>(), lastEventId });
    }
}
```

## Client Implementation

```typescript
class LongPollingClient {
  private lastEventId: string | null = null;
  private running = false;

  async start(): Promise<void> {
    this.running = true;
    await this.poll();
  }

  stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const response = await fetch(
          `/api/updates/poll?lastEventId=${this.lastEventId || ''}`
        );

        if (response.ok) {
          const data = await response.json();
          this.lastEventId = data.lastEventId;

          for (const update of data.updates) {
            this.handleUpdate(update);
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
        await this.delay(5000); // Backoff on error
      }
    }
  }

  private handleUpdate(update: any): void {
    console.log('Update received:', update);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## Summary

Long polling provides real-time capabilities for environments where WebSocket is unavailable, with simpler infrastructure requirements.

---

References:
- [Long Polling Technique](https://javascript.info/long-polling)
- [Real-Time Communication Patterns](https://docs.microsoft.com/en-us/azure/architecture/patterns/)
