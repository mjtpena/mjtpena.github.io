---
title: "Service Broker in Azure SQL Managed Instance"
author: "Michael John Peña"
draft: false
date: 2022-09-20
tags: ["Azure", "SQL Managed Instance", "Service Broker", "Messaging"]

---

I wrote "Service Broker in Azure SQL Managed Instance" to share practical, production-minded guidance on this topic.

## Understanding Service Broker

Service Broker provides queuing and messaging functionality within SQL Server, allowing for decoupled, asynchronous communication between services.

### Setting Up Service Broker

```sql
-- Enable Service Broker on the database
ALTER DATABASE MyDatabase SET ENABLE_BROKER WITH ROLLBACK IMMEDIATE;

-- Verify Service Broker is enabled
SELECT
    name,
    is_broker_enabled,
    service_broker_guid
FROM sys.databases
WHERE name = 'MyDatabase';

-- Create message types
CREATE MESSAGE TYPE OrderRequest
VALIDATION = WELL_FORMED_XML;

CREATE MESSAGE TYPE OrderResponse
VALIDATION = WELL_FORMED_XML;

-- Create contract
CREATE CONTRACT OrderProcessingContract
(
    OrderRequest SENT BY INITIATOR,
    OrderResponse SENT BY TARGET
);

-- Create queues
CREATE QUEUE OrderRequestQueue;
CREATE QUEUE OrderResponseQueue;

-- Create services
CREATE SERVICE OrderService
ON QUEUE OrderRequestQueue (OrderProcessingContract);

CREATE SERVICE OrderResponseService
ON QUEUE OrderResponseQueue (OrderProcessingContract);
```

### Sending Messages

```sql
-- Procedure to send order request
CREATE PROCEDURE dbo.SendOrderRequest
    @OrderID INT,
    @CustomerID INT,
    @TotalAmount DECIMAL(18,2)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ConversationHandle UNIQUEIDENTIFIER;
    DECLARE @MessageBody XML;

    -- Create message body
    SET @MessageBody = (
        SELECT
            @OrderID AS OrderID,
            @CustomerID AS CustomerID,
            @TotalAmount AS TotalAmount,
            GETUTCDATE() AS RequestTime
        FOR XML PATH('OrderRequest'), TYPE
    );

    -- Begin conversation
    BEGIN DIALOG CONVERSATION @ConversationHandle
        FROM SERVICE OrderResponseService
        TO SERVICE 'OrderService'
        ON CONTRACT OrderProcessingContract
        WITH ENCRYPTION = OFF;

    -- Send message
    SEND ON CONVERSATION @ConversationHandle
        MESSAGE TYPE OrderRequest (@MessageBody);

    -- Log the sent message
    INSERT INTO dbo.MessageLog (ConversationHandle, MessageType, MessageBody, SentAt)
    VALUES (@ConversationHandle, 'OrderRequest', CAST(@MessageBody AS NVARCHAR(MAX)), GETUTCDATE());

    RETURN @ConversationHandle;
END;
GO
```

### Receiving and Processing Messages

