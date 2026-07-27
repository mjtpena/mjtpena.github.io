---
title: "Power Automate Cloud Connectors: Connecting Your Enterprise"
author: Michael John Peña
draft: false
date: 2022-04-03
tags:
  - Power Platform
  - Power Automate
  - Connectors
  - Integration
  - Automation

---

I wrote "Power Automate Cloud Connectors: Connecting Your Enterprise" to share practical, production-minded guidance on this topic.

## Connector Categories

### Standard Connectors

Included with most Power Platform licenses:

```yaml
popular_standard:
  - Microsoft 365:
      - Outlook
      - SharePoint
      - Teams
      - OneDrive
      - Excel Online
  - Common Services:
      - HTTP
      - RSS
      - SMTP
      - FTP
  - Data:
      - SQL Server
      - Dataverse
```

### Premium Connectors

Require Power Automate Premium or per-flow license:

```yaml
popular_premium:
  - Azure:
      - Azure Blob Storage
      - Azure SQL Database
      - Azure Key Vault
      - Azure DevOps
  - Business Apps:
      - Salesforce
      - SAP
      - ServiceNow
      - Dynamics 365
  - Advanced:
      - HTTP with Azure AD
      - Custom Connector
```

## Working with Common Connectors

### SharePoint

```json
{
    "actions": {
        "Get_files": {
            "type": "ApiConnection",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['sharepointonline']['connectionId']"
                    }
                },
                "method": "get",
                "path": "/datasets/@{encodeURIComponent('https://company.sharepoint.com/sites/documents')}/tables/@{encodeURIComponent('Documents')}/items",
                "queries": {
                    "$filter": "Modified ge '@{addDays(utcNow(), -7)}'",
                    "$select": "FileLeafRef,Modified,Author/Title",
                    "$expand": "Author"
                }
            }
        },
        "Create_file": {
            "type": "ApiConnection",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['sharepointonline']['connectionId']"
                    }
                },
                "method": "post",
                "path": "/datasets/@{encodeURIComponent('https://company.sharepoint.com/sites/documents')}/tables/@{encodeURIComponent('Documents')}/items",
                "body": {
                    "Title": "@{variables('fileName')}",
                    "FileContent": "@{body('Get_file_content')}"
                }
            }
        }
    }
}
```

### Microsoft Teams

```json
{
    "actions": {
        "Post_message": {
            "type": "ApiConnection",
            "inputs": {
                "method": "post",
                "path": "/v1.0/teams/@{parameters('teamId')}/channels/@{parameters('channelId')}/messages",
                "body": {
                    "body": {
                        "contentType": "html",
                        "content": "<h2>Weekly Report</h2><p>@{variables('reportContent')}</p>"
                    },
                    "importance": "high"
                }
            }
        },
        "Post_adaptive_card": {
            "type": "ApiConnection",
            "inputs": {
                "method": "post",
                "path": "/v1.0/teams/@{parameters('teamId')}/channels/@{parameters('channelId')}/messages",
                "body": {
                    "body": {
                        "contentType": "html",
                        "content": "<attachment id=\"card1\"></attachment>"
                    },
                    "attachments": [
                        {
                            "id": "card1",
                            "contentType": "application/vnd.microsoft.card.adaptive",
                            "content": "@{variables('cardJson')}"
                        }
                    ]
                }
            }
        }
    }
}
```

### Azure Blob Storage

```json
{
    "actions": {
        "List_blobs": {
            "type": "ApiConnection",
            "inputs": {
                "method": "get",
                "path": "/v2/datasets/@{parameters('storageAccount')}/blobs",
                "queries": {
                    "prefix": "incoming/",
                    "maxResults": 100
                }
            }
        },
        "Upload_blob": {
            "type": "ApiConnection",
            "inputs": {
                "method": "post",
                "path": "/v2/datasets/@{parameters('storageAccount')}/files/@{encodeURIComponent('processed/', variables('fileName'))}",
                "body": "@{body('Get_file_content')}",
                "headers": {
                    "Content-Type": "application/octet-stream"
                }
            }
        },
        "Delete_blob": {
            "type": "ApiConnection",
            "inputs": {
                "method": "delete",
                "path": "/v2/datasets/@{parameters('storageAccount')}/files/@{encodeURIComponent(items('Apply_to_each')?['Path'])}"
            }
        }
    }
}
```

### HTTP Connector

```json
{
    "actions": {
        "HTTP_GET": {
            "type": "Http",
            "inputs": {
                "method": "GET",
                "uri": "https://api.example.com/data",
                "headers": {
                    "Authorization": "Bearer @{body('Get_secret')?['value']}",
                    "Content-Type": "application/json"
                },
                "queries": {
                    "page": "@{variables('pageNumber')}",
                    "limit": "100"
                }
            },
            "runtimeConfiguration": {
                "contentTransfer": {
                    "transferMode": "Chunked"
                }
            }
        },
        "HTTP_POST": {
            "type": "Http",
            "inputs": {
                "method": "POST",
                "uri": "https://api.example.com/submit",
                "headers": {
                    "Authorization": "Bearer @{body('Get_secret')?['value']}",
                    "Content-Type": "application/json"
                },
                "body": {
                    "name": "@{triggerBody()?['name']}",
                    "email": "@{triggerBody()?['email']}",
                    "data": "@{variables('processedData')}"
                }
            },
            "retryPolicy": {
                "type": "exponential",
                "count": 3,
                "interval": "PT10S",
                "minimumInterval": "PT5S",
                "maximumInterval": "PT1H"
            }
        }
    }
}
```

