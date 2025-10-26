# 🔐 MongoDB Queryable Encryption Lab - HR Platform

An educational demonstration of **MongoDB Queryable Encryption** using a realistic HR management system. This lab shows how to implement client-side field level encryption while maintaining the ability to query encrypted data.

## 📚 What You'll Learn

- **Queryable Encryption Basics**: Understand how MongoDB's Queryable Encryption works
- **Equality Queries**: Search for exact matches on encrypted fields (name, SSN)
- **Range Queries**: Perform range searches on encrypted numeric fields (salary)
- **Client-Side Encryption**: See how data is encrypted before reaching the database
- **Key Management**: Learn about master keys, data encryption keys, and key vaults
- **Security Best Practices**: Understand the security model and limitations

## 🏗️ Architecture

```
┌─────────────┐
│   Browser   │
│  (Frontend) │
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────────────────┐
│    Go Application       │
│  ┌──────────────────┐   │
│  │  MongoDB Driver  │   │
│  │  + Auto-Encrypt  │   │
│  └────────┬─────────┘   │
└───────────┼─────────────┘
            │
            ▼
   ┌────────────────┐
   │   MongoDB      │
   │                │
   │ ┌────────────┐ │
   │ │ Encrypted  │ │
   │ │ Collection │ │
   │ └────────────┘ │
   │                │
   │ ┌────────────┐ │
   │ │ Key Vault  │ │
   │ └────────────┘ │
   └────────────────┘
```

## 🔑 Encrypted Fields

| Field  | Encryption Type | Query Type  | Description                     |
|--------|-----------------|-------------|---------------------------------|
| Name   | Deterministic   | Equality    | Search by exact name            |
| SSN    | Deterministic   | Equality    | Search by social security number|
| Salary | Range           | Range       | Search within salary ranges     |

## 🚀 Quick Start

### Prerequisites

1. **MongoDB Atlas** (or Enterprise Server 6.0+)
   - Create a free cluster at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
   - Or use MongoDB Enterprise Edition locally

2. **Go 1.22+**
   ```bash
   go version
   ```

3. **libmongocrypt** (Required for client-side encryption)

   **macOS (using Homebrew)**:
   ```bash
   brew install mongodb/brew/libmongocrypt
   ```

   **Ubuntu/Debian**:
   ```bash
   # Import MongoDB public key
   wget -qO - https://www.mongodb.org/static/pgp/libmongocrypt.asc | sudo apt-key add -

   # Add repository
   echo "deb [ arch=amd64,arm64 ] https://libmongocrypt.s3.amazonaws.com/apt/ubuntu focal/libmongocrypt/1.8 universe" | sudo tee /etc/apt/sources.list.d/libmongocrypt.list

   # Install
   sudo apt-get update
   sudo apt-get install -y libmongocrypt-dev
   ```

   **RHEL/CentOS/Fedora**:
   ```bash
   # Create repo file
   cat <<EOF | sudo tee /etc/yum.repos.d/libmongocrypt.repo
   [libmongocrypt]
   name=libmongocrypt repository
   baseurl=https://libmongocrypt.s3.amazonaws.com/yum/redhat/8/libmongocrypt/1.8/x86_64
   gpgcheck=1
   enabled=1
   gpgkey=https://www.mongodb.org/static/pgp/libmongocrypt.asc
   EOF

   # Install
   sudo yum install -y libmongocrypt
   ```

   **From Source** (if package not available):
   ```bash
   git clone https://github.com/mongodb/libmongocrypt.git
   cd libmongocrypt
   cmake . -DCMAKE_BUILD_TYPE=Release
   make
   sudo make install
   ```

