# 🚀 Quick Start Guide

Get the MongoDB Queryable Encryption lab running in 5 minutes!

## Prerequisites

- Go 1.22+
- MongoDB Atlas account (free tier works!)
- **libmongocrypt** (required for encryption)
- 5-10 minutes of your time

### Install libmongocrypt

**macOS**:
```bash
brew install mongodb/brew/libmongocrypt
```

**Ubuntu/Debian**:
```bash
wget -qO - https://www.mongodb.org/static/pgp/libmongocrypt.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://libmongocrypt.s3.amazonaws.com/apt/ubuntu focal/libmongocrypt/1.8 universe" | sudo tee /etc/apt/sources.list.d/libmongocrypt.list
sudo apt-get update
sudo apt-get install -y libmongocrypt-dev
```

**Other platforms**: See [README.md](README.md#prerequisites) for more installation options.

## Step-by-Step

### 1. Copy Environment File
```bash
cp .env.example .env
```

### 2. Edit `.env` with Your MongoDB URI
```bash
# Open .env in your favorite editor
nano .env  # or vim, code, etc.
```

Update this line with your MongoDB Atlas connection string:
```env
MONGODB_URI=mongodb+srv://YOUR_USER:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/
```

**Get your URI from**:
1. Go to [MongoDB Atlas](https://cloud.mongodb.com)
2. Click "Connect" on your cluster
3. Choose "Connect your application"
4. Copy the connection string

### 3. Download Dependencies
```bash
go mod download
```

### 4. Run the Application
```bash
make run
```

Or if you don't have `make`:
```bash
./run.sh
```

Or directly:
```bash
go run -tags cse cmd/api/main.go
```

### 5. Open Your Browser
```
http://localhost:8080
```

## What You'll See

1. ✅ Application starts
2. ✅ Creates encrypted collections automatically
3. ✅ Seeds 100 sample employees (if enabled)
4. ✅ Web interface ready to use!

## First Steps in the UI

1. **View Employees Tab**: See the list of encrypted employees
2. **Add Employee Tab**: Add a new employee with encrypted SSN and salary
3. **Search Tab**: Try these searches:
   - Search by name: Try "Alice Johnson"
   - Search by salary range: Try $100,000 - $150,000
4. **About Tab**: Learn about Queryable Encryption

## Common Issues

### "client-side encryption not enabled"
❌ **Wrong**: `go run cmd/api/main.go`
✅ **Correct**: `go run -tags cse cmd/api/main.go`

**Solution**: Always use the `-tags cse` flag or use `make run`

### "Unable to connect to MongoDB"
- Check your MongoDB URI in `.env`
- Ensure your IP is whitelisted in MongoDB Atlas
- Verify your credentials

### Crypt Shared Library Error
The app needs the MongoDB crypt shared library. It's included for macOS ARM64.

For other platforms:
1. Download from [MongoDB Download Center](https://www.mongodb.com/try/download/enterprise)
2. Extract and update `CRYPT_SHARED_LIB_PATH` in `.env`

## What's Encrypted?

| Field  | Encrypted | Query Type     |
|--------|-----------|----------------|
| Name   | ✅ Yes    | Equality       |
| SSN    | ✅ Yes    | Equality       |
| Salary | ✅ Yes    | Range          |
| Email  | ❌ No     | N/A (for demo) |

## Try These Demos

### 1. Equality Query on Encrypted Field
```
Go to Search tab → Search by Name
Enter: "Alice Johnson"
```
This searches an encrypted field!

### 2. Range Query on Encrypted Field
```
Go to Search tab → Search by Salary
Min: 100000
Max: 150000
```
This performs a range search on encrypted data!

### 3. Add Employee with Encrypted Data
```
Go to Add Employee tab
Fill the form (notice SSN and Salary are marked as encrypted)
Submit
```
Data is encrypted before being sent to MongoDB!

## Next Steps

- Read [README.md](README.md) for detailed documentation
- Check [ARCHITECTURE.md](ARCHITECTURE.md) to understand how it works
- Experiment with the code
- Try modifying encrypted fields
- Add new search functionality

## Need Help?

- Check the [Troubleshooting](README.md#troubleshooting) section
- Review [MongoDB Queryable Encryption Docs](https://www.mongodb.com/docs/manual/core/queryable-encryption/)

---

**That's it!** You're now running a MongoDB Queryable Encryption demo. 🎉
