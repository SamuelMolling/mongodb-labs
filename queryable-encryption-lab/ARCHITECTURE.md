# Architecture Overview

## System Architecture

This application demonstrates MongoDB Queryable Encryption through a multi-layered architecture following Go best practices.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Web Browser                             │
│                    (HTML/CSS/JavaScript)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/REST API
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      HTTP Layer (Gin)                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Handlers (internal/handler)                             │   │
│  │  - Request validation                                    │   │
│  │  - Response formatting                                   │   │
│  │  - Error handling                                        │   │
│  └────────────────────────┬─────────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Business Logic Layer                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Service (internal/service)                              │   │
│  │  - Business rules                                        │   │
│  │  - Data transformation                                   │   │
│  │  - Validation                                            │   │
│  └────────────────────────┬─────────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Data Access Layer                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Repository (internal/repository)                        │   │
│  │  - MongoDB operations                                    │   │
│  │  - Query construction                                    │   │
│  │  - Error mapping                                         │   │
│  └────────────────────────┬─────────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              MongoDB Driver with Auto-Encryption                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Encryption Manager (internal/encryption)                │   │
│  │  - Key management                                        │   │
│  │  │  - Master key loading/generation                      │   │
│  │  │  - Data encryption keys (DEKs)                        │   │
│  │  │                                                        │   │
│  │  - Encrypted field configuration                         │   │
│  │  │  - Equality queries (name, SSN)                       │   │
│  │  │  - Range queries (salary)                             │   │
│  │  │                                                        │   │
│  │  - Auto-encryption options                               │   │
│  │    - Transparent encrypt/decrypt                         │   │
│  │    - Crypt shared library integration                    │   │
│  └────────────────────────┬─────────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MongoDB Atlas/Server                       │
│                                                                 │
│  ┌─────────────────────┐        ┌─────────────────────────┐    │
│  │  Encrypted          │        │  Key Vault              │    │
│  │  Collection         │        │                         │    │
│  │                     │        │  Contains data          │    │
│  │  {                  │        │  encryption keys        │    │
│  │    name: "***",     │◄───────┤  (DEKs)                 │    │
│  │    ssn: "***",      │        │                         │    │
│  │    salary: ***      │        │  Protected by           │    │
│  │  }                  │        │  master key             │    │
│  └─────────────────────┘        └─────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Layer Details

### 1. HTTP Layer (`internal/handler`)
**Purpose**: Handle HTTP requests and responses

**Responsibilities**:
- Parse and validate incoming requests
- Call service layer
- Format responses (JSON)
- Handle HTTP status codes
- Manage CORS

**Key Files**:
- `employee_handler.go`: All employee-related endpoints

### 2. Business Logic Layer (`internal/service`)
**Purpose**: Implement business rules and orchestration

**Responsibilities**:
- Input validation
- Business rule enforcement
- Data transformation
- Orchestrate repository calls
- Error handling and logging

**Key Files**:
- `employee_service.go`: Employee business logic

### 3. Data Access Layer (`internal/repository`)
**Purpose**: Abstract database operations

**Responsibilities**:
- MongoDB CRUD operations
- Query construction with encryption
- Cursor management
- Error mapping

**Key Files**:
- `employee_repository.go`: Employee database operations

### 4. Encryption Layer (`internal/encryption`)
**Purpose**: Configure and manage queryable encryption

**Responsibilities**:
- Master key management
- Data encryption key (DEK) management
- Configure encrypted fields
- Setup auto-encryption options

**Key Files**:
- `setup.go`: Encryption configuration and setup

### 5. Models (`internal/models`)
**Purpose**: Define data structures

**Responsibilities**:
- Data models
- Request/Response DTOs
- Validation rules
- Data transformations

**Key Files**:
- `employee.go`: Employee model and DTOs

### 6. Configuration (`internal/config`)
**Purpose**: Application configuration

**Responsibilities**:
- Load environment variables
- Provide configuration to other layers
- Default values

**Key Files**:
- `config.go`: Configuration management

## Encryption Flow

### Insertion (Write Path)

```
1. User submits employee data via web form
   ↓
2. Handler receives request
   ↓
3. Service validates business rules
   ↓
4. Repository calls MongoDB insert
   ↓
5. MongoDB Driver INTERCEPTS the operation
   │
   ├─→ Checks encrypted fields config
   │
   ├─→ For each encrypted field:
   │   ├─→ Gets/creates data encryption key (DEK) from key vault
   │   ├─→ Encrypts field value with DEK
   │   └─→ Creates encrypted index structures (for querying)
   │
   └─→ Sends encrypted document to MongoDB
   ↓
6. MongoDB stores encrypted data
```

### Query (Read Path)

