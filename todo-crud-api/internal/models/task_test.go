package models

import (
	"testing"
	"time"
)

func TestTaskValidate(t *testing.T) {
	tests := []struct {
		name    string
		task    Task
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid task",
			task: Task{
				Name:        "Test Task",
				Description: "Test Description",
				Priority:    "medium",
			},
			wantErr: false,
		},
		{
			name: "empty name",
			task: Task{
				Name:     "",
				Priority: "medium",
			},
			wantErr: true,
			errMsg:  "task name is required",
		},
		{
			name: "name too long",
			task: Task{
				Name:     string(make([]byte, 201)),
				Priority: "medium",
			},
			wantErr: true,
			errMsg:  "task name must be at most 200 characters",
		},
		{
			name: "description too long",
			task: Task{
				Name:        "Test",
				Description: string(make([]byte, 1001)),
				Priority:    "medium",
			},
			wantErr: true,
			errMsg:  "description must be at most 1000 characters",
		},
		{
			name: "invalid priority",
			task: Task{
				Name:     "Test",
				Priority: "invalid",
			},
			wantErr: true,
			errMsg:  "invalid priority. Use: low, medium or high",
		},
		{
			name: "valid low priority",
			task: Task{
				Name:     "Test",
				Priority: "low",
			},
			wantErr: false,
		},
		{
			name: "valid high priority",
			task: Task{
				Name:     "Test",
				Priority: "high",
			},
			wantErr: false,
		},
		{
			name: "due date in past",
			task: Task{
				Name:     "Test",
				Priority: "medium",
				DueDate:  &time.Time{},
			},
			wantErr: true,
			errMsg:  "due date cannot be in the past",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.task.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Task.Validate() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr && err.Error() != tt.errMsg {
				t.Errorf("Task.Validate() error message = %v, want %v", err.Error(), tt.errMsg)
			}
		})
	}
}

func TestCreateTaskRequestToTask(t *testing.T) {
	req := &CreateTaskRequest{
		Name:        "  Test Task  ",
		Description: "  Test Description  ",
		Priority:    "HIGH",
	}

	task := req.ToTask()

	if task.Name != "Test Task" {
		t.Errorf("Expected trimmed name, got %s", task.Name)
	}

	if task.Description != "Test Description" {
		t.Errorf("Expected trimmed description, got %s", task.Description)
	}

	if task.Priority != "high" {
		t.Errorf("Expected lowercase priority, got %s", task.Priority)
	}

	if task.Completed {
		t.Error("Expected completed to be false")
	}
}

func TestUpdateTaskRequestApplyUpdates(t *testing.T) {
	now := time.Now()
	task := &Task{
		Name:        "Original Name",
		Description: "Original Description",
		Completed:   false,
		Priority:    "low",
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	newName := "Updated Name"
	newDesc := "Updated Description"
	completed := true
	newPriority := "high"

	req := &UpdateTaskRequest{
		Name:        &newName,
		Description: &newDesc,
		Completed:   &completed,
		Priority:    &newPriority,
	}

	req.ApplyUpdates(task)

	if task.Name != "Updated Name" {
		t.Errorf("Expected name to be updated, got %s", task.Name)
	}

	if task.Description != "Updated Description" {
		t.Errorf("Expected description to be updated, got %s", task.Description)
	}

	if !task.Completed {
		t.Error("Expected completed to be true")
	}

	if task.Priority != "high" {
		t.Errorf("Expected priority to be high, got %s", task.Priority)
	}

	if task.UpdatedAt.Before(now) || task.UpdatedAt.Equal(now) {
		t.Error("Expected UpdatedAt to be updated")
	}
}

func TestUpdateTaskRequestHasUpdates(t *testing.T) {
	tests := []struct {
		name string
		req  UpdateTaskRequest
		want bool
	}{
		{
			name: "no updates",
			req:  UpdateTaskRequest{},
			want: false,
		},
		{
			name: "name update",
			req: UpdateTaskRequest{
				Name: stringPtr("New Name"),
			},
			want: true,
		},
		{
			name: "completed update",
			req: UpdateTaskRequest{
				Completed: boolPtr(true),
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.req.HasUpdates(); got != tt.want {
				t.Errorf("UpdateTaskRequest.HasUpdates() = %v, want %v", got, tt.want)
			}
		})
	}
}

// Helper functions for tests
func stringPtr(s string) *string {
	return &s
}

func boolPtr(b bool) *bool {
	return &b
}