```sql
-- Activation procedure for processing orders
CREATE PROCEDURE dbo.ProcessOrderRequest
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ConversationHandle UNIQUEIDENTIFIER;
    DECLARE @MessageType NVARCHAR(256);
    DECLARE @MessageBody XML;

    WHILE 1 = 1
    BEGIN
        BEGIN TRANSACTION;

        WAITFOR (
            RECEIVE TOP(1)
                @ConversationHandle = conversation_handle,
                @MessageType = message_type_name,
                @MessageBody = CAST(message_body AS XML)
            FROM OrderRequestQueue
        ), TIMEOUT 5000;

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRANSACTION;
            BREAK;
        END

        IF @MessageType = N'OrderRequest'
        BEGIN
            -- Extract order details
            DECLARE @OrderID INT = @MessageBody.value('(/OrderRequest/OrderID)[1]', 'INT');
            DECLARE @CustomerID INT = @MessageBody.value('(/OrderRequest/CustomerID)[1]', 'INT');
            DECLARE @TotalAmount DECIMAL(18,2) = @MessageBody.value('(/OrderRequest/TotalAmount)[1]', 'DECIMAL(18,2)');

            -- Process the order
            BEGIN TRY
                -- Insert into orders table
                INSERT INTO dbo.ProcessedOrders (OrderID, CustomerID, TotalAmount, ProcessedAt)
                VALUES (@OrderID, @CustomerID, @TotalAmount, GETUTCDATE());

                -- Send success response
                DECLARE @ResponseBody XML = (
                    SELECT
                        @OrderID AS OrderID,
                        'Success' AS Status,
                        GETUTCDATE() AS ProcessedAt
                    FOR XML PATH('OrderResponse'), TYPE
                );

                SEND ON CONVERSATION @ConversationHandle
                    MESSAGE TYPE OrderResponse (@ResponseBody);

            END TRY
            BEGIN CATCH
                -- Send error response
                DECLARE @ErrorResponse XML = (
                    SELECT
                        @OrderID AS OrderID,
                        'Error' AS Status,
                        ERROR_MESSAGE() AS ErrorMessage
                    FOR XML PATH('OrderResponse'), TYPE
                );

                SEND ON CONVERSATION @ConversationHandle
                    MESSAGE TYPE OrderResponse (@ErrorResponse);
            END CATCH

            -- End the conversation
            END CONVERSATION @ConversationHandle;
        END
        ELSE IF @MessageType = N'http://schemas.microsoft.com/SQL/ServiceBroker/EndDialog'
        BEGIN
            END CONVERSATION @ConversationHandle;
        END
        ELSE IF @MessageType = N'http://schemas.microsoft.com/SQL/ServiceBroker/Error'
        BEGIN
            END CONVERSATION @ConversationHandle;
        END

        COMMIT TRANSACTION;
    END
END;
GO

-- Enable activation on the queue
ALTER QUEUE OrderRequestQueue
WITH ACTIVATION (
    STATUS = ON,
    PROCEDURE_NAME = dbo.ProcessOrderRequest,
    MAX_QUEUE_READERS = 5,
    EXECUTE AS SELF
);
```

### C# Integration

