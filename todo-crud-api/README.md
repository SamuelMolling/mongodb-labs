# 📝 Todo List - Go + MongoDB Integration

A complete task management application demonstrating **MongoDB operations with Go**, following software architecture best practices.

## 🎯 Learning Objectives

This project is designed to teach MongoDB concepts through practical implementation:

### MongoDB Focus
- ✅ **Connection Management** - Setting up and managing MongoDB connections
- ✅ **CRUD Operations** - Create, Read, Update, Delete with MongoDB Go Driver
- ✅ **Query Patterns** - Filters, sorting, pagination, and aggregations
- ✅ **BSON Mapping** - Converting between Go structs and MongoDB documents
- ✅ **Error Handling** - Proper MongoDB error management
- ✅ **Repository Pattern** - Abstracting database operations
- ✅ **Indexing** - Performance optimization with automatic index management
- ✅ **Document Versioning** - Track changes with `_v` field

### Additional Concepts
- ✅ Layered architecture
- ✅ RESTful API design
- ✅ Unit testing with mocks
- ✅ Go development best practices

## 🏗️ Project Architecture

The project follows a layered architecture with clear separation of responsibilities:

```
todo-list-golang/
├── cmd/
│   └── api/
│       └── main.go              # Application entry point
├── internal/
│   ├── config/                  # Application configuration
│   │   └── config.go
│   ├── models/                  # Data models and validations
│   │   ├── task.go
│   │   └── task_test.go
│   ├── repository/              # Data access layer (MongoDB)
│   │   └── task_repository.go
│   ├── service/                 # Business logic
│   │   ├── task_service.go
│   │   └── task_service_test.go
│   ├── handler/                 # HTTP Handlers (Controllers)
│   │   └── task_handler.go
│   └── middleware/              # Middlewares (CORS, Logger, etc)
│       ├── cors.go
│       └── logger.go
├── web/                         # Frontend
│   ├── index.html
│   └── static/
│       ├── css/
│       │   └── style.css
│       └── js/
│           └── app.js
├── .env                         # Environment variables (do not commit)
├── .env.example                 # Configuration example
├── .gitignore
├── go.mod
├── go.sum
└── README.md
```

### 📦 Application Layers

#### 1. **Models** (`internal/models/`)
Defines data structures and validation rules.
- `Task`: Main task model
- `CreateTaskRequest`: DTO for creation
- `UpdateTaskRequest`: DTO for updates
- Business validations

#### 2. **Repository** (`internal/repository/`)
Responsible for database communication (MongoDB).
- `TaskRepository` interface
- CRUD operations: Create, Read, Update, Delete
- Filters and queries

#### 3. **Service** (`internal/service/`)
Contains the application's business logic.
- Complex validations
- Operation orchestration
- Business rules

#### 4. **Handler** (`internal/handler/`)
Manages HTTP requests and responses.
- Request parsing
- Input validation
- Response formatting

#### 5. **Middleware** (`internal/middleware/`)
Cross-cutting functionalities.
- CORS
- Logging
- Authentication (future)

## 🚀 Technologies Used

### Backend
- **Go 1.22+** - Programming language
- **Gin** - Web framework
- **MongoDB Driver** - Official MongoDB driver for Go
- **godotenv** - Environment variable management

### Frontend
- **Vue.js 2** - JavaScript framework
- **CSS3** - Modern styling
- **Fetch API** - HTTP requests

## 📋 Prerequisites

- Go 1.22 or higher
- MongoDB Atlas (or local MongoDB)
- Git

## ⚙️ Setup

### 1. Clone the repository

```bash
git clone https://github.com/SamuelMolling/todo-list-golang.git
cd todo-list-golang
```

### 2. Configure MongoDB

#### Option A: MongoDB Atlas (Recommended for learning)

1. Create a free account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a new cluster
3. Configure network access (add your IP or 0.0.0.0/0 for development)
4. Create a database user
5. Copy the connection string

#### Option B: Local MongoDB

```bash
# macOS (with Homebrew)
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community

# Linux
sudo apt-get install mongodb
sudo systemctl start mongodb

# Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

### 3. Configure environment variables

Copy the `.env.example` file to `.env`:

```bash
cp .env.example .env
```

Edit the `.env` file with your settings:

```env
# Server Configuration
PORT=8080
GIN_MODE=debug

