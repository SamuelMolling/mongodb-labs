# Architecture Documentation

## Overview

This project demonstrates a well-structured Go application following industry best practices for educational purposes. It implements a complete CRUD system for task management using MongoDB.

## Architecture Pattern

The application follows a **Layered Architecture** (also known as N-tier architecture), which promotes:

- **Separation of Concerns**: Each layer has a specific responsibility
- **Maintainability**: Easy to understand and modify
- **Testability**: Each layer can be tested independently
- **Scalability**: Easy to add new features without affecting existing code

## Layer Structure

```
┌─────────────────────────────────────┐
│         HTTP Layer (Handler)        │  ← Handles HTTP requests/responses
├─────────────────────────────────────┤
│      Business Logic (Service)       │  ← Contains business rules
├─────────────────────────────────────┤
│    Data Access (Repository)         │  ← Manages database operations
├─────────────────────────────────────┤
│         Database (MongoDB)          │  ← Data persistence
└─────────────────────────────────────┘
```

### 1. Handler Layer (`internal/handler/`)

**Responsibility**: HTTP request handling and response formatting

**Key Features**:
- Request validation (JSON binding)
- HTTP status code management
- Error response formatting
- Query parameter parsing

**Example**:
```go
func (h *TaskHandler) CreateTask(c *gin.Context) {
    var req models.CreateTaskRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
        return
    }
    task, err := h.service.CreateTask(c.Request.Context(), &req)
    // ...
}
```

### 2. Service Layer (`internal/service/`)

**Responsibility**: Business logic and orchestration

**Key Features**:
- Complex validation rules
- Business logic implementation
- Coordination between multiple operations
- Data transformation

**Example**:
```go
func (s *taskService) CreateTask(ctx context.Context, req *models.CreateTaskRequest) (*models.Task, error) {
    task := req.ToTask()
    if err := task.Validate(); err != nil {
        return nil, err
    }
    if err := s.repo.Create(ctx, task); err != nil {
        return nil, errors.New("erro ao criar tarefa")
    }
    return task, nil
}
```

### 3. Repository Layer (`internal/repository/`)

**Responsibility**: Database access and queries

**Key Features**:
- CRUD operations
- Query building
- Data mapping (Go structs ↔ MongoDB documents)
- Database-specific error handling

**Example**:
```go
func (r *taskRepository) FindAll(ctx context.Context, filter *models.TaskFilter) ([]*models.Task, error) {
    bsonFilter := bson.M{}
    if filter != nil && filter.Completed != nil {
        bsonFilter["completed"] = *filter.Completed
    }
    cursor, err := r.collection.Find(ctx, bsonFilter)
    // ...
}
```

### 4. Models Layer (`internal/models/`)

**Responsibility**: Data structures and validation

**Key Features**:
- Entity definitions
- DTOs (Data Transfer Objects)
- Validation logic
- Data transformation methods

**Example**:
```go
type Task struct {
    ID          primitive.ObjectID `json:"id" bson:"_id,omitempty"`
    Name        string             `json:"name" bson:"name"`
    Description string             `json:"description" bson:"description"`
    Completed   bool               `json:"completed" bson:"completed"`
    Priority    string             `json:"priority" bson:"priority"`
    // ...
}
```

## Design Patterns Used

### 1. Repository Pattern

**Purpose**: Abstracts data access logic

**Benefits**:
- Separates business logic from data access
- Makes it easy to change database implementations
- Simplifies unit testing with mocks

**Implementation**:
```go
type TaskRepository interface {
    Create(ctx context.Context, task *models.Task) error
    FindAll(ctx context.Context, filter *models.TaskFilter) ([]*models.Task, error)
    // ...
}
```

### 2. Dependency Injection

**Purpose**: Provides dependencies from outside

**Benefits**:
- Loose coupling between components
- Easy to mock dependencies for testing
- Better testability

**Implementation**:
```go
type taskService struct {
    repo repository.TaskRepository  // Injected dependency
}

func NewTaskService(repo repository.TaskRepository) TaskService {
    return &taskService{repo: repo}
}
```

### 3. DTO Pattern

**Purpose**: Transfer data between layers

**Benefits**:
- Separates internal models from API contracts
- Allows different validation rules per operation
- Better API versioning support

**Implementation**:
```go
type CreateTaskRequest struct {
    Name        string     `json:"name" binding:"required,min=1,max=200"`
    Description string     `json:"description" binding:"max=1000"`
    Priority    string     `json:"priority" binding:"omitempty,oneof=low medium high"`
}
```