```csharp
using Microsoft.Data.SqlClient;

public class ServiceBrokerClient
{
    private readonly string _connectionString;

    public ServiceBrokerClient(string connectionString)
    {
        _connectionString = connectionString;
    }

    public async Task<Guid> SendOrderAsync(int orderId, int customerId, decimal totalAmount)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        using var command = new SqlCommand("dbo.SendOrderRequest", connection)
        {
            CommandType = CommandType.StoredProcedure
        };

        command.Parameters.AddWithValue("@OrderID", orderId);
        command.Parameters.AddWithValue("@CustomerID", customerId);
        command.Parameters.AddWithValue("@TotalAmount", totalAmount);

        var result = await command.ExecuteScalarAsync();
        return (Guid)result;
    }

    public async Task<OrderResponse> WaitForResponseAsync(
        Guid conversationHandle,
        TimeSpan timeout)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var query = @"
            WAITFOR (
                RECEIVE TOP(1)
                    conversation_handle,
                    message_type_name,
                    CAST(message_body AS XML) AS message_body
                FROM OrderResponseQueue
                WHERE conversation_handle = @ConversationHandle
            ), TIMEOUT @TimeoutMs";

        using var command = new SqlCommand(query, connection);
        command.Parameters.AddWithValue("@ConversationHandle", conversationHandle);
        command.Parameters.AddWithValue("@TimeoutMs", (int)timeout.TotalMilliseconds);

        using var reader = await command.ExecuteReaderAsync();

        if (await reader.ReadAsync())
        {
            var messageBody = reader.GetSqlXml(2).CreateReader();
            var doc = new XmlDocument();
            doc.Load(messageBody);

            return new OrderResponse
            {
                OrderID = int.Parse(doc.SelectSingleNode("//OrderID")?.InnerText ?? "0"),
                Status = doc.SelectSingleNode("//Status")?.InnerText,
                ErrorMessage = doc.SelectSingleNode("//ErrorMessage")?.InnerText
            };
        }

        return null;
    }

    public async Task ProcessMessagesAsync(
        Func<OrderRequest, Task<OrderResponse>> processor,
        CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            using var transaction = connection.BeginTransaction();

            var query = @"
                WAITFOR (
                    RECEIVE TOP(1)
                        conversation_handle,
                        message_type_name,
                        CAST(message_body AS XML) AS message_body
                    FROM OrderRequestQueue
                ), TIMEOUT 5000";

            using var receiveCmd = new SqlCommand(query, connection, transaction);
            using var reader = await receiveCmd.ExecuteReaderAsync(cancellationToken);

            if (await reader.ReadAsync(cancellationToken))
            {
                var conversationHandle = reader.GetGuid(0);
                var messageType = reader.GetString(1);

                if (messageType == "OrderRequest")
                {
                    var messageBody = reader.GetSqlXml(2).CreateReader();
                    var doc = new XmlDocument();
                    doc.Load(messageBody);

                    var request = new OrderRequest
                    {
                        OrderID = int.Parse(doc.SelectSingleNode("//OrderID")?.InnerText ?? "0"),
                        CustomerID = int.Parse(doc.SelectSingleNode("//CustomerID")?.InnerText ?? "0"),
                        TotalAmount = decimal.Parse(doc.SelectSingleNode("//TotalAmount")?.InnerText ?? "0")
                    };

                    reader.Close();

                    var response = await processor(request);

                    // Send response
                    await SendResponseAsync(connection, transaction, conversationHandle, response);
                }
            }

            reader.Close();
            transaction.Commit();
        }
    }

    private async Task SendResponseAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid conversationHandle,
        OrderResponse response)
    {
        var responseXml = $@"
            <OrderResponse>
                <OrderID>{response.OrderID}</OrderID>
                <Status>{response.Status}</Status>
                <ErrorMessage>{response.ErrorMessage}</ErrorMessage>
            </OrderResponse>";

        var sendQuery = @"
            SEND ON CONVERSATION @ConversationHandle
            MESSAGE TYPE OrderResponse (@MessageBody);
            END CONVERSATION @ConversationHandle";

        using var sendCmd = new SqlCommand(sendQuery, connection, transaction);
        sendCmd.Parameters.AddWithValue("@ConversationHandle", conversationHandle);
        sendCmd.Parameters.AddWithValue("@MessageBody", responseXml);

        await sendCmd.ExecuteNonQueryAsync();
    }
}

public class OrderRequest
{
    public int OrderID { get; set; }
    public int CustomerID { get; set; }
    public decimal TotalAmount { get; set; }
}

public class OrderResponse
{
    public int OrderID { get; set; }
    public string Status { get; set; }
    public string ErrorMessage { get; set; }
}
```

### Monitoring Service Broker

```sql
-- Queue status
SELECT
    name AS queue_name,
    is_activation_enabled,
    is_receive_enabled,
    is_enqueue_enabled,
    activation_procedure
FROM sys.service_queues;

-- Message counts
SELECT
    q.name AS queue_name,
    p.rows AS message_count
FROM sys.service_queues q
JOIN sys.internal_tables it ON q.object_id = it.parent_object_id
JOIN sys.partitions p ON it.object_id = p.object_id
WHERE it.internal_type = 201;

-- Conversation endpoints
SELECT
    ce.conversation_handle,
    ce.state_desc,
    s.name AS service_name,
    ce.lifetime
FROM sys.conversation_endpoints ce
JOIN sys.services s ON ce.service_id = s.service_id;
```

Service Broker provides reliable messaging capabilities directly within Azure SQL Managed Instance for event-driven architectures.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