# MongoDB Configuration
MONGODB_URI=mongodb+srv://your-user:your-password@your-cluster.mongodb.net/?retryWrites=true&w=majority&appName=TodoApp
MONGODB_DATABASE=todoapp
MONGODB_COLLECTION=tasks

# Connection timeout (in seconds)
MONGODB_TIMEOUT=10

# CORS - Allowed origins (comma separated)
CORS_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
```

### 4. Install dependencies

```bash
go mod download
```

## 🏃 How to Run

### Development

```bash
# Run from root directory
go run cmd/api/main.go
```

The application will be available at `http://localhost:8080`

### Build

```bash
# Generate binary
go build -o bin/todoapp cmd/api/main.go

# Run the binary
./bin/todoapp
```

## 🧪 Tests

Run unit tests:

```bash
# All tests
go test ./...

# With coverage
go test -cover ./...

# With details
go test -v ./...

# Detailed coverage
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

## 📡 API Endpoints

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/tasks` | Create a new task |
| GET | `/api/v1/tasks` | List all tasks |
| GET | `/api/v1/tasks/:id` | Get a task by ID |
| PUT | `/api/v1/tasks/:id` | Update a task |
| PATCH | `/api/v1/tasks/:id/toggle` | Toggle task completion |
| DELETE | `/api/v1/tasks/:id` | Delete a task |
| GET | `/api/v1/tasks/stats` | Get statistics |

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Check if API is online |

## 📝 Usage Examples

### Create a task

```bash
curl -X POST http://localhost:8080/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Study Go",
    "description": "Learn about interfaces and goroutines",
    "priority": "high",
    "dueDate": "2024-12-31T23:59:59Z"
  }'
```

### List tasks

```bash
# All tasks
curl http://localhost:8080/api/v1/tasks

# Filter by status
curl http://localhost:8080/api/v1/tasks?completed=false

# Filter by priority
curl http://localhost:8080/api/v1/tasks?priority=high
```

### Update a task

```bash
curl -X PUT http://localhost:8080/api/v1/tasks/507f1f77bcf86cd799439011 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Study Go - Completed",
    "completed": true
  }'
```

### Delete a task

```bash
curl -X DELETE http://localhost:8080/api/v1/tasks/507f1f77bcf86cd799439011
```

## 🗄️ MongoDB Operations Explained

### Database Structure

```
Database: todoapp
└── Collection: tasks
    └── Documents: {
          _id: ObjectId,
          name: String,
          description: String,
          completed: Boolean,
          priority: String (enum: low, medium, high),
          dueDate: Date,
          createdAt: Date,
          updatedAt: Date
        }
```

### How Operations Work

#### Create (POST /api/v1/tasks)
```go
// MongoDB: InsertOne
collection.InsertOne(ctx, task)

// Equivalent MongoDB Shell:
db.tasks.insertOne({
  name: "Study Go",
  description: "Learn interfaces",
  completed: false,
  priority: "high",
  createdAt: new Date(),
  updatedAt: new Date()
})
```

#### Read (GET /api/v1/tasks)
```go
// MongoDB: Find with filter
filter := bson.M{"completed": false}
collection.Find(ctx, filter)

// Equivalent MongoDB Shell:
db.tasks.find({ completed: false })
  .sort({ createdAt: -1 })
```

#### Update (PUT /api/v1/tasks/:id)
```go
// MongoDB: UpdateOne with $set
update := bson.M{"$set": bson.M{"name": "New Name"}}
collection.UpdateOne(ctx, bson.M{"_id": id}, update)

// Equivalent MongoDB Shell:
db.tasks.updateOne(
  { _id: ObjectId("...") },
  { $set: { name: "New Name", updatedAt: new Date() } }
)
```

#### Delete (DELETE /api/v1/tasks/:id)
```go
// MongoDB: DeleteOne
collection.DeleteOne(ctx, bson.M{"_id": id})

// Equivalent MongoDB Shell:
db.tasks.deleteOne({ _id: ObjectId("...") })
```

### Query Examples

**Filter by status:**
```bash
curl "http://localhost:8080/api/v1/tasks?completed=false"
# MongoDB: db.tasks.find({ completed: false })
```

