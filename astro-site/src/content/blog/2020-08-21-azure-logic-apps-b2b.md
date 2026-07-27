---
title: "B2B Integration Patterns with Azure Logic Apps"
author: Michael John Peña
draft: false
date: 2020-08-21
tags:
  - Azure
  - Logic Apps
  - Integration
  - B2B
---

Most Logic Apps content online is about Office 365 connectors and approval workflows — and that's fine, but the *enterprise* use case I keep running into is B2B integration. EDI X12, EDIFACT, AS2 — the protocols that the rest of the world has moved past, but every supply chain still runs on. Logic Apps with the Integration Account is genuinely the easiest way to land a partner connection without standing up a BizTalk server in 2020. A practical setup with the bits I always get asked about.

## Enterprise Integration Pack

The Enterprise Integration Pack enables:
- **EDI message processing** - X12, EDIFACT
- **AS2 messaging** - Secure B2B communication
- **XML transformations** - XSLT maps
- **Schemas and validation** - XSD validation

## Setting Up an Integration Account

```bash
# Create an integration account
az logic integration-account create \
    --resource-group rg-integration \
    --name integration-account-b2b \
    --location australiaeast \
    --sku Standard
```

## Adding Trading Partners

In the Azure Portal or via ARM:

```json
{
    "type": "Microsoft.Logic/integrationAccounts/partners",
    "name": "integration-account-b2b/ContosoCorp",
    "apiVersion": "2019-05-01",
    "properties": {
        "partnerType": "B2B",
        "content": {
            "b2b": {
                "businessIdentities": [
                    {
                        "qualifier": "AS2Identity",
                        "value": "CONTOSO"
                    },
                    {
                        "qualifier": "ZZ",
                        "value": "123456789"
                    }
                ]
            }
        }
    }
}
```

## Creating an AS2 Agreement

```json
{
    "type": "Microsoft.Logic/integrationAccounts/agreements",
    "name": "integration-account-b2b/AS2-Agreement-Contoso",
    "apiVersion": "2019-05-01",
    "properties": {
        "agreementType": "AS2",
        "hostPartner": "MyCompany",
        "guestPartner": "ContosoCorp",
        "hostIdentity": {
            "qualifier": "AS2Identity",
            "value": "MYCOMPANY"
        },
        "guestIdentity": {
            "qualifier": "AS2Identity",
            "value": "CONTOSO"
        },
        "content": {
            "aS2": {
                "receiveAgreement": {
                    "protocolSettings": {
                        "messageConnectionSettings": {
                            "ignoreCertificateNameMismatch": false,
                            "supportHttpStatusCodeContinue": true
                        },
                        "acknowledgementConnectionSettings": {
                            "ignoreCertificateNameMismatch": false
                        },
                        "mdnSettings": {
                            "needMDN": true,
                            "signMDN": true,
                            "sendMDNAsynchronously": false,
                            "micHashingAlgorithm": "SHA2256"
                        },
                        "securitySettings": {
                            "overrideGroupSigningCertificate": false,
                            "enableNRRForInboundEncodedMessages": false,
                            "enableNRRForInboundDecodedMessages": false,
                            "enableNRRForOutboundMDN": false
                        },
                        "validationSettings": {
                            "overrideMessageProperties": false,
                            "encryptMessage": true,
                            "signMessage": true
                        }
                    }
                },
                "sendAgreement": {
                    "protocolSettings": {
                        "messageConnectionSettings": {
                            "ignoreCertificateNameMismatch": false
                        },
                        "mdnSettings": {
                            "needMDN": true,
                            "signMDN": true,
                            "sendMDNAsynchronously": false
                        },
                        "securitySettings": {
                            "enableNRRForOutboundEncodedMessages": false,
                            "enableNRRForOutboundDecodedMessages": false
                        },
                        "validationSettings": {
                            "encryptMessage": true,
                            "signMessage": true
                        }
                    }
                }
            }
        }
    }
}
```

## Logic App for Receiving EDI Messages

```json
{
    "definition": {
        "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        "triggers": {
            "When_a_HTTP_request_is_received": {
                "type": "Request",
                "kind": "Http"
            }
        },
        "actions": {
            "Decode_X12_message": {
                "type": "ApiConnection",
                "inputs": {
                    "host": {
                        "connection": {
                            "name": "@parameters('$connections')['x12']['connectionId']"
                        }
                    },
                    "method": "post",
                    "path": "/decode",
                    "body": "@triggerBody()"
                }
            },
            "Parse_Purchase_Order": {
                "type": "ParseJson",
                "inputs": {
                    "content": "@body('Decode_X12_message')",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "purchaseOrderNumber": { "type": "string" },
                            "orderDate": { "type": "string" },
                            "items": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "itemNumber": { "type": "string" },
                                        "quantity": { "type": "integer" },
                                        "unitPrice": { "type": "number" }
                                    }
                                }
                            }
                        }
                    }
                },
                "runAfter": {
                    "Decode_X12_message": ["Succeeded"]
                }
            },
            "Insert_into_ERP": {
                "type": "ApiConnection",
                "inputs": {
                    "host": {
                        "connection": {
                            "name": "@parameters('$connections')['sql']['connectionId']"
                        }
                    },
                    "method": "post",
                    "path": "/datasets/default/tables/@{encodeURIComponent('[dbo].[PurchaseOrders]')}/items",
                    "body": {
                        "PONumber": "@body('Parse_Purchase_Order')?['purchaseOrderNumber']",
                        "OrderDate": "@body('Parse_Purchase_Order')?['orderDate']",
                        "Status": "Received"
                    }
                },
                "runAfter": {
                    "Parse_Purchase_Order": ["Succeeded"]
                }
            },
            "Generate_997_Acknowledgment": {
                "type": "ApiConnection",
                "inputs": {
                    "host": {
                        "connection": {
                            "name": "@parameters('$connections')['x12']['connectionId']"
                        }
                    },
                    "method": "post",
                    "path": "/encode997",
                    "body": "@body('Decode_X12_message')"
                },
                "runAfter": {
                    "Insert_into_ERP": ["Succeeded"]
                }
            }
        }
    }
}
```