## Connection Management

### Service Principal Connections

```json
{
    "connections": {
        "azureblob": {
            "connectionId": "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/connections/azureblob",
            "connectionName": "azureblob",
            "connectionProperties": {
                "authentication": {
                    "type": "ManagedServiceIdentity"
                }
            }
        }
    }
}
```

### Shared Connections

```powershell
# Share connection with service account
$connectionId = "shared_sharepointonline-1234"

# Update connection permissions
Set-AdminPowerAppConnectionRoleAssignment `
    -ConnectionName $connectionId `
    -EnvironmentName "Default-{tenant-id}" `
    -RoleName "CanEdit" `
    -PrincipalType "User" `
    -PrincipalObjectId "{service-account-object-id}"
```

## Pagination and Large Datasets

```json
{
    "actions": {
        "List_all_items": {
            "type": "ApiConnection",
            "inputs": {
                "method": "get",
                "path": "/v2/datasets/@{encodeURIComponent('default.cds')}/tables/@{encodeURIComponent('accounts')}/items"
            },
            "runtimeConfiguration": {
                "paginationPolicy": {
                    "minimumItemCount": 5000
                }
            }
        }
    }
}
```

### Manual Pagination

```json
{
    "actions": {
        "Initialize_results": {
            "type": "InitializeVariable",
            "inputs": {
                "variables": [
                    {
                        "name": "allResults",
                        "type": "array",
                        "value": []
                    },
                    {
                        "name": "nextLink",
                        "type": "string",
                        "value": ""
                    }
                ]
            }
        },
        "Do_until_all_pages": {
            "type": "Until",
            "expression": "@empty(variables('nextLink'))",
            "limit": {
                "count": 100,
                "timeout": "PT1H"
            },
            "actions": {
                "Get_page": {
                    "type": "Http",
                    "inputs": {
                        "method": "GET",
                        "uri": "@{if(empty(variables('nextLink')), 'https://api.example.com/data', variables('nextLink'))}"
                    }
                },
                "Append_results": {
                    "type": "AppendToArrayVariable",
                    "inputs": {
                        "name": "allResults",
                        "value": "@{body('Get_page')?['value']}"
                    }
                },
                "Set_next_link": {
                    "type": "SetVariable",
                    "inputs": {
                        "name": "nextLink",
                        "value": "@{body('Get_page')?['@odata.nextLink']}"
                    }
                }
            }
        }
    }
}
```

## Error Handling

### Retry Policies

```json
{
    "actions": {
        "Reliable_API_call": {
            "type": "Http",
            "inputs": {
                "method": "POST",
                "uri": "https://api.example.com/endpoint"
            },
            "retryPolicy": {
                "type": "exponential",
                "count": 5,
                "interval": "PT10S",
                "minimumInterval": "PT5S",
                "maximumInterval": "PT30M"
            }
        }
    }
}
```

### Scope-Based Error Handling

```json
{
    "actions": {
        "Try_scope": {
            "type": "Scope",
            "actions": {
                "Risky_operation": {
                    "type": "Http",
                    "inputs": { }
                }
            }
        },
        "Catch_scope": {
            "type": "Scope",
            "runAfter": {
                "Try_scope": ["Failed", "TimedOut"]
            },
            "actions": {
                "Log_error": {
                    "type": "ApiConnection",
                    "inputs": {
                        "method": "post",
                        "path": "/tables/@{encodeURIComponent('error_logs')}/items",
                        "body": {
                            "ErrorMessage": "@{result('Try_scope')?['error']?['message']}",
                            "FlowRunId": "@{workflow()['run']['name']}",
                            "Timestamp": "@{utcNow()}"
                        }
                    }
                }
            }
        }
    }
}
```

## Performance Optimization

### Parallel Execution

```json
{
    "actions": {
        "Parallel_branch": {
            "type": "Parallel",
            "actions": {
                "Branch_1": {
                    "type": "ApiConnection",
                    "inputs": { }
                },
                "Branch_2": {
                    "type": "ApiConnection",
                    "inputs": { }
                }
            }
        }
    }
}
```

### Concurrency Control

```json
{
    "actions": {
        "Apply_to_each": {
            "type": "Foreach",
            "foreach": "@body('Get_items')?['value']",
            "runtimeConfiguration": {
                "concurrency": {
                    "repetitions": 20
                }
            },
            "actions": {
                "Process_item": {
                    "type": "Http",
                    "inputs": { }
                }
            }
        }
    }
}
```

## Connector Best Practices

1. **Use managed identity when possible**: Avoid storing credentials
2. **Implement retry logic**: Handle transient failures
3. **Paginate large datasets**: Don't rely on defaults
4. **Monitor connector limits**: Stay within throttling thresholds
5. **Share connections carefully**: Use service accounts for shared flows
6. **Cache when appropriate**: Reduce API calls

## Conclusion

Power Automate connectors enable powerful integrations with minimal code. Understanding connection management, error handling, and performance optimization is key to building production-ready automation.

## Resources

- [Connector Reference](https://docs.microsoft.com/en-us/connectors/connector-reference/)
- [Connection Management](https://docs.microsoft.com/en-us/power-automate/connection-management)
- [Throttling Limits](https://docs.microsoft.com/en-us/power-automate/limits-and-config)

