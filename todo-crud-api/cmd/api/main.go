package main

import (
	"context"
	"log"
	"time"

	"todo-list-golang/internal/config"
	"todo-list-golang/internal/handler"
	"todo-list-golang/internal/middleware"
	"todo-list-golang/internal/repository"
	"todo-list-golang/internal/service"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func main() {
	// Load the configurations
	cfg := config.Load()

	// Configure Gin mode
	gin.SetMode(cfg.Server.GinMode)

	// Connect to MongoDB
	mongoClient, err := connectMongoDB(cfg)
	if err != nil {
		log.Fatalf("Error connecting to MongoDB: %v", err)
	}
	defer disconnectMongoDB(mongoClient)

	// Initialize application layers
	db := mongoClient.Database(cfg.MongoDB.Database)
	collection := db.Collection(cfg.MongoDB.Collection)

	// Initialize index manager and ensure indexes exist
	indexManager := repository.NewIndexManager(collection)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := indexManager.EnsureIndexes(ctx); err != nil {
		log.Printf("Warning: Error ensuring indexes: %v", err)
		// Continue anyway - indexes are not critical for basic functionality
	}

	// Initialize repository, service, and handler
	taskRepo := repository.NewTaskRepository(db, cfg.MongoDB.Collection)
	taskService := service.NewTaskService(taskRepo)
	taskHandler := handler.NewTaskHandler(taskService)

	// Configure the router
	router := setupRouter(cfg, taskHandler)

	// Start the server
	log.Printf("Server starting on port %s...", cfg.Server.Port)
	if err := router.Run(":" + cfg.Server.Port); err != nil {
		log.Fatalf("Error starting server: %v", err)
	}
}

// connectMongoDB establishes a connection to MongoDB
func connectMongoDB(cfg *config.Config) (*mongo.Client, error) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.MongoDB.Timeout)*time.Second)
	defer cancel()

	// Client options
	clientOptions := options.Client().ApplyURI(cfg.MongoDB.URI)

	// Connect to MongoDB
	client, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		return nil, err
	}

	// Verify the connection
	if err := client.Ping(ctx, nil); err != nil {
		return nil, err
	}

	log.Println("Successfully connected to MongoDB!")
	return client, nil
}

// disconnectMongoDB closes the connection to MongoDB
func disconnectMongoDB(client *mongo.Client) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := client.Disconnect(ctx); err != nil {
		log.Printf("Error disconnecting from MongoDB: %v", err)
	} else {
		log.Println("Disconnected from MongoDB")
	}
}

// setupRouter configures routes and middlewares
func setupRouter(cfg *config.Config, taskHandler *handler.TaskHandler) *gin.Engine {
	router := gin.New()

	// Global middlewares
	router.Use(gin.Recovery())                              // Recovery middleware
	router.Use(middleware.Logger())                         // Custom logger
	router.Use(middleware.CORSMiddleware(cfg.CORS.AllowedOrigins)) // CORS

	// Serve static files (frontend)
	router.Static("/static", "./web/static")
	router.StaticFile("/", "./web/index.html")

	// API route group
	api := router.Group("/api/v1")
	{
		// Task routes
		tasks := api.Group("/tasks")
		{
			tasks.POST("", taskHandler.CreateTask)              // POST /api/v1/tasks
			tasks.GET("", taskHandler.GetAllTasks)              // GET /api/v1/tasks
			tasks.GET("/stats", taskHandler.GetTaskStats)       // GET /api/v1/tasks/stats
			tasks.GET("/:id", taskHandler.GetTaskByID)          // GET /api/v1/tasks/:id
			tasks.PUT("/:id", taskHandler.UpdateTask)           // PUT /api/v1/tasks/:id
			tasks.PATCH("/:id/toggle", taskHandler.ToggleTaskCompletion) // PATCH /api/v1/tasks/:id/toggle
			tasks.DELETE("/:id", taskHandler.DeleteTask)        // DELETE /api/v1/tasks/:id
		}
	}

	// Health check route
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "ok",
			"time":   time.Now().Format(time.RFC3339),
		})
	})

	return router
}