## Sending EDI Messages

```json
{
    "triggers": {
        "When_order_is_ready": {
            "type": "ApiConnection",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['sql']['connectionId']"
                    }
                },
                "method": "get",
                "path": "/datasets/default/tables/@{encodeURIComponent('[dbo].[ShipmentNotices]')}/onnewitems"
            }
        }
    },
    "actions": {
        "Create_856_ASN": {
            "type": "Compose",
            "inputs": {
                "transactionSetId": "856",
                "shipmentId": "@triggerBody()?['ShipmentId']",
                "carrier": "@triggerBody()?['CarrierCode']",
                "trackingNumber": "@triggerBody()?['TrackingNumber']",
                "items": "@triggerBody()?['Items']"
            }
        },
        "Encode_X12_message": {
            "type": "ApiConnection",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['x12']['connectionId']"
                    }
                },
                "method": "post",
                "path": "/encode",
                "body": "@outputs('Create_856_ASN')"
            },
            "runAfter": {
                "Create_856_ASN": ["Succeeded"]
            }
        },
        "Send_via_AS2": {
            "type": "ApiConnection",
            "inputs": {
                "host": {
                    "connection": {
                        "name": "@parameters('$connections')['as2']['connectionId']"
                    }
                },
                "method": "post",
                "path": "/send",
                "body": "@body('Encode_X12_message')"
            },
            "runAfter": {
                "Encode_X12_message": ["Succeeded"]
            }
        }
    }
}
```

## XML Transformation with XSLT

Upload maps to the integration account and use them:

```json
{
    "Transform_XML": {
        "type": "Xslt",
        "inputs": {
            "content": "@triggerBody()",
            "integrationAccount": {
                "map": {
                    "name": "PO-to-Internal-Format"
                }
            }
        }
    }
}
```

## Error Handling and Monitoring

```json
{
    "Handle_EDI_Errors": {
        "type": "Scope",
        "actions": {
            "Decode_Message": { }
        }
    },
    "On_Failure": {
        "type": "Scope",
        "actions": {
            "Log_to_Service_Bus": {
                "type": "ApiConnection",
                "inputs": {
                    "host": {
                        "connection": {
                            "name": "@parameters('$connections')['servicebus']['connectionId']"
                        }
                    },
                    "method": "post",
                    "path": "/messages",
                    "body": {
                        "ContentData": "@base64(concat('EDI Error: ', actions('Decode_Message')?['error']?['message']))"
                    }
                }
            },
            "Send_Alert_Email": {
                "type": "ApiConnection",
                "inputs": {
                    "host": {
                        "connection": {
                            "name": "@parameters('$connections')['office365']['connectionId']"
                        }
                    },
                    "method": "post",
                    "path": "/v2/Mail",
                    "body": {
                        "To": "edi-support@company.com",
                        "Subject": "EDI Processing Error",
                        "Body": "An error occurred processing an EDI message."
                    }
                }
            }
        },
        "runAfter": {
            "Handle_EDI_Errors": ["Failed"]
        }
    }
}
```

## Tracking and Audit

Enable B2B tracking for compliance:

```bash
# Enable diagnostic settings
az monitor diagnostic-settings create \
    --name b2b-tracking \
    --resource "/subscriptions/{sub}/resourceGroups/rg-integration/providers/Microsoft.Logic/integrationAccounts/integration-account-b2b" \
    --workspace "/subscriptions/{sub}/resourceGroups/rg-monitoring/providers/microsoft.operationalinsights/workspaces/la-b2b" \
    --logs '[{"category":"IntegrationAccountTrackingEvents","enabled":true}]'
```

Azure Logic Apps provides a comprehensive platform for B2B integration, enabling secure and compliant partner communication.

A warning on the cost model: Integration Accounts are *not* cheap, and Standard tier is a meaningful monthly commitment even before you do any work. If you only need a couple of trading partners, calculate carefully — sometimes Logic Apps Standard with a custom AS2 connector ends up cheaper than full Integration Account licensing.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