## Request Flow Example

Let's trace a request to create a new task:

```
1. HTTP POST /api/v1/tasks
   ↓
2. Handler (task_handler.go)
   - Validates JSON
   - Calls service layer
   ↓
3. Service (task_service.go)
   - Converts DTO to Model
   - Validates business rules
   - Calls repository
   ↓
4. Repository (task_repository.go)
   - Generates ID
   - Inserts into MongoDB
   ↓
5. MongoDB
   - Persists data
   ↓
6. Response flows back up
   - Repository returns task
   - Service returns task
   - Handler formats JSON response
```

## Configuration Management

**Location**: `internal/config/`

**Features**:
- Environment variable loading (.env)
- Type-safe configuration
- Default values
- Validation

**Usage**:
```go
cfg := config.Load()
mongoClient, err := connectMongoDB(cfg)
```

## Middleware

**Location**: `internal/middleware/`

**Implemented Middlewares**:

1. **CORS**: Handles cross-origin requests
2. **Logger**: Logs all HTTP requests
3. **Recovery**: Recovers from panics (Gin's default)

## Testing Strategy

### Unit Tests

**Models**: Test validation logic
```go
func TestTaskValidate(t *testing.T) {
    task := Task{Name: "", Priority: "medium"}
    err := task.Validate()
    // Assert error
}
```

**Services**: Test with mock repositories
```go
type mockTaskRepository struct { ... }

func TestCreateTask(t *testing.T) {
    mockRepo := &mockTaskRepository{}
    service := NewTaskService(mockRepo)
    // Test service logic
}
```

### Test Coverage

- Models: 90.6%
- Services: 73.9%

## API Design

### RESTful Principles

- **Resource-based URLs**: `/api/v1/tasks`
- **HTTP verbs**: GET, POST, PUT, PATCH, DELETE
- **Status codes**: 200, 201, 204, 400, 404, 500
- **JSON format**: Request and response bodies

### Versioning

API is versioned: `/api/v1/`

This allows future versions without breaking existing clients.

## Error Handling

### Layers

1. **Repository**: Database-specific errors
2. **Service**: Business logic errors
3. **Handler**: HTTP error responses

### Error Messages

- User-facing: Portuguese (in error messages)
- Developer-facing: English (in logs and comments)

## Security Considerations

✅ **Implemented**:
- Input validation
- CORS configuration
- Error message sanitization
- Request timeout

⚠️ **For Production** (not implemented):
- Authentication/Authorization
- Rate limiting
- HTTPS
- API keys
- Request signing

## Best Practices Applied

1. ✅ **Clean Code**
   - Meaningful names
   - Small functions
   - Single responsibility

2. ✅ **SOLID Principles**
   - Single Responsibility
   - Interface segregation
   - Dependency inversion

3. ✅ **Documentation**
   - Code comments
   - API documentation
   - Architecture docs

4. ✅ **Testing**
   - Unit tests
   - Mock implementations
   - Good coverage

5. ✅ **Configuration**
   - Environment variables
   - No hardcoded values
   - .env.example provided

## Scalability Considerations

### Horizontal Scaling

- **Stateless design**: Each request is independent
- **Database connection pooling**: MongoDB driver handles this
- **Load balancing ready**: No session state

### Vertical Scaling

- **Efficient queries**: Repository layer optimizes database calls
- **Context usage**: Proper timeout handling

## Future Enhancements

1. **Authentication & Authorization**
   - JWT tokens
   - User management
   - Role-based access control

2. **Caching**
   - Redis for frequently accessed data
   - Response caching

3. **Observability**
   - Structured logging
   - Metrics (Prometheus)
   - Distributed tracing

4. **Additional Features**
   - Task tags/categories
   - Task assignments
   - Due date reminders
   - File attachments

## Learning Path

For students learning from this project:

1. **Start with Models**: Understand data structures
2. **Repository Layer**: Learn database operations
3. **Service Layer**: Understand business logic
4. **Handler Layer**: Learn HTTP handling
5. **Middleware**: Cross-cutting concerns
6. **Testing**: Write and understand tests
7. **Configuration**: Environment management

## References

- [Clean Architecture by Uncle Bob](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Repository Pattern by Martin Fowler](https://martinfowler.com/eaaCatalog/repository.html)
- [Go Project Layout](https://github.com/golang-standards/project-layout)
- [Effective Go](https://go.dev/doc/effective_go)

---

**Author**: Samuel Molling
**Purpose**: Educational - Demonstrating Go best practices
**License**: Free for educational use
