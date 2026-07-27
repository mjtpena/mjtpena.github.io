---
title: "Always Encrypted in Azure SQL Database"
author: "Michael John Peña"
draft: false
date: 2022-09-14
tags: ["Azure", "SQL Database", "Security", "Encryption"]

---

I wrote "Always Encrypted in Azure SQL Database" to share practical, production-minded guidance on this topic.

## Understanding Always Encrypted

Always Encrypted uses column encryption keys (CEKs) protected by column master keys (CMKs) to encrypt sensitive columns. The database engine never has access to the plaintext data.

### Setting Up Always Encrypted

```sql
-- Step 1: Create a Column Master Key (CMK)
-- First, create the key in Azure Key Vault, then register it in SQL

CREATE COLUMN MASTER KEY [CMK_AzureKeyVault]
WITH (
    KEY_STORE_PROVIDER_NAME = N'AZURE_KEY_VAULT',
    KEY_PATH = N'https://mykeyvault.vault.azure.net/keys/MyCMK/abc123def456'
);

-- Step 2: Create a Column Encryption Key (CEK)
CREATE COLUMN ENCRYPTION KEY [CEK_Auto1]
WITH VALUES (
    COLUMN_MASTER_KEY = [CMK_AzureKeyVault],
    ALGORITHM = 'RSA_OAEP',
    ENCRYPTED_VALUE = 0x01700000016... -- Generated encrypted value
);

-- Step 3: Create table with encrypted columns
CREATE TABLE dbo.Patients
(
    PatientID INT IDENTITY(1,1) PRIMARY KEY,
    FirstName NVARCHAR(50) COLLATE Latin1_General_BIN2
        ENCRYPTED WITH (
            ENCRYPTION_TYPE = DETERMINISTIC,
            ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
            COLUMN_ENCRYPTION_KEY = [CEK_Auto1]
        ),
    LastName NVARCHAR(50) COLLATE Latin1_General_BIN2
        ENCRYPTED WITH (
            ENCRYPTION_TYPE = DETERMINISTIC,
            ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
            COLUMN_ENCRYPTION_KEY = [CEK_Auto1]
        ),
    SSN CHAR(11) COLLATE Latin1_General_BIN2
        ENCRYPTED WITH (
            ENCRYPTION_TYPE = DETERMINISTIC,
            ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
            COLUMN_ENCRYPTION_KEY = [CEK_Auto1]
        ),
    DateOfBirth DATE
        ENCRYPTED WITH (
            ENCRYPTION_TYPE = RANDOMIZED,
            ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
            COLUMN_ENCRYPTION_KEY = [CEK_Auto1]
        ),
    MedicalNotes NVARCHAR(MAX)
        ENCRYPTED WITH (
            ENCRYPTION_TYPE = RANDOMIZED,
            ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
            COLUMN_ENCRYPTION_KEY = [CEK_Auto1]
        ),
    CreatedDate DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
```

### Client Application with Always Encrypted