4. **Crypt Shared Library**
   - Download from [MongoDB Download Center](https://www.mongodb.com/try/download/enterprise)
   - Or use the one included in this repository (macOS ARM64)

### Installation

1. **Clone and Navigate**
   ```bash
   git clone <repository>
   cd queryable-encryption-lab
   ```

2. **Download Dependencies**
   ```bash
   go mod download
   ```

3. **Download Crypt Shared Library** (if not already present)
   ```bash
   # macOS ARM64
   curl -O https://downloads.mongodb.com/osx/mongo_crypt_shared_v1-macos-arm64-enterprise-8.0.3.tgz
   tar -xzf mongo_crypt_shared_v1-macos-arm64-enterprise-8.0.3.tgz

   # macOS Intel
   curl -O https://downloads.mongodb.com/osx/mongo_crypt_shared_v1-macos-x86_64-enterprise-8.0.3.tgz
   tar -xzf mongo_crypt_shared_v1-macos-x86_64-enterprise-8.0.3.tgz

   # Linux
   curl -O https://downloads.mongodb.com/linux/mongo_crypt_shared_v1-linux-x86_64-enterprise-8.0.3.tgz
   tar -xzf mongo_crypt_shared_v1-linux-x86_64-enterprise-8.0.3.tgz
   ```

4. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your MongoDB URI and correct library path
   ```

5. **Run the Application**
   ```bash
   make run
   # or directly with Go (must include -tags cse for encryption support)
   go run -tags cse cmd/api/main.go
   ```

   ⚠️ **Important**: The `-tags cse` flag is **required** to enable client-side encryption support in the MongoDB driver.

6. **Open Browser**
   ```
   http://localhost:8080
   ```

## ⚠️ Important: CSE Build Tag

MongoDB's client-side encryption requires the `cse` build tag to be enabled when compiling. This is **mandatory** for queryable encryption to work.

**Always use one of these methods:**

✅ **Recommended (using Makefile)**:
```bash
make run
```

✅ **Direct Go run**:
```bash
go run -tags cse cmd/api/main.go
```

✅ **Using the run script**:
```bash
./run.sh
```

❌ **This will NOT work**:
```bash
go run cmd/api/main.go  # Missing -tags cse flag!
```

## 📝 Configuration

Edit `.env` file:

```env
# MongoDB Connection
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/

# Encryption Configuration
KEY_VAULT_DATABASE=encryption
KEY_VAULT_COLLECTION=__keyVault
LOCAL_MASTER_KEY_PATH=./local_master_key.txt

# Crypt Shared Library (adjust for your OS)
CRYPT_SHARED_LIB_PATH=./mongo_crypt_shared_v1-macos-arm64-enterprise-8.0.3/lib/mongo_crypt_v1.dylib

# Server
SERVER_PORT=8080
GIN_MODE=debug
```

## 🎯 Features & Demo

### 1. Add Employees
- Add new employees with encrypted SSN and salary
- All encryption happens client-side before data reaches MongoDB

### 2. View Employees
- Browse all employees
- Filter by department
- Encrypted fields are automatically decrypted

### 3. Search on Encrypted Fields

#### Equality Queries
```
Search by Name: "Alice Johnson"
→ Performs encrypted equality query
→ Returns exact matches

Search by SSN: "123-45-6789"
→ Performs encrypted equality query on sensitive data
→ Demonstrates secure sensitive data search
```

#### Range Queries
```
Search Salary: Min $100,000 - Max $200,000
→ Performs encrypted range query
→ Returns all employees in that salary range
```

## 🔧 Development

### Project Structure

```
queryable-encryption-lab/
├── cmd/
│   └── api/
│       └── main.go              # Application entry point
├── internal/
│   ├── config/                  # Configuration management
│   ├── encryption/              # Encryption setup & key management
│   ├── models/                  # Data models
│   ├── repository/              # Database access layer
│   ├── service/                 # Business logic
│   ├── handler/                 # HTTP handlers
│   └── middleware/              # HTTP middleware
├── web/
│   ├── static/
│   │   ├── css/                 # Stylesheets
│   │   └── js/                  # JavaScript
│   └── templates/               # HTML templates
├── .env.example                 # Environment template
├── go.mod                       # Go dependencies
├── Makefile                     # Build commands
└── README.md                    # This file
```

### Available Commands

```bash
make build          # Build the application
make run            # Run the application
make test           # Run tests
make lint           # Run linter
make clean          # Clean build artifacts
make help           # Show all commands
```

## 🔐 Security Considerations

### ✅ What Queryable Encryption Provides

- **Client-side encryption**: Data encrypted before leaving your application
- **Zero-knowledge**: Database server never sees unencrypted data
- **Queryable**: Search on encrypted fields without decryption
- **Compliance**: Meets regulatory requirements for data protection

### ⚠️ Important Limitations

1. **Not a substitute for database access controls**
   - Still need proper authentication and authorization
   - Use MongoDB RBAC

2. **Master key is critical**
   - If lost, data cannot be decrypted
   - In production, use AWS KMS, Azure Key Vault, or GCP KMS

3. **Performance considerations**
   - Encryption adds overhead
   - Range queries have higher overhead than equality

4. **This is a demo**
   - Uses local master key (not secure for production)
   - Drops and recreates collections on startup
   - No authentication or authorization

## 🔧 Troubleshooting

### Error: "Package 'libmongocrypt' not found"

**Problem**: The `libmongocrypt` library is not installed on your system.

**Solution**: Install libmongocrypt using the appropriate method for your OS (see [Prerequisites](#prerequisites) section above).

After installation, you may need to:
1. Restart your terminal
2. Update `PKG_CONFIG_PATH` if needed:
   ```bash
   export PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:$PKG_CONFIG_PATH"
   ```

### Error: "client-side encryption not enabled"

**Problem**: You're running the application without the `cse` build tag.

**Solution**: Always use the `-tags cse` flag:
```bash
# Use Makefile (recommended)
make run

# Or use the run script
./run.sh

# Or add the flag manually
go run -tags cse cmd/api/main.go
```

### Error: "Unable to connect to MongoDB"

**Problem**: MongoDB URI is incorrect or MongoDB is not accessible.

**Solution**:
1. Check your `.env` file has the correct `MONGODB_URI`
2. Ensure your MongoDB Atlas cluster allows connections from your IP
3. Verify your credentials are correct

### Error: "cryptSharedLibPath not found"

**Problem**: The crypt shared library path is incorrect or file doesn't exist.

**Solution**:
1. Download the correct library for your OS from MongoDB Download Center
2. Update `CRYPT_SHARED_LIB_PATH` in `.env` to point to the `.dylib` (macOS) or `.so` (Linux) file
3. Ensure the path is absolute or relative to where you run the application

### Performance is slow

**Problem**: Encryption operations add overhead.

**Expected**:
- Equality queries: ~2-3x slower than unencrypted
- Range queries: ~10-20x slower than unencrypted
- This is normal for encrypted operations

**Tips**:
- Use indexes on encrypted fields
- Limit range query usage to necessary fields only
- Consider caching frequently accessed data

## 🚀 Production Checklist

Before deploying to production:

- [ ] Use a proper KMS (AWS KMS, Azure Key Vault, GCP KMS)
- [ ] Never commit master keys to version control
- [ ] Implement proper backup strategy for keys
- [ ] Enable MongoDB authentication and authorization
- [ ] Use TLS/SSL for all connections
- [ ] Implement rate limiting
- [ ] Add comprehensive logging and monitoring
- [ ] Review and test disaster recovery procedures
- [ ] Conduct security audit
- [ ] Document key rotation procedures

## 📚 Learn More

- [MongoDB Queryable Encryption Documentation](https://www.mongodb.com/docs/manual/core/queryable-encryption/)
- [Client-Side Field Level Encryption](https://www.mongodb.com/docs/manual/core/csfle/)
- [MongoDB Security Best Practices](https://www.mongodb.com/docs/manual/administration/security-checklist/)

## 🤝 Contributing

This is an educational lab. Feel free to:
- Report issues
- Suggest improvements
- Add more examples
- Improve documentation

## 📄 License

This project is provided for educational purposes.

## 🙏 Acknowledgments

- MongoDB Team for Queryable Encryption
- Go MongoDB Driver Team
- Gin Web Framework

---

**⚠️ Reminder**: This is a demonstration application for learning purposes. Do not use in production without proper security hardening and key management.
