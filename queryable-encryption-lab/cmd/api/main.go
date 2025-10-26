// Package main is the entry point for the Queryable Encryption HR Platform.
// This application demonstrates MongoDB Queryable Encryption with a practical HR use case.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"queryable-encryption-lab/internal/config"
	"queryable-encryption-lab/internal/encryption"
	"queryable-encryption-lab/internal/handler"
	"queryable-encryption-lab/internal/middleware"
	"queryable-encryption-lab/internal/repository"
	"queryable-encryption-lab/internal/service"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func main() {
	// Load configuration
	cfg := config.Load()
	gin.SetMode(cfg.Server.GinMode)

	log.Println("===========================================")
	log.Println("Queryable Encryption HR Platform")
	log.Println("===========================================")

	// Initialize encryption manager
	encryptionMgr := encryption.NewEncryptionManager(
		cfg.KeyVaultNamespace(),
		cfg.Encryption.LocalMasterKeyPath,
		cfg.Encryption.CryptSharedLibPath,
	)

	// Connect to MongoDB with auto-encryption
	mongoClient, err := connectMongoDB(cfg, encryptionMgr)
	if err != nil {
		log.Fatalf("Error connecting to MongoDB: %v", err)
	}
	defer disconnectMongoDB(mongoClient)

	log.Println("Connected to MongoDB successfully")

	// Get database and setup encryption
	db := mongoClient.Database(cfg.MongoDB.Database)
	keyVaultDB := mongoClient.Database(cfg.Encryption.KeyVaultDatabase)

	// Setup encrypted collection (drops existing for demo purposes)
	setupCtx, setupCancel := context.WithTimeout(context.Background(), 60*time.Second)
	if err := setupEncryptedCollection(setupCtx, mongoClient, encryptionMgr, db, keyVaultDB, cfg); err != nil {
		setupCancel()
		log.Fatalf("Error setting up encrypted collection: %v", err)
	}
	setupCancel()

	// Verify connection is still alive after setup
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := mongoClient.Ping(pingCtx, nil); err != nil {
		pingCancel()
		log.Fatalf("MongoDB connection lost after setup: %v", err)
	}
	pingCancel()
	log.Println("MongoDB connection verified after encrypted collection setup")

	// Initialize layers
	employeeRepo := repository.NewEmployeeRepository(db, cfg.MongoDB.Collection)
	employeeService := service.NewEmployeeService(employeeRepo)
	employeeHandler := handler.NewEmployeeHandler(employeeService)

	// Seed database with sample data (optional - controlled by env var)
	if err := seedDatabaseIfRequested(context.Background(), employeeRepo, cfg); err != nil {
		log.Printf("Warning: Error seeding database: %v", err)
	}

	// Setup router
	router := setupRouter(cfg, employeeHandler)

	// Start server
	log.Printf("Server starting on http://localhost:%s", cfg.Server.Port)
	log.Println("===========================================")
	if err := router.Run(":" + cfg.Server.Port); err != nil {
		disconnectMongoDB(mongoClient)
		log.Fatalf("Error starting server: %v", err) //nolint:gocritic
	}
}

// connectMongoDB establishes connection to MongoDB with encryption options
func connectMongoDB(cfg *config.Config, encryptionMgr *encryption.EncryptionManager) (*mongo.Client, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clientOptions := options.Client().
		ApplyURI(cfg.MongoDB.URI).
		SetAutoEncryptionOptions(encryptionMgr.GetAutoEncryptionOptions())

	client, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to MongoDB: %w", err)
	}

	// Ping to verify connection
	if err := client.Ping(ctx, nil); err != nil {
		return nil, fmt.Errorf("unable to ping MongoDB: %w", err)
	}

	return client, nil
}