```csharp
using Microsoft.Data.SqlClient;
using Microsoft.Data.SqlClient.AlwaysEncrypted.AzureKeyVaultProvider;
using Azure.Identity;

public class AlwaysEncryptedService
{
    private readonly string _connectionString;

    public AlwaysEncryptedService(string connectionString, string keyVaultUrl)
    {
        // Register the Azure Key Vault provider
        var credential = new DefaultAzureCredential();
        var azureKeyVaultProvider = new SqlColumnEncryptionAzureKeyVaultProvider(credential);

        var providers = new Dictionary<string, SqlColumnEncryptionKeyStoreProvider>
        {
            { SqlColumnEncryptionAzureKeyVaultProvider.ProviderName, azureKeyVaultProvider }
        };

        SqlConnection.RegisterColumnEncryptionKeyStoreProviders(providers);

        // Connection string must include Column Encryption Setting
        var builder = new SqlConnectionStringBuilder(connectionString)
        {
            ColumnEncryptionSetting = SqlConnectionColumnEncryptionSetting.Enabled
        };

        _connectionString = builder.ConnectionString;
    }

    public async Task<int> CreatePatientAsync(Patient patient)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        // Parameterized queries are required for encrypted columns
        var sql = @"
            INSERT INTO dbo.Patients (FirstName, LastName, SSN, DateOfBirth, MedicalNotes)
            VALUES (@FirstName, @LastName, @SSN, @DateOfBirth, @MedicalNotes);
            SELECT SCOPE_IDENTITY();";

        using var command = new SqlCommand(sql, connection);

        // SqlClient automatically encrypts parameter values
        command.Parameters.Add(new SqlParameter("@FirstName", SqlDbType.NVarChar, 50) { Value = patient.FirstName });
        command.Parameters.Add(new SqlParameter("@LastName", SqlDbType.NVarChar, 50) { Value = patient.LastName });
        command.Parameters.Add(new SqlParameter("@SSN", SqlDbType.Char, 11) { Value = patient.SSN });
        command.Parameters.Add(new SqlParameter("@DateOfBirth", SqlDbType.Date) { Value = patient.DateOfBirth });
        command.Parameters.Add(new SqlParameter("@MedicalNotes", SqlDbType.NVarChar, -1) { Value = patient.MedicalNotes ?? (object)DBNull.Value });

        var result = await command.ExecuteScalarAsync();
        return Convert.ToInt32(result);
    }

    public async Task<Patient> GetPatientBySSNAsync(string ssn)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        // Can query on deterministically encrypted columns
        var sql = @"
            SELECT PatientID, FirstName, LastName, SSN, DateOfBirth, MedicalNotes
            FROM dbo.Patients
            WHERE SSN = @SSN";

        using var command = new SqlCommand(sql, connection);
        command.Parameters.Add(new SqlParameter("@SSN", SqlDbType.Char, 11) { Value = ssn });

        using var reader = await command.ExecuteReaderAsync();

        if (await reader.ReadAsync())
        {
            // SqlClient automatically decrypts the values
            return new Patient
            {
                PatientID = reader.GetInt32(0),
                FirstName = reader.GetString(1),
                LastName = reader.GetString(2),
                SSN = reader.GetString(3),
                DateOfBirth = reader.GetDateTime(4),
                MedicalNotes = reader.IsDBNull(5) ? null : reader.GetString(5)
            };
        }

        return null;
    }

    public async Task<List<Patient>> SearchPatientsAsync(string lastName)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var sql = @"
            SELECT PatientID, FirstName, LastName, SSN, DateOfBirth, MedicalNotes
            FROM dbo.Patients
            WHERE LastName = @LastName
            ORDER BY LastName, FirstName";

        using var command = new SqlCommand(sql, connection);
        command.Parameters.Add(new SqlParameter("@LastName", SqlDbType.NVarChar, 50) { Value = lastName });

        var patients = new List<Patient>();
        using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            patients.Add(new Patient
            {
                PatientID = reader.GetInt32(0),
                FirstName = reader.GetString(1),
                LastName = reader.GetString(2),
                SSN = reader.GetString(3),
                DateOfBirth = reader.GetDateTime(4),
                MedicalNotes = reader.IsDBNull(5) ? null : reader.GetString(5)
            });
        }

        return patients;
    }
}

public class Patient
{
    public int PatientID { get; set; }
    public string FirstName { get; set; }
    public string LastName { get; set; }
    public string SSN { get; set; }
    public DateTime DateOfBirth { get; set; }
    public string MedicalNotes { get; set; }
}
```

### Always Encrypted with Secure Enclaves

```csharp
// Enclave-enabled connection for richer query operations
public class EnclaveEnabledService
{
    private readonly string _connectionString;

    public EnclaveEnabledService(string connectionString, string attestationUrl)
    {
        var builder = new SqlConnectionStringBuilder(connectionString)
        {
            ColumnEncryptionSetting = SqlConnectionColumnEncryptionSetting.Enabled,
            EnclaveAttestationUrl = attestationUrl,
            AttestationProtocol = SqlConnectionAttestationProtocol.AAS // Azure Attestation Service
        };

        _connectionString = builder.ConnectionString;
    }

    public async Task<List<Patient>> SearchPatientsWithEnclaveAsync(string lastNamePattern)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        // With enclaves, LIKE queries on encrypted columns are supported
        var sql = @"
            SELECT PatientID, FirstName, LastName, SSN, DateOfBirth
            FROM dbo.Patients
            WHERE LastName LIKE @Pattern
            ORDER BY LastName";

        using var command = new SqlCommand(sql, connection);
        command.Parameters.Add(new SqlParameter("@Pattern", SqlDbType.NVarChar, 50)
        {
            Value = $"{lastNamePattern}%"
        });

        var patients = new List<Patient>();
        using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            patients.Add(new Patient
            {
                PatientID = reader.GetInt32(0),
                FirstName = reader.GetString(1),
                LastName = reader.GetString(2),
                SSN = reader.GetString(3),
                DateOfBirth = reader.GetDateTime(4)
            });
        }

        return patients;
    }

    // Range queries on encrypted columns with enclaves
    public async Task<List<Patient>> GetPatientsByAgeRangeAsync(DateTime minDate, DateTime maxDate)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var sql = @"
            SELECT PatientID, FirstName, LastName, DateOfBirth
            FROM dbo.Patients
            WHERE DateOfBirth BETWEEN @MinDate AND @MaxDate
            ORDER BY DateOfBirth";

        using var command = new SqlCommand(sql, connection);
        command.Parameters.Add(new SqlParameter("@MinDate", SqlDbType.Date) { Value = minDate });
        command.Parameters.Add(new SqlParameter("@MaxDate", SqlDbType.Date) { Value = maxDate });

        var patients = new List<Patient>();
        using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            patients.Add(new Patient
            {
                PatientID = reader.GetInt32(0),
                FirstName = reader.GetString(1),
                LastName = reader.GetString(2),
                DateOfBirth = reader.GetDateTime(3)
            });
        }

        return patients;
    }
}
```

