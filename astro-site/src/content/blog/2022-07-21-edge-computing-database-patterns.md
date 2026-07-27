---
title: "Edge Computing Database Patterns and Best Practices"
author: "Michael John Peña"
draft: false
date: 2022-07-21
tags: ["Edge Computing", "Database", "IoT", "Azure", "Architecture"]

---

I wrote "Edge Computing Database Patterns and Best Practices" to share practical, production-minded guidance on this topic.

## Pattern 1: Store and Forward

Handle intermittent connectivity by storing data locally and forwarding when connected.

```python
import sqlite3
import requests
import json
from datetime import datetime
from queue import Queue
from threading import Thread, Event

class StoreAndForwardDatabase:
    def __init__(self, local_db_path, cloud_endpoint):
        self.local_db = sqlite3.connect(local_db_path, check_same_thread=False)
        self.cloud_endpoint = cloud_endpoint
        self.stop_event = Event()
        self._init_db()
        self._start_sync_thread()

    def _init_db(self):
        self.local_db.execute('''
            CREATE TABLE IF NOT EXISTS outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                sync_status TEXT DEFAULT 'pending',
                retry_count INTEGER DEFAULT 0
            )
        ''')
        self.local_db.commit()

    def store(self, data):
        """Store data locally"""
        self.local_db.execute(
            'INSERT INTO outbox (payload) VALUES (?)',
            [json.dumps(data)]
        )
        self.local_db.commit()

    def _sync_to_cloud(self):
        """Background thread to sync pending data"""
        while not self.stop_event.is_set():
            cursor = self.local_db.execute('''
                SELECT id, payload FROM outbox
                WHERE sync_status = 'pending' AND retry_count < 5
                ORDER BY created_at LIMIT 100
            ''')

            rows = cursor.fetchall()
            for row_id, payload in rows:
                try:
                    response = requests.post(
                        self.cloud_endpoint,
                        json=json.loads(payload),
                        timeout=10
                    )
                    if response.ok:
                        self.local_db.execute(
                            "UPDATE outbox SET sync_status = 'synced' WHERE id = ?",
                            [row_id]
                        )
                    else:
                        self._increment_retry(row_id)
                except requests.RequestException:
                    self._increment_retry(row_id)

            self.local_db.commit()
            self.stop_event.wait(5)  # Check every 5 seconds

    def _increment_retry(self, row_id):
        self.local_db.execute(
            'UPDATE outbox SET retry_count = retry_count + 1 WHERE id = ?',
            [row_id]
        )

    def _start_sync_thread(self):
        Thread(target=self._sync_to_cloud, daemon=True).start()
```

## Pattern 2: Local Aggregation

Reduce data volume by aggregating at the edge before cloud sync.

```sql
-- SQL Edge streaming job for local aggregation
CREATE STREAMING JOB EdgeAggregation AS
SELECT
    DeviceId,
    System.Timestamp() AS WindowEnd,
    AVG(Temperature) AS AvgTemperature,
    MAX(Temperature) AS MaxTemperature,
    MIN(Temperature) AS MinTemperature,
    COUNT(*) AS ReadingCount
INTO AggregatedReadings
FROM RawSensorInput
TIMESTAMP BY EventTime
GROUP BY DeviceId, TumblingWindow(minute, 5);

-- Only sync aggregates to cloud, not raw data
CREATE TABLE CloudSyncQueue (
    Id INT IDENTITY PRIMARY KEY,
    DeviceId VARCHAR(50),
    WindowEnd DATETIME2,
    AggregatedData NVARCHAR(MAX),
    SyncStatus VARCHAR(20) DEFAULT 'pending'
);

-- Trigger to queue aggregates for cloud sync
CREATE TRIGGER trg_QueueForSync
ON AggregatedReadings
AFTER INSERT
AS
BEGIN
    INSERT INTO CloudSyncQueue (DeviceId, WindowEnd, AggregatedData)
    SELECT
        DeviceId,
        WindowEnd,
        (SELECT * FROM inserted FOR JSON AUTO)
    FROM inserted;
END;
```

## Pattern 3: Conflict Resolution

Handle conflicts when data is modified both locally and in the cloud.

