---
title: "Azure Cosmos DB API for MongoDB: Patterns and Best Practices"
description: "Azure Cosmos DB's MongoDB API provides a powerful option for teams wanting MongoDB compatibility with Azure's enterprise-grade platform."
author: "Michael John Peña"
draft: false
date: 2022-09-06
tags: ["Azure", "Cosmos DB", "MongoDB", "Database", "NoSQL"]
---

## Understanding Cosmos DB's MongoDB API

The MongoDB API for Cosmos DB lets you use familiar MongoDB drivers and tools while benefiting from:

- Global distribution with multi-region writes
- Automatic indexing
- Elastic scale with RU-based throughput
- 99.999% availability SLA
- Comprehensive compliance certifications

### Connecting to Cosmos DB with MongoDB Protocol

```javascript
// Node.js connection using the native MongoDB driver
const { MongoClient } = require('mongodb');

const connectionString = process.env.COSMOS_DB_CONNECTION_STRING;
// Format: mongodb://<account>:<key>@<account>.mongo.cosmos.azure.com:10255/?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@<account>@

async function connectToCosmosDB() {
    const client = new MongoClient(connectionString, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        retryWrites: false
    });

    try {
        await client.connect();
        console.log('Connected to Azure Cosmos DB (MongoDB API)');

        const database = client.db('ecommerce');
        const collection = database.collection('products');

        // Test the connection
        const pingResult = await database.command({ ping: 1 });
        console.log('Ping result:', pingResult);

        return { client, database, collection };
    } catch (error) {
        console.error('Connection error:', error);
        throw error;
    }
}
```

### CRUD Operations

```javascript
// Create documents
async function createProduct(collection, product) {
    const result = await collection.insertOne({
        name: product.name,
        category: product.category,
        price: product.price,
        inventory: product.inventory,
        tags: product.tags,
        createdAt: new Date(),
        updatedAt: new Date()
    });

    console.log(`Product created with ID: ${result.insertedId}`);
    return result;
}

// Bulk insert - use ordered: false for better performance
async function bulkInsertProducts(collection, products) {
    const operations = products.map(product => ({
        insertOne: {
            document: {
                ...product,
                createdAt: new Date(),
                updatedAt: new Date()
            }
        }
    }));

    const result = await collection.bulkWrite(operations, { ordered: false });
    console.log(`Inserted ${result.insertedCount} products`);
    return result;
}

// Read with aggregation pipeline
async function getProductsByCategory(collection, category) {
    const pipeline = [
        { $match: { category: category } },
        { $sort: { price: 1 } },
        {
            $project: {
                name: 1,
                price: 1,
                inventory: 1,
                priceRange: {
                    $switch: {
                        branches: [
                            { case: { $lt: ['$price', 50] }, then: 'budget' },
                            { case: { $lt: ['$price', 200] }, then: 'mid-range' }
                        ],
                        default: 'premium'
                    }
                }
            }
        }
    ];

    return await collection.aggregate(pipeline).toArray();
}

// Update with operators
async function updateProductInventory(collection, productId, quantityChange) {
    const result = await collection.updateOne(
        { _id: productId },
        {
            $inc: { inventory: quantityChange },
            $set: { updatedAt: new Date() },
            $push: {
                inventoryHistory: {
                    change: quantityChange,
                    timestamp: new Date()
                }
            }
        }
    );

    return result;
}

// Delete with conditions
async function deleteDiscontinuedProducts(collection) {
    const result = await collection.deleteMany({
        $and: [
            { inventory: 0 },
            { discontinued: true }
        ]
    });

    console.log(`Deleted ${result.deletedCount} discontinued products`);
    return result;
}
```

### Advanced Queries

```javascript
// Text search (requires text index)
async function setupTextSearch(collection) {
    await collection.createIndex(
        { name: 'text', description: 'text', tags: 'text' },
        { weights: { name: 10, description: 5, tags: 1 } }
    );
}

async function searchProducts(collection, searchTerm) {
    return await collection.find(
        { $text: { $search: searchTerm } },
        { score: { $meta: 'textScore' } }
    )
    .sort({ score: { $meta: 'textScore' } })
    .limit(20)
    .toArray();
}

// Geospatial queries (requires 2dsphere index)
async function setupGeoIndex(collection) {
    await collection.createIndex({ location: '2dsphere' });
}

async function findNearbyStores(collection, longitude, latitude, maxDistanceMeters) {
    return await collection.find({
        location: {
            $near: {
                $geometry: {
                    type: 'Point',
                    coordinates: [longitude, latitude]
                },
                $maxDistance: maxDistanceMeters
            }
        }
    }).toArray();
}

// Complex aggregation for analytics
async function getSalesAnalytics(ordersCollection) {
    const pipeline = [
        {
            $match: {
                orderDate: {
                    $gte: new Date('2022-01-01'),
                    $lt: new Date('2023-01-01')
                }
            }
        },
        {
            $unwind: '$items'
        },
        {
            $group: {
                _id: {
                    month: { $month: '$orderDate' },
                    category: '$items.category'
                },
                totalSales: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                orderCount: { $sum: 1 },
                avgOrderValue: { $avg: { $multiply: ['$items.price', '$items.quantity'] } }
            }
        },
        {
            $sort: { '_id.month': 1, totalSales: -1 }
        },
        {
            $group: {
                _id: '$_id.month',
                categories: {
                    $push: {
                        category: '$_id.category',
                        totalSales: '$totalSales',
                        orderCount: '$orderCount',
                        avgOrderValue: '$avgOrderValue'
                    }
                },
                monthlyTotal: { $sum: '$totalSales' }
            }
        }
    ];

    return await ordersCollection.aggregate(pipeline).toArray();
}
```

