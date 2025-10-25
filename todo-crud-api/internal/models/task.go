package models

import (
	"errors"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Task represents a task in the system
type Task struct {
	ID          primitive.ObjectID `json:"id" bson:"_id,omitempty"`
	Name        string             `json:"name" bson:"name" binding:"required"`
	Description string             `json:"description" bson:"description"`
	Completed   bool               `json:"completed" bson:"completed"`
	Priority    string             `json:"priority" bson:"priority"` // low, medium, high
	DueDate     *time.Time         `json:"dueDate,omitempty" bson:"dueDate,omitempty"`
	CreatedAt   time.Time          `json:"createdAt" bson:"createdAt"`
	UpdatedAt   time.Time          `json:"updatedAt" bson:"updatedAt"`
	Version     int                `json:"version" bson:"_v"` // Document version for tracking changes
}

// CreateTaskRequest represents the payload to create a new task
type CreateTaskRequest struct {
	Name        string     `json:"name" binding:"required,min=1,max=200"`
	Description string     `json:"description" binding:"max=1000"`
	Priority    string     `json:"priority" binding:"omitempty,oneof=low medium high"`
	DueDate     *time.Time `json:"dueDate"`
}

// UpdateTaskRequest represents the payload to update a task
type UpdateTaskRequest struct {
	Name        *string    `json:"name" binding:"omitempty,min=1,max=200"`
	Description *string    `json:"description" binding:"omitempty,max=1000"`
	Completed   *bool      `json:"completed"`
	Priority    *string    `json:"priority" binding:"omitempty,oneof=low medium high"`
	DueDate     *time.Time `json:"dueDate"`
}

// TaskFilter represents filters to search for tasks
type TaskFilter struct {
	Completed *bool
	Priority  string
}

// Validate validates the task data
func (t *Task) Validate() error {
	// Validate the name
	if strings.TrimSpace(t.Name) == "" {
		return errors.New("task name is required")
	}

	if len(t.Name) > 200 {
		return errors.New("task name must be at most 200 characters")
	}

	// Validate the description
	if len(t.Description) > 1000 {
		return errors.New("description must be at most 1000 characters")
	}

	// Validate the priority
	if t.Priority != "" {
		priority := strings.ToLower(t.Priority)
		if priority != "low" && priority != "medium" && priority != "high" {
			return errors.New("invalid priority. Use: low, medium or high")
		}
		t.Priority = priority
	} else {
		t.Priority = "medium" // Default priority
	}

	// Validate the due date
	if t.DueDate != nil && t.DueDate.Before(time.Now()) {
		return errors.New("due date cannot be in the past")
	}

	return nil
}

// ToTask converts CreateTaskRequest to Task
func (r *CreateTaskRequest) ToTask() *Task {
	now := time.Now()
	priority := r.Priority
	if priority == "" {
		priority = "medium"
	}

	return &Task{
		Name:        strings.TrimSpace(r.Name),
		Description: strings.TrimSpace(r.Description),
		Completed:   false,
		Priority:    strings.ToLower(priority),
		DueDate:     r.DueDate,
		CreatedAt:   now,
		UpdatedAt:   now,
		Version:     1, // Initial version
	}
}

// ApplyUpdates applies the updates from UpdateTaskRequest to a Task
func (r *UpdateTaskRequest) ApplyUpdates(task *Task) {
	if r.Name != nil {
		task.Name = strings.TrimSpace(*r.Name)
	}

	if r.Description != nil {
		task.Description = strings.TrimSpace(*r.Description)
	}

	if r.Completed != nil {
		task.Completed = *r.Completed
	}

	if r.Priority != nil {
		task.Priority = strings.ToLower(*r.Priority)
	}

	if r.DueDate != nil {
		task.DueDate = r.DueDate
	}

	task.UpdatedAt = time.Now()
	task.Version++ // Increment version on each update
}

// HasUpdates checks if the UpdateTaskRequest has any updates
func (r *UpdateTaskRequest) HasUpdates() bool {
	return r.Name != nil || r.Description != nil || r.Completed != nil ||
	       r.Priority != nil || r.DueDate != nil
}