### Key Management Best Practices

```csharp
public class KeyManagementService
{
    private readonly string _keyVaultUrl;

    // Rotate Column Encryption Key
    public async Task RotateCEKAsync(string connectionString, string cekName)
    {
        // This requires the Always Encrypted wizard in SSMS or custom implementation
        // Basic approach:
        // 1. Create new CEK value
        // 2. Re-encrypt data with new key
        // 3. Remove old CEK value

        using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();

        // Get current CEK info
        var query = @"
            SELECT
                cek.name AS cek_name,
                cmk.name AS cmk_name,
                cekv.encrypted_value
            FROM sys.column_encryption_keys cek
            JOIN sys.column_encryption_key_values cekv ON cek.column_encryption_key_id = cekv.column_encryption_key_id
            JOIN sys.column_master_keys cmk ON cekv.column_master_key_id = cmk.column_master_key_id
            WHERE cek.name = @CekName";

        using var command = new SqlCommand(query, connection);
        command.Parameters.AddWithValue("@CekName", cekName);

        using var reader = await command.ExecuteReaderAsync();
        // Process key rotation logic
    }

    // Monitor encryption key usage
    public async Task<List<EncryptedColumnInfo>> GetEncryptedColumnsAsync(string connectionString)
    {
        using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();

        var query = @"
            SELECT
                SCHEMA_NAME(t.schema_id) AS schema_name,
                t.name AS table_name,
                c.name AS column_name,
                cek.name AS cek_name,
                cmk.name AS cmk_name,
                c.encryption_type_desc
            FROM sys.columns c
            JOIN sys.tables t ON c.object_id = t.object_id
            JOIN sys.column_encryption_keys cek ON c.column_encryption_key_id = cek.column_encryption_key_id
            JOIN sys.column_encryption_key_values cekv ON cek.column_encryption_key_id = cekv.column_encryption_key_id
            JOIN sys.column_master_keys cmk ON cekv.column_master_key_id = cmk.column_master_key_id
            WHERE c.encryption_type IS NOT NULL
            ORDER BY t.name, c.column_id";

        var columns = new List<EncryptedColumnInfo>();
        using var command = new SqlCommand(query, connection);
        using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            columns.Add(new EncryptedColumnInfo
            {
                SchemaName = reader.GetString(0),
                TableName = reader.GetString(1),
                ColumnName = reader.GetString(2),
                CEKName = reader.GetString(3),
                CMKName = reader.GetString(4),
                EncryptionType = reader.GetString(5)
            });
        }

        return columns;
    }
}

public class EncryptedColumnInfo
{
    public string SchemaName { get; set; }
    public string TableName { get; set; }
    public string ColumnName { get; set; }
    public string CEKName { get; set; }
    public string CMKName { get; set; }
    public string EncryptionType { get; set; }
}
```

## Key Considerations

1. **Deterministic vs Randomized** - Use deterministic for equality searches, randomized for maximum security
2. **Performance impact** - Encryption/decryption happens client-side
3. **Key management** - Store CMKs securely in Azure Key Vault
4. **Supported operations** - Limited query operations on encrypted columns without enclaves

Always Encrypted provides defense-in-depth for your most sensitive data columns.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
