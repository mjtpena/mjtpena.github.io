---
title: "Azure Functions Custom Handlers: Any Language"
description: "Functions has supported \"any language\" via the worker model for a while, but custom handlers are the cleaner option when your runtime isn't on the supported…"
author: Michael John Peña
draft: false
date: 2020-12-11
tags:
  - Azure
  - Functions
  - Serverless
  - Custom Handlers
---

Functions has supported "any language" via the worker model for a while, but custom handlers are the cleaner option when your runtime isn't on the supported list. Bring a Go binary, a Rust executable, or a PHP script; the Functions host listens on the trigger and forwards an HTTP request to your process. I've used this for a Go-based image resize Function purely because the cold start was an order of magnitude better than the .NET equivalent at the time.

## How Custom Handlers Work

```
Request → Functions Host → Custom Handler (your code) → Response
              │                     │
              └── Bindings ─────────┘
```

## Project Structure

```
my-function-app/
├── host.json
├── function1/
│   └── function.json
├── handler.exe        # Your compiled binary
└── local.settings.json
```

## host.json Configuration

```json
{
    "version": "2.0",
    "customHandler": {
        "description": {
            "defaultExecutablePath": "handler",
            "workingDirectory": "",
            "arguments": []
        },
        "enableForwardingHttpRequest": true
    },
    "extensionBundle": {
        "id": "Microsoft.Azure.Functions.ExtensionBundle",
        "version": "[2.*, 3.0.0)"
    }
}
```

## function.json

```json
{
    "bindings": [
        {
            "type": "httpTrigger",
            "direction": "in",
            "name": "req",
            "methods": ["get", "post"],
            "authLevel": "anonymous",
            "route": "hello"
        },
        {
            "type": "http",
            "direction": "out",
            "name": "res"
        }
    ]
}
```

## Go Handler

```go
package main

import (
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "os"
)

func helloHandler(w http.ResponseWriter, r *http.Request) {
    name := r.URL.Query().Get("name")
    if name == "" {
        name = "World"
    }

    response := map[string]string{
        "message": fmt.Sprintf("Hello, %s!", name),
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(response)
}

func main() {
    port := os.Getenv("FUNCTIONS_CUSTOMHANDLER_PORT")
    if port == "" {
        port = "8080"
    }

    http.HandleFunc("/api/hello", helloHandler)

    log.Printf("Starting server on port %s", port)
    log.Fatal(http.ListenAndServe(":"+port, nil))
}
```

```bash
# Build for Linux
GOOS=linux GOARCH=amd64 go build -o handler
```

## Rust Handler

```rust
use actix_web::{web, App, HttpResponse, HttpServer};
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Deserialize)]
struct QueryParams {
    name: Option<String>,
}

#[derive(Serialize)]
struct Response {
    message: String,
}

async fn hello(query: web::Query<QueryParams>) -> HttpResponse {
    let name = query.name.clone().unwrap_or_else(|| "World".to_string());
    let response = Response {
        message: format!("Hello, {}!", name),
    };
    HttpResponse::Ok().json(response)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = env::var("FUNCTIONS_CUSTOMHANDLER_PORT")
        .unwrap_or_else(|_| "8080".to_string());

    HttpServer::new(|| {
        App::new()
            .route("/api/hello", web::get().to(hello))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
```

## Non-HTTP Triggers

For queue, timer, and other triggers:

```json
// host.json - disable HTTP forwarding
{
    "customHandler": {
        "enableForwardingHttpRequest": false
    }
}
```

```go
// Handler receives invocation request
type InvokeRequest struct {
    Data     map[string]interface{} `json:"Data"`
    Metadata map[string]interface{} `json:"Metadata"`
}

type InvokeResponse struct {
    Outputs     map[string]interface{} `json:"Outputs"`
    Logs        []string               `json:"Logs"`
    ReturnValue interface{}            `json:"ReturnValue"`
}

func queueHandler(w http.ResponseWriter, r *http.Request) {
    var req InvokeRequest
    json.NewDecoder(r.Body).Decode(&req)

    // Process queue message
    message := req.Data["queueMessage"].(string)
    log.Printf("Processing: %s", message)

    response := InvokeResponse{
        Outputs: map[string]interface{}{
            "outputBinding": "processed",
        },
        Logs: []string{"Message processed successfully"},
    }

    json.NewEncoder(w).Encode(response)
}
```

## Deployment

```bash
# Publish to Azure
func azure functionapp publish my-function-app

# Or use zip deployment
az functionapp deployment source config-zip \
    --name my-function-app \
    --resource-group myRG \
    --src ./deploy.zip
```

Custom handlers: bring any language to serverless.