### Python Integration

```python
from pymongo import MongoClient
from datetime import datetime
import os

connection_string = os.environ.get('COSMOS_DB_CONNECTION_STRING')

class ProductRepository:
    def __init__(self):
        self.client = MongoClient(connection_string)
        self.db = self.client['ecommerce']
        self.products = self.db['products']

    def create_product(self, product_data):
        product_data['created_at'] = datetime.utcnow()
        product_data['updated_at'] = datetime.utcnow()
        result = self.products.insert_one(product_data)
        return str(result.inserted_id)

    def find_products(self, filters=None, sort_by=None, limit=100):
        cursor = self.products.find(filters or {})

        if sort_by:
            cursor = cursor.sort(sort_by)

        return list(cursor.limit(limit))

    def aggregate_by_category(self):
        pipeline = [
            {
                '$group': {
                    '_id': '$category',
                    'count': {'$sum': 1},
                    'avg_price': {'$avg': '$price'},
                    'total_inventory': {'$sum': '$inventory'}
                }
            },
            {'$sort': {'count': -1}}
        ]
        return list(self.products.aggregate(pipeline))

    def close(self):
        self.client.close()


# Usage
if __name__ == '__main__':
    repo = ProductRepository()

    # Create a product
    product_id = repo.create_product({
        'name': 'Wireless Mouse',
        'category': 'Electronics',
        'price': 29.99,
        'inventory': 150
    })
    print(f'Created product: {product_id}')

    # Get category stats
    stats = repo.aggregate_by_category()
    for stat in stats:
        print(f"Category: {stat['_id']}, Count: {stat['count']}, Avg Price: ${stat['avg_price']:.2f}")

    repo.close()
```

## Request Units (RU) Considerations

Unlike native MongoDB, Cosmos DB uses Request Units (RU) for throughput:

```javascript
// Check RU consumption for operations
async function measureOperationCost(collection, operation) {
    const result = await operation();

    // Access the command result to see RU charge
    const lastOp = await collection.s.db.command({ getLastRequestStatistics: 1 });
    console.log(`Operation consumed ${lastOp.RequestCharge} RUs`);

    return result;
}

// Optimize queries to reduce RU consumption
async function efficientQuery(collection, category) {
    // Use projection to return only needed fields
    return await collection.find(
        { category: category },
        {
            projection: { name: 1, price: 1, _id: 0 }
        }
    )
    .limit(50)  // Always limit results
    .toArray();
}
```

## Indexing Best Practices

```javascript
// Cosmos DB automatically indexes all fields, but custom indexes improve performance
async function setupOptimalIndexes(collection) {
    // Compound index for common query patterns
    await collection.createIndex(
        { category: 1, price: -1 },
        { name: 'category_price_idx' }
    );

    // Unique index for business keys
    await collection.createIndex(
        { sku: 1 },
        { unique: true, name: 'sku_unique_idx' }
    );

    // TTL index for automatic document expiration
    await collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'ttl_idx' }
    );
}
```

## Benefits of Cosmos DB MongoDB API

1. **Familiar MongoDB experience** - Use existing drivers, tools, and code
2. **Global distribution** - Multi-region reads and writes with automatic failover
3. **Elastic scale** - Adjust throughput without downtime
4. **Comprehensive SLAs** - 99.999% availability guarantee
5. **Azure integration** - Private endpoints, AAD authentication, Azure Monitor

## When to Choose MongoDB API

The MongoDB API is ideal when:
- Migrating existing MongoDB applications to Azure
- Team has strong MongoDB expertise
- Using MongoDB-specific features (aggregation pipeline, geospatial queries)
- Need global distribution with MongoDB compatibility

Azure Cosmos DB's MongoDB API provides a powerful option for teams wanting MongoDB compatibility with Azure's enterprise-grade platform.

## Resources

- [Azure Cosmos DB MongoDB API Documentation](https://docs.microsoft.com/en-us/azure/cosmos-db/mongodb/mongodb-introduction)
- [MongoDB Driver Compatibility](https://docs.microsoft.com/en-us/azure/cosmos-db/mongodb/feature-support-40)
- [Indexing in Cosmos DB MongoDB API](https://docs.microsoft.com/en-us/azure/cosmos-db/mongodb/mongodb-indexing)
