package repository

import (
	"context"
	"errors"
	"log"
	"time"

	"todo-list-golang/internal/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// TaskRepository defines the interface for database operations
type TaskRepository interface {
	Create(ctx context.Context, task *models.Task) error
	FindAll(ctx context.Context, filter *models.TaskFilter) ([]*models.Task, error)
	FindByID(ctx context.Context, id primitive.ObjectID) (*models.Task, error)
	Update(ctx context.Context, id primitive.ObjectID, task *models.Task) error
	Delete(ctx context.Context, id primitive.ObjectID) error
	Count(ctx context.Context, filter *models.TaskFilter) (int64, error)
}

// taskRepository implements TaskRepository
type taskRepository struct {
	collection *mongo.Collection
}

// NewTaskRepository creates a new repository instance
func NewTaskRepository(db *mongo.Database, collectionName string) TaskRepository {
	return &taskRepository{
		collection: db.Collection(collectionName),
	}
}

// Create inserts a new task into the database
func (r *taskRepository) Create(ctx context.Context, task *models.Task) error {
	// Generate a new ID if it doesn't exist
	if task.ID.IsZero() {
		task.ID = primitive.NewObjectID()
	}

	// Set timestamps
	now := time.Now()
	task.CreatedAt = now
	task.UpdatedAt = now

	_, err := r.collection.InsertOne(ctx, task)
	if err != nil {
		return err
	}

	return nil
}

// FindAll retrieves all tasks with optional filters
func (r *taskRepository) FindAll(ctx context.Context, filter *models.TaskFilter) ([]*models.Task, error) {
	// Build the BSON filter
	bsonFilter := bson.M{}
	if filter != nil {
		if filter.Completed != nil {
			bsonFilter["completed"] = *filter.Completed
		}
		if filter.Priority != "" {
			bsonFilter["priority"] = filter.Priority
		}
	}

	// Sort options (most recent first)
	opts := options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}})

	cursor, err := r.collection.Find(ctx, bsonFilter, opts)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := cursor.Close(ctx); err != nil {
			log.Printf("Error closing cursor: %v", err)
		}
	}()

	var tasks []*models.Task
	if err := cursor.All(ctx, &tasks); err != nil {
		return nil, err
	}

	// Return empty slice instead of nil if there are no tasks
	if tasks == nil {
		tasks = []*models.Task{}
	}

	return tasks, nil
}

// FindByID retrieves a task by ID
func (r *taskRepository) FindByID(ctx context.Context, id primitive.ObjectID) (*models.Task, error) {
	var task models.Task
	err := r.collection.FindOne(ctx, bson.M{"_id": id}).Decode(&task)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, errors.New(models.ErrTaskNotFound)
		}
		return nil, err
	}

	return &task, nil
}

// Update updates an existing task
func (r *taskRepository) Update(ctx context.Context, id primitive.ObjectID, task *models.Task) error {
	// Update the timestamp
	task.UpdatedAt = time.Now()

	// Remove the ID from the update document
	update := bson.M{
		"$set": bson.M{
			"name":        task.Name,
			"description": task.Description,
			"completed":   task.Completed,
			"priority":    task.Priority,
			"dueDate":     task.DueDate,
			"updatedAt":   task.UpdatedAt,
			"_v":          task.Version, // Update document version
		},
	}

	result, err := r.collection.UpdateOne(
		ctx,
		bson.M{"_id": id},
		update,
	)
	if err != nil {
		return err
	}

	if result.MatchedCount == 0 {
		return errors.New(models.ErrTaskNotFound)
	}

	return nil
}

// Delete removes a task from the database
func (r *taskRepository) Delete(ctx context.Context, id primitive.ObjectID) error {
	result, err := r.collection.DeleteOne(ctx, bson.M{"_id": id})
	if err != nil {
		return err
	}

	if result.DeletedCount == 0 {
		return errors.New(models.ErrTaskNotFound)
	}

	return nil
}

// Count returns the number of tasks that match the filter
func (r *taskRepository) Count(ctx context.Context, filter *models.TaskFilter) (int64, error) {
	// Build the BSON filter
	bsonFilter := bson.M{}
	if filter != nil {
		if filter.Completed != nil {
			bsonFilter["completed"] = *filter.Completed
		}
		if filter.Priority != "" {
			bsonFilter["priority"] = filter.Priority
		}
	}

	count, err := r.collection.CountDocuments(ctx, bsonFilter)
	if err != nil {
		return 0, err
	}

	return count, nil
}