```python
from datetime import datetime
import hashlib

class ConflictResolvingSync:
    def __init__(self, local_db, cloud_api):
        self.local_db = local_db
        self.cloud_api = cloud_api

    def sync_record(self, table, record_id):
        """Sync a record with conflict resolution"""
        # Get local version
        local = self.local_db.get(table, record_id)

        # Get cloud version
        cloud = self.cloud_api.get(table, record_id)

        if not cloud:
            # New local record, push to cloud
            self.cloud_api.create(table, local)
            return 'created'

        if not local:
            # New cloud record, pull to local
            self.local_db.create(table, cloud)
            return 'downloaded'

        # Both exist - check for conflicts
        if local['version'] == cloud['version']:
            return 'in_sync'

        # Conflict detected - resolve based on strategy
        return self._resolve_conflict(table, local, cloud)

    def _resolve_conflict(self, table, local, cloud):
        """Last-write-wins conflict resolution"""
        local_time = datetime.fromisoformat(local['modified_at'])
        cloud_time = datetime.fromisoformat(cloud['modified_at'])

        if local_time > cloud_time:
            # Local is newer, push to cloud
            cloud['data'] = local['data']
            cloud['version'] = local['version']
            cloud['modified_at'] = local['modified_at']
            self.cloud_api.update(table, cloud)
            return 'pushed_local'
        else:
            # Cloud is newer, pull to local
            local['data'] = cloud['data']
            local['version'] = cloud['version']
            local['modified_at'] = cloud['modified_at']
            self.local_db.update(table, local)
            return 'pulled_cloud'
```

## Pattern 4: Data Retention at Edge

Manage limited storage with automatic cleanup.

```sql
-- Enable data retention in SQL Edge
ALTER DATABASE EdgeDB SET DATA_RETENTION ON;

-- Configure retention per table
ALTER TABLE RawSensorReadings
SET (DATA_RETENTION_PERIOD = 2 DAYS);

ALTER TABLE AggregatedReadings
SET (DATA_RETENTION_PERIOD = 30 DAYS);

ALTER TABLE AlertHistory
SET (DATA_RETENTION_PERIOD = 90 DAYS);

-- Manual cleanup for more control
CREATE PROCEDURE sp_CleanupOldData
AS
BEGIN
    DECLARE @CutoffDate DATETIME2 = DATEADD(DAY, -2, GETUTCDATE());

    -- Delete in batches to avoid long locks
    WHILE 1 = 1
    BEGIN
        DELETE TOP (10000) FROM RawSensorReadings
        WHERE timestamp < @CutoffDate;

        IF @@ROWCOUNT = 0 BREAK;

        WAITFOR DELAY '00:00:01';  -- Pause between batches
    END
END;
```

## Pattern 5: Schema Evolution

Handle schema changes across edge devices and cloud.

```python
class SchemaVersionManager:
    def __init__(self, db_connection):
        self.db = db_connection
        self._init_version_table()

    def _init_version_table(self):
        self.db.execute('''
            CREATE TABLE IF NOT EXISTS schema_version (
                version INT PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                description TEXT
            )
        ''')

    def get_current_version(self):
        result = self.db.execute(
            'SELECT MAX(version) FROM schema_version'
        ).fetchone()
        return result[0] or 0

    def apply_migrations(self, migrations):
        """Apply pending migrations"""
        current = self.get_current_version()

        for version, description, sql in migrations:
            if version > current:
                try:
                    self.db.execute(sql)
                    self.db.execute(
                        'INSERT INTO schema_version (version, description) VALUES (?, ?)',
                        [version, description]
                    )
                    self.db.commit()
                    print(f"Applied migration {version}: {description}")
                except Exception as e:
                    self.db.rollback()
                    raise Exception(f"Migration {version} failed: {e}")

# Define migrations
migrations = [
    (1, "Initial schema", '''
        CREATE TABLE devices (
            id TEXT PRIMARY KEY,
            name TEXT,
            type TEXT
        )
    '''),
    (2, "Add location field", '''
        ALTER TABLE devices ADD COLUMN location TEXT
    '''),
    (3, "Add telemetry table", '''
        CREATE TABLE telemetry (
            device_id TEXT,
            timestamp DATETIME,
            data TEXT
        )
    ''')
]

# Apply on startup
manager = SchemaVersionManager(db_connection)
manager.apply_migrations(migrations)
```

These patterns enable robust edge database deployments that handle real-world challenges like connectivity issues, limited resources, and cloud integration.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
