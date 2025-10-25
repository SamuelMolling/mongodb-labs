// Package service contains the business logic layer of the application.
package service

import (
	"context"
	"errors"
	"log"

	"todo-list-golang/internal/models"
	"todo-list-golang/internal/repository"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// TaskService defines the interface for business logic
type TaskService interface {
	CreateTask(ctx context.Context, req *models.CreateTaskRequest) (*models.Task, error)
	GetAllTasks(ctx context.Context, filter *models.TaskFilter) ([]*models.Task, error)
	GetTaskByID(ctx context.Context, id string) (*models.Task, error)
	UpdateTask(ctx context.Context, id string, req *models.UpdateTaskRequest) (*models.Task, error)
	DeleteTask(ctx context.Context, id string) error
	ToggleTaskCompletion(ctx context.Context, id string) (*models.Task, error)
	GetTaskStats(ctx context.Context) (*TaskStats, error)
}

// TaskStats represents task statistics
type TaskStats struct {
	Total        int64 `json:"total"`
	Completed    int64 `json:"completed"`
	Pending      int64 `json:"pending"`
	HighPriority int64 `json:"highPriority"`
}

// taskService implements TaskService
type taskService struct {
	repo repository.TaskRepository
}

// NewTaskService creates a new service instance
func NewTaskService(repo repository.TaskRepository) TaskService {
	return &taskService{
		repo: repo,
	}
}

// CreateTask creates a new task
func (s *taskService) CreateTask(ctx context.Context, req *models.CreateTaskRequest) (*models.Task, error) {
	// Convert the request to Task
	task := req.ToTask()

	// Validate the task
	if err := task.Validate(); err != nil {
		return nil, err
	}

	// Save to repository
	if err := s.repo.Create(ctx, task); err != nil {
		log.Printf("Error creating task: %v", err)
		return nil, errors.New("error creating task")
	}

	return task, nil
}

// GetAllTasks returns all tasks
func (s *taskService) GetAllTasks(ctx context.Context, filter *models.TaskFilter) ([]*models.Task, error) {
	tasks, err := s.repo.FindAll(ctx, filter)
	if err != nil {
		log.Printf("Error fetching tasks: %v", err)
		return nil, errors.New("error fetching tasks")
	}

	return tasks, nil
}

// GetTaskByID returns a specific task
func (s *taskService) GetTaskByID(ctx context.Context, id string) (*models.Task, error) {
	// Convert string to ObjectID
	objID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, errors.New("invalid ID")
	}

	task, err := s.repo.FindByID(ctx, objID)
	if err != nil {
		log.Printf("Error fetching task: %v", err)
		return nil, err
	}

	return task, nil
}

// UpdateTask updates an existing task
func (s *taskService) UpdateTask(ctx context.Context, id string, req *models.UpdateTaskRequest) (*models.Task, error) {
	// Check if there are updates
	if !req.HasUpdates() {
		return nil, errors.New("no updates provided")
	}

	// Convert string to ObjectID
	objID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, errors.New("invalid ID")
	}

	// Find the existing task
	task, err := s.repo.FindByID(ctx, objID)
	if err != nil {
		return nil, err
	}

	// Apply the updates
	req.ApplyUpdates(task)

	// Validate the updated task
	if err := task.Validate(); err != nil {
		return nil, err
	}

	// Save the changes
	if err := s.repo.Update(ctx, objID, task); err != nil {
		log.Printf("Error updating task: %v", err)
		return nil, errors.New("error updating task")
	}

	return task, nil
}

// DeleteTask removes a task
func (s *taskService) DeleteTask(ctx context.Context, id string) error {
	// Convert string to ObjectID
	objID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return errors.New("invalid ID")
	}

	if err := s.repo.Delete(ctx, objID); err != nil {
		log.Printf("Error deleting task: %v", err)
		return err
	}

	return nil
}

// ToggleTaskCompletion toggles the completion status of a task
func (s *taskService) ToggleTaskCompletion(ctx context.Context, id string) (*models.Task, error) {
	// Convert string to ObjectID
	objID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, errors.New("invalid ID")
	}

	// Find the existing task
	task, err := s.repo.FindByID(ctx, objID)
	if err != nil {
		return nil, err
	}

	// Toggle the status
	task.Completed = !task.Completed

	// Save the changes
	if err := s.repo.Update(ctx, objID, task); err != nil {
		log.Printf("Error updating task: %v", err)
		return nil, errors.New("error updating task")
	}

	return task, nil
}

// GetTaskStats returns task statistics
func (s *taskService) GetTaskStats(ctx context.Context) (*TaskStats, error) {
	// Total tasks
	total, err := s.repo.Count(ctx, nil)
	if err != nil {
		return nil, err
	}

	// Completed tasks
	completedFilter := true
	completed, err := s.repo.Count(ctx, &models.TaskFilter{Completed: &completedFilter})
	if err != nil {
		return nil, err
	}

	// Pending tasks
	pendingFilter := false
	pending, err := s.repo.Count(ctx, &models.TaskFilter{Completed: &pendingFilter})
	if err != nil {
		return nil, err
	}

	// High priority tasks
	highPriority, err := s.repo.Count(ctx, &models.TaskFilter{Priority: "high"})
	if err != nil {
		return nil, err
	}

	return &TaskStats{
		Total:        total,
		Completed:    completed,
		Pending:      pending,
		HighPriority: highPriority,
	}, nil
}
