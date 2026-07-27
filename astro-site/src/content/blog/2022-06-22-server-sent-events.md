---
title: "Server-Sent Events: Simple Real-Time Updates"
author: Michael John Peña
draft: false
date: 2022-06-22
tags:
  - sse
  - real-time
  - api
  - azure

---

I wrote "Server-Sent Events: Simple Real-Time Updates" to share practical, production-minded guidance on this topic.

## SSE Endpoint in ASP.NET

```csharp
[ApiController]
[Route("api/[controller]")]
public class EventsController : ControllerBase
{
    [HttpGet("stream")]
    public async Task StreamEvents(CancellationToken cancellationToken)
    {
        Response.Headers.Add("Content-Type", "text/event-stream");
        Response.Headers.Add("Cache-Control", "no-cache");
        Response.Headers.Add("Connection", "keep-alive");

        while (!cancellationToken.IsCancellationRequested)
        {
            var data = await GetLatestDataAsync();

            await Response.WriteAsync($"event: update\n");
            await Response.WriteAsync($"data: {JsonSerializer.Serialize(data)}\n\n");
            await Response.Body.FlushAsync();

            await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
        }
    }
}
```

## Client Implementation

```typescript
const eventSource = new EventSource('/api/events/stream');

eventSource.addEventListener('update', (event) => {
  const data = JSON.parse(event.data);
  console.log('Update received:', data);
  updateUI(data);
});

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
  eventSource.close();
};

// Cleanup
window.addEventListener('beforeunload', () => {
  eventSource.close();
});
```

## SSE vs WebSocket

| Feature | SSE | WebSocket |
|---------|-----|-----------|
| Direction | Server to client | Bidirectional |
| Protocol | HTTP | WebSocket |
| Reconnection | Automatic | Manual |
| Binary data | No | Yes |

## Summary

SSE offers a simple, HTTP-based solution for server-to-client streaming, with automatic reconnection and broad browser support.