**Filter by priority:**
```bash
curl "http://localhost:8080/api/v1/tasks?priority=high"
# MongoDB: db.tasks.find({ priority: "high" })
```

**Get statistics:**
```bash
curl "http://localhost:8080/api/v1/tasks/stats"
# MongoDB: Uses CountDocuments with different filters
```

### Repository Pattern Implementation

The repository layer (`internal/repository/`) abstracts MongoDB operations:

```go
type TaskRepository interface {
    Create(ctx context.Context, task *models.Task) error
    FindAll(ctx context.Context, filter *models.TaskFilter) ([]*models.Task, error)
    FindByID(ctx context.Context, id primitive.ObjectID) (*models.Task, error)
    Update(ctx context.Context, id primitive.ObjectID, task *models.Task) error
    Delete(ctx context.Context, id primitive.ObjectID) error
    Count(ctx context.Context, filter *models.TaskFilter) (int64, error)
}
```

**Benefits:**
- Easy to test (can mock the interface)
- Separates MongoDB code from business logic
- Can switch databases by implementing the same interface

### Automatic Index Management

The application automatically creates and manages 6 indexes on startup:

| Index | Field(s) | Purpose | Query Example |
|-------|----------|---------|---------------|
| `idx_completed` | completed | Filter by status | `?completed=false` |
| `idx_priority` | priority | Filter by priority | `?priority=high` |
| `idx_completed_priority` | completed + priority | Combined filters | `?completed=false&priority=high` |
| `idx_created_at` | createdAt (desc) | Sort by date | Default sorting |
| `idx_due_date` | dueDate (sparse) | Due date queries | Find overdue tasks |
| `idx_version` | _v | Version tracking | Optimistic locking |

**IndexManager** (`internal/repository/indexes.go`) provides:
```go
indexManager.EnsureIndexes(ctx)   // Create if not exists (idempotent)
indexManager.CreateIndexes(ctx)   // Force create all indexes
indexManager.DropIndexes(ctx)     // Remove custom indexes
indexManager.RebuildIndexes(ctx)  // Drop and recreate
indexManager.ListIndexes(ctx)     // Get all indexes
indexManager.GetIndexStats(ctx)   // Usage statistics
```

Indexes are created automatically when the application starts, improving query performance significantly.

### Document Versioning

Every document includes a `_v` field that tracks the version number:

```json
{
  "_id": ObjectId("..."),
  "name": "Study MongoDB",
  "completed": false,
  "_v": 1,  // Version starts at 1
  "createdAt": ISODate("..."),
  "updatedAt": ISODate("...")
}
```

**Version Tracking:**
- Created documents start at version 1
- Each update increments the version
- Enables optimistic locking (prevent concurrent update conflicts)
- Provides audit trail of changes

**Example Evolution:**
```
Version 1: Created task
Version 2: Marked as completed
Version 3: Updated name
Version 4: Changed priority
```

**Optimistic Locking Pattern:**
```go
// Update only if version matches (prevents lost updates)
result := collection.UpdateOne(
    ctx,
    bson.M{"_id": id, "_v": expectedVersion},
    update,
)
if result.MatchedCount == 0 {
    return errors.New("document was modified by another process")
}
```

## 🎨 Frontend

The frontend is a Single Page Application (SPA) developed with Vue.js 2, offering:

- ✅ Modern and responsive interface
- ✅ Complete CRUD for tasks
- ✅ Filters by status and priority
- ✅ Edit modal
- ✅ Real-time statistics
- ✅ Client-side validations
- ✅ Visual feedback

Access at: `http://localhost:8080`

## 🎓 Demonstrated Concepts

### 1. MongoDB Operations (Primary Focus)

**Connection Management:**
- Establishing connection with timeout
- Connection pooling
- Ping verification
- Graceful disconnection

**CRUD Operations:**
- `InsertOne()` - Creating documents
- `Find()` - Querying with filters
- `FindOne()` - Finding by ID
- `UpdateOne()` - Updating documents with `$set`
- `DeleteOne()` - Removing documents
- `CountDocuments()` - Aggregating data

**BSON Handling:**
- Struct to BSON mapping with tags
- `bson.M` for unordered documents (filters)
- `bson.D` for ordered documents (sorting)
- `primitive.ObjectID` for MongoDB IDs

