// Package repository provides data access layer for MongoDB operations.
package repository

import (
	"context"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// indexModels defines all required indexes for the tasks collection
// This is the single source of truth for index definitions
var indexModels = []mongo.IndexModel{
	// Index on 'completed' field for filtering
	// Used in: GET /tasks?completed=true/false
	{
		Keys: bson.D{{Key: "completed", Value: 1}},
		Options: options.Index().
			SetName("idx_completed"),
	},

	// Index on 'priority' field for filtering
	// Used in: GET /tasks?priority=high/medium/low
	{
		Keys: bson.D{{Key: "priority", Value: 1}},
		Options: options.Index().
			SetName("idx_priority"),
	},

	// Compound index on 'completed' and 'priority'
	// Used for combined filters: GET /tasks?completed=false&priority=high
	{
		Keys: bson.D{
			{Key: "completed", Value: 1},
			{Key: "priority", Value: 1},
		},
		Options: options.Index().
			SetName("idx_completed_priority"),
	},

	// Index on 'createdAt' for sorting (descending for newest first)
	// Used in: Default sorting of tasks
	{
		Keys: bson.D{{Key: "createdAt", Value: -1}},
		Options: options.Index().
			SetName("idx_created_at"),
	},

	// Index on 'dueDate' for queries and sorting
	// Useful for finding overdue tasks
	{
		Keys: bson.D{{Key: "dueDate", Value: 1}},
		Options: options.Index().
			SetName("idx_due_date").
			SetSparse(true), // Only index documents that have dueDate
	},

	// Index on '_v' (version) for optimistic locking
	// Useful for tracking document versions
	{
		Keys: bson.D{{Key: "_v", Value: 1}},
		Options: options.Index().
			SetName("idx_version"),
	},
}

// IndexManager manages MongoDB indexes for the tasks collection
type IndexManager struct {
	collection *mongo.Collection
}

// NewIndexManager creates a new index manager
func NewIndexManager(collection *mongo.Collection) *IndexManager {
	return &IndexManager{
		collection: collection,
	}
}

// CreateIndexes creates all required indexes for the tasks collection
// This should be called when the application starts
func (im *IndexManager) CreateIndexes(ctx context.Context) error {
	log.Println("Creating MongoDB indexes...")

	// Create indexes
	names, err := im.collection.Indexes().CreateMany(ctx, indexModels)
	if err != nil {
		log.Printf("Error creating indexes: %v", err)
		return err
	}

	log.Printf("Successfully created %d indexes: %v", len(names), names)
	return nil
}

// DropIndexes removes all custom indexes (keeps only _id index)
// This should be called during cleanup or when recreating indexes
func (im *IndexManager) DropIndexes(ctx context.Context) error {
	log.Println("Dropping MongoDB indexes...")

	// List all indexes
	cursor, err := im.collection.Indexes().List(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if err := cursor.Close(ctx); err != nil {
			log.Printf("Error closing cursor: %v", err)
		}
	}()

	var indexes []bson.M
	if err := cursor.All(ctx, &indexes); err != nil {
		return err
	}

	// Drop each index except _id
	for _, index := range indexes {
		indexName, ok := index["name"].(string)
		if !ok || indexName == "_id_" {
			continue // Skip _id index (can't be dropped)
		}

		log.Printf("Dropping index: %s", indexName)
		if _, err := im.collection.Indexes().DropOne(ctx, indexName); err != nil {
			log.Printf("Error dropping index %s: %v", indexName, err)
			return err
		}
	}

	log.Println("Successfully dropped all custom indexes")
	return nil
}

// ListIndexes returns all indexes on the collection
func (im *IndexManager) ListIndexes(ctx context.Context) ([]bson.M, error) {
	cursor, err := im.collection.Indexes().List(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := cursor.Close(ctx); err != nil {
			log.Printf("Error closing cursor: %v", err)
		}
	}()

	var indexes []bson.M
	if err := cursor.All(ctx, &indexes); err != nil {
		return nil, err
	}

	return indexes, nil
}

// RebuildIndexes drops and recreates all indexes
// Useful for updating index definitions
func (im *IndexManager) RebuildIndexes(ctx context.Context) error {
	log.Println("Rebuilding MongoDB indexes...")

	// Drop existing indexes
	if err := im.DropIndexes(ctx); err != nil {
		return err
	}

	// Wait a bit for MongoDB to clean up
	time.Sleep(time.Second)

	// Create indexes again
	if err := im.CreateIndexes(ctx); err != nil {
		return err
	}

	log.Println("Successfully rebuilt indexes")
	return nil
}

// GetIndexStats returns statistics about index usage
// Useful for monitoring and optimization
func (im *IndexManager) GetIndexStats(ctx context.Context) ([]bson.M, error) {
	pipeline := mongo.Pipeline{
		{{Key: "$indexStats", Value: bson.M{}}},
	}

	cursor, err := im.collection.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := cursor.Close(ctx); err != nil {
			log.Printf("Error closing cursor: %v", err)
		}
	}()

	var stats []bson.M
	if err := cursor.All(ctx, &stats); err != nil {
		return nil, err
	}

	return stats, nil
}

// EnsureIndexes checks if indexes exist and creates them if they don't
// This is idempotent and safe to call multiple times
func (im *IndexManager) EnsureIndexes(ctx context.Context) error {
	log.Println("Ensuring MongoDB indexes exist...")

	// Get existing indexes
	existingIndexes, err := im.ListIndexes(ctx)
	if err != nil {
		return err
	}

	// Map existing index names
	existingNames := make(map[string]bool)
	for _, idx := range existingIndexes {
		if name, ok := idx["name"].(string); ok {
			existingNames[name] = true
		}
	}

	// Extract required index names from our index models
	requiredIndexes := make([]string, 0, len(indexModels))
	for _, model := range indexModels {
		if model.Options != nil && model.Options.Name != nil {
			requiredIndexes = append(requiredIndexes, *model.Options.Name)
		}
	}

	missingIndexes := []string{}
	for _, name := range requiredIndexes {
		if !existingNames[name] {
			missingIndexes = append(missingIndexes, name)
		}
	}

	if len(missingIndexes) > 0 {
		log.Printf("Missing indexes: %v. Creating them...", missingIndexes)
		return im.CreateIndexes(ctx)
	}

	log.Println("All indexes exist")
	return nil
}
