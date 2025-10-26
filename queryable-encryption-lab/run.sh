#!/bin/bash

# MongoDB Queryable Encryption HR Platform
# Run script with CSE (Client-Side Encryption) support

echo "🔐 MongoDB Queryable Encryption HR Platform"
echo "==========================================="
echo ""
echo "Starting application with encryption support..."
echo ""

# Run with CSE tag enabled
go run -tags cse cmd/api/main.go