**Query Patterns:**
- Filtering by single field
- Multiple conditions (AND logic)
- Sorting results
- Handling `ErrNoDocuments`
- Building dynamic filters

**Best Practices:**
- Always using context
- Checking `MatchedCount` and `DeletedCount`
- Proper error handling
- Timestamp management

**Advanced Topics:**
- ✅ Automatic index management (see below)
- ✅ Document versioning with `_v` field
- ✅ Optimistic locking pattern
- ✅ Sparse indexes for optional fields
- ✅ Compound indexes for complex queries

### 2. Repository Pattern
- Abstracts MongoDB operations
- Interface-based design for testability
- Separates database logic from business logic
- Enables easy mocking in tests

### 3. Layered Architecture
- Clear separation of responsibilities (Handler → Service → Repository → MongoDB)
- Low coupling between layers
- High cohesion within layers
- Easy maintenance and testing

### 4. Dependency Injection
- Repository injected into Service
- Service injected into Handler
- Facilitates testing with mocks
- Greater flexibility

### 5. RESTful API
- Semantic endpoints
- Correct HTTP verbs
- Appropriate status codes
- Consistent error responses

### 6. Unit Testing with Mocks
- Mock MongoDB repository for service tests
- 73-90% code coverage
- Testing success and error cases
- No need for actual database in tests

## 🔐 Security

- ✅ Input data validation
- ✅ Configurable CORS
- ✅ String sanitization
- ✅ Error handling
- ⚠️ For production, add: authentication, rate limiting, HTTPS

## 📚 Learning Resources

### MongoDB (Primary)
- 🎓 [MongoDB University](https://university.mongodb.com/) - Free official courses
- 📚 [MongoDB Go Driver Documentation](https://www.mongodb.com/docs/drivers/go/current/)
- 📘 [MongoDB Manual](https://www.mongodb.com/docs/manual/) - Official MongoDB docs
- 🔍 [MongoDB Query Language](https://www.mongodb.com/docs/manual/tutorial/query-documents/)
- 🎯 [BSON Specification](https://bsonspec.org/)
- 📖 [Indexing Best Practices](https://www.mongodb.com/docs/manual/indexes/)

**Recommended Learning Path:**
1. Start with [MongoDB Basics Course](https://university.mongodb.com/courses/M001/about) (Free)
2. Then [MongoDB for Developers](https://university.mongodb.com/courses/M220JS/about) (Free)
3. Explore this project's code in `internal/repository/`
4. Study the IndexManager in `internal/repository/indexes.go`
5. Understand document versioning in `internal/models/task.go`

### Go
- [Tour of Go](https://go.dev/tour/)
- [Effective Go](https://go.dev/doc/effective_go)
- [Go by Example](https://gobyexample.com/)
- [Go Database/SQL Tutorial](http://go-database-sql.org/)

### Architecture
- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html)

### Tools
- [MongoDB Compass](https://www.mongodb.com/products/compass) - GUI for MongoDB
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) - Cloud MongoDB (Free tier)
- [Postman](https://www.postman.com/) - API testing

## 🤝 Contributing

Contributions are welcome! Feel free to:
1. Fork the project
2. Create a branch for your feature (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is free for educational use.

## 👨‍💻 Author

**Samuel Molling**

- GitHub: [@SamuelMolling](https://github.com/SamuelMolling)

## 🙏 Acknowledgments

This project was developed for educational purposes to demonstrate **MongoDB integration with Go** and software architecture best practices.

---

## 📌 Project Focus

This project emphasizes **MongoDB operations and patterns**:

✅ **What you'll learn:**
- How to connect to MongoDB from Go
- CRUD operations with the MongoDB Go Driver
- Query building and filtering
- BSON document handling
- Repository pattern for database abstraction
- Error handling in database operations
- Testing database code with mocks

📖 **Key Files to Study:**
1. `internal/repository/task_repository.go` - MongoDB CRUD operations
2. `internal/repository/indexes.go` - Automatic index management
3. `internal/models/task.go` - BSON mapping and versioning
4. `cmd/api/main.go` - Connection setup and index initialization

**Note**: This is an educational project focused on MongoDB. For production use, consider adding features such as authentication, authorization, rate limiting, monitoring, indexes, and other security and observability practices.