// seedDatabaseIfRequested seeds the database with sample data if configured
func seedDatabaseIfRequested(ctx context.Context, repo repository.EmployeeRepository, cfg *config.Config) error {
	if !cfg.SeedDatabase {
		return nil
	}

	// Check if database is empty first
	count, err := repo.Count(ctx)
	if err != nil {
		return fmt.Errorf("error checking employee count: %w", err)
	}

	if count > 0 {
		log.Printf("Database already has %d employees, skipping seed", count)
		return nil
	}

	log.Println("Seeding database with sample employees...")
	seedCount := cfg.SeedCount
	if seedCount == 0 {
		seedCount = 100 // Default
	}

	if err := repo.SeedEmployees(ctx, seedCount); err != nil {
		return fmt.Errorf("error seeding employees: %w", err)
	}

	log.Println("Database seeding complete!")
	return nil
}

// setupEncryptedCollection creates the encrypted collection
func setupEncryptedCollection(
	ctx context.Context,
	client *mongo.Client,
	encryptionMgr *encryption.EncryptionManager,
	db *mongo.Database,
	keyVaultDB *mongo.Database,
	cfg *config.Config,
) error {
	log.Println("Setting up encrypted collection...")

	// Only drop collections if explicitly requested
	if cfg.DropCollections {
		log.Println("DROP_COLLECTIONS=true, dropping existing collections...")

		if err := encryption.DropCollectionIfExists(ctx, keyVaultDB, cfg.Encryption.KeyVaultCollection); err != nil {
			log.Printf("Warning: error dropping key vault collection: %v", err)
		}

		if err := encryption.DropCollectionIfExists(ctx, db, cfg.MongoDB.Collection); err != nil {
			log.Printf("Warning: error dropping employees collection: %v", err)
		}
	}

	// Check if encrypted collection already exists
	collections, err := db.ListCollectionNames(ctx, bson.M{"name": cfg.MongoDB.Collection})
	if err != nil {
		return fmt.Errorf("error listing collections: %w", err)
	}

	if len(collections) > 0 {
		log.Printf("Encrypted collection '%s' already exists, skipping creation", cfg.MongoDB.Collection)
		return nil
	}

	// Create encrypted collection
	log.Println("Creating new encrypted collection...")
	if err := encryptionMgr.CreateEncryptedCollection(ctx, client, db, cfg.MongoDB.Collection); err != nil {
		return fmt.Errorf("error creating encrypted collection: %w", err)
	}

	log.Println("Encrypted collection setup complete!")
	return nil
}

// disconnectMongoDB closes the MongoDB connection
func disconnectMongoDB(client *mongo.Client) {
	if client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := client.Disconnect(ctx); err != nil {
			log.Printf("Error disconnecting from MongoDB: %v", err)
		} else {
			log.Println("Disconnected from MongoDB")
		}
	}
}

// setupRouter configures the HTTP router
func setupRouter(cfg *config.Config, employeeHandler *handler.EmployeeHandler) *gin.Engine {
	router := gin.Default()

	// CORS middleware
	router.Use(middleware.CORSMiddleware(cfg.CORS.AllowedOrigins))

	// Serve static files
	router.Static("/static", "./web/static")
	router.LoadHTMLGlob("./web/templates/*")

	// Serve frontend
	router.GET("/", func(c *gin.Context) {
		c.HTML(http.StatusOK, "index.html", nil)
	})

	// API routes
	api := router.Group("/api")
	{
		employees := api.Group("/employees")
		{
			employees.POST("", employeeHandler.CreateEmployee)
			employees.GET("", employeeHandler.GetAllEmployees)
			employees.GET("/stats", employeeHandler.GetStats)
			employees.GET("/:id", employeeHandler.GetEmployeeByID)
			employees.PUT("/:id", employeeHandler.UpdateEmployee)
			employees.DELETE("/:id", employeeHandler.DeleteEmployee)

			// Search endpoints demonstrating queryable encryption
			search := employees.Group("/search")
			{
				search.GET("/name/:name", employeeHandler.SearchByName)
				search.GET("/ssn/:ssn", employeeHandler.SearchBySSN)
				search.GET("/salary", employeeHandler.SearchBySalaryRange)
				search.GET("/advanced", employeeHandler.AdvancedSearch)
			}
		}
	}

	return router
}