```
1. User searches for employee (e.g., by name)
   ↓
2. Handler receives search request
   ↓
3. Service validates search parameters
   ↓
4. Repository builds MongoDB query
   ↓
5. MongoDB Driver INTERCEPTS the query
   │
   ├─→ Identifies encrypted fields in query
   │
   ├─→ For equality queries (name, SSN):
   │   ├─→ Gets DEK from key vault
   │   ├─→ Encrypts search value
   │   └─→ Searches encrypted index
   │
   ├─→ For range queries (salary):
   │   ├─→ Gets DEK from key vault
   │   ├─→ Encrypts range bounds
   │   └─→ Searches encrypted range index
   │
   └─→ Sends encrypted query to MongoDB
   ↓
6. MongoDB executes query on encrypted data
   ↓
7. MongoDB returns encrypted results
   ↓
8. MongoDB Driver DECRYPTS results automatically
   ↓
9. Repository returns decrypted data
   ↓
10. Service processes and returns to handler
    ↓
11. Handler sends JSON response to client
```

## Key Management

### Master Key
- **Location**: `local_master_key.txt`
- **Purpose**: Encrypts data encryption keys (DEKs)
- **Generation**: Auto-generated if not present (96-byte base64)
- **Production**: Should use AWS KMS, Azure Key Vault, or GCP KMS

### Data Encryption Keys (DEKs)
- **Location**: MongoDB key vault collection
- **Purpose**: Encrypt actual field data
- **Creation**: Automatically created per encrypted field
- **Protection**: Encrypted by master key

### Encryption Hierarchy
```
Master Key (96 bytes)
    └─→ Encrypts DEK #1 (for "name" field)
    └─→ Encrypts DEK #2 (for "ssn" field)
    └─→ Encrypts DEK #3 (for "salary" field)
```

## Encrypted Field Configuration

### Equality Query Fields

**Name Field**:
```go
{
    "path": "name",
    "bsonType": "string",
    "queries": [{"queryType": "equality"}]
}
```
- **Use case**: Find employee by exact name
- **Query example**: `db.employees.find({name: "Alice Johnson"})`
- **Encryption**: Deterministic (same value = same ciphertext)

**SSN Field**:
```go
{
    "path": "ssn",
    "bsonType": "string",
    "queries": [{"queryType": "equality"}]
}
```
- **Use case**: Find employee by social security number
- **Query example**: `db.employees.find({ssn: "123-45-6789"})`
- **Encryption**: Deterministic

### Range Query Fields

**Salary Field**:
```go
{
    "path": "salary",
    "bsonType": "int",
    "queries": [{
        "queryType": "range",
        "min": 0,
        "max": 10000000,
        "sparsity": 1
    }]
}
```
- **Use case**: Find employees in salary range
- **Query example**: `db.employees.find({salary: {$gte: 100000, $lte: 200000}})`
- **Encryption**: Range-searchable with privacy guarantees

## API Endpoints

### Employee Management
- `POST /api/employees` - Create employee
- `GET /api/employees` - List all employees
- `GET /api/employees/:id` - Get employee by ID
- `PUT /api/employees/:id` - Update employee
- `DELETE /api/employees/:id` - Delete employee
- `GET /api/employees/stats` - Get statistics

### Encrypted Search (Demonstrates Queryable Encryption)
- `GET /api/employees/search/name/:name` - Search by name (equality)
- `GET /api/employees/search/ssn/:ssn` - Search by SSN (equality)
- `GET /api/employees/search/salary?min=X&max=Y` - Search by salary range

## Security Model

### What's Encrypted
- ✅ Name (equality queries enabled)
- ✅ SSN (equality queries enabled)
- ✅ Salary (range queries enabled)

### What's NOT Encrypted
- ❌ Email (for demo purposes - shows mixed encryption)
- ❌ Position
- ❌ Department
- ❌ Company
- ❌ Dates
- ❌ Metadata (IDs, timestamps)

### Threat Model

**Protected Against**:
- Database administrator seeing sensitive data
- Database backup exposure
- Network traffic sniffing (with TLS)
- Unauthorized MongoDB access

**NOT Protected Against**:
- Compromised master key
- Application-level vulnerabilities
- Authorized users with decrypt permissions
- Side-channel attacks

## Performance Considerations

### Encrypted Operations Cost

**Equality Queries**: ~2-3x overhead
- Acceptable for most use cases
- Similar to unencrypted indexed queries

**Range Queries**: ~10-20x overhead
- More expensive than equality
- Trade-off: Security vs. Performance
- Use selectively for sensitive numeric fields

**Insertions**: ~2x overhead
- Encryption + index generation
- Minimal impact for typical workloads

## Best Practices Implemented

1. **Clean Architecture**: Separation of concerns across layers
2. **Dependency Injection**: Services depend on interfaces
3. **Error Handling**: Proper error wrapping and logging
4. **Configuration**: Environment-based configuration
5. **Security**: Encrypted sensitive fields only
6. **Validation**: Input validation at multiple layers
7. **Logging**: Structured logging with sensitive data masking
8. **Resource Management**: Proper cursor and connection cleanup

## Future Enhancements

1. **Authentication**: Add user authentication
2. **Authorization**: Role-based access control
3. **Audit Logging**: Track all sensitive data access
4. **Key Rotation**: Implement DEK rotation
5. **Backup Strategy**: Encrypted backups
6. **Monitoring**: Add metrics and alerting
7. **Testing**: Comprehensive unit and integration tests
8. **Production KMS**: Integrate with cloud KMS providers
