package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"todo-list-golang/internal/models"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Mock Repository para testes
type mockTaskRepository struct {
	tasks          map[primitive.ObjectID]*models.Task
	createFunc     func(ctx context.Context, task *models.Task) error
	findAllFunc    func(ctx context.Context, filter *models.TaskFilter) ([]*models.Task, error)
	findByIDFunc   func(ctx context.Context, id primitive.ObjectID) (*models.Task, error)
	updateFunc     func(ctx context.Context, id primitive.ObjectID, task *models.Task) error
	deleteFunc     func(ctx context.Context, id primitive.ObjectID) error
	countFunc      func(ctx context.Context, filter *models.TaskFilter) (int64, error)
}

func (m *mockTaskRepository) Create(ctx context.Context, task *models.Task) error {
	if m.createFunc != nil {
		return m.createFunc(ctx, task)
	}
	if m.tasks == nil {
		m.tasks = make(map[primitive.ObjectID]*models.Task)
	}
	task.ID = primitive.NewObjectID()
	m.tasks[task.ID] = task
	return nil
}

func (m *mockTaskRepository) FindAll(ctx context.Context, filter *models.TaskFilter) ([]*models.Task, error) {
	if m.findAllFunc != nil {
		return m.findAllFunc(ctx, filter)
	}
	var tasks []*models.Task
	for _, task := range m.tasks {
		tasks = append(tasks, task)
	}
	return tasks, nil
}

func (m *mockTaskRepository) FindByID(ctx context.Context, id primitive.ObjectID) (*models.Task, error) {
	if m.findByIDFunc != nil {
		return m.findByIDFunc(ctx, id)
	}
	task, exists := m.tasks[id]
	if !exists {
		return nil, errors.New("task not found")
	}
	return task, nil
}

func (m *mockTaskRepository) Update(ctx context.Context, id primitive.ObjectID, task *models.Task) error {
	if m.updateFunc != nil {
		return m.updateFunc(ctx, id, task)
	}
	if _, exists := m.tasks[id]; !exists {
		return errors.New("task not found")
	}
	m.tasks[id] = task
	return nil
}

func (m *mockTaskRepository) Delete(ctx context.Context, id primitive.ObjectID) error {
	if m.deleteFunc != nil {
		return m.deleteFunc(ctx, id)
	}
	if _, exists := m.tasks[id]; !exists {
		return errors.New("task not found")
	}
	delete(m.tasks, id)
	return nil
}

func (m *mockTaskRepository) Count(ctx context.Context, filter *models.TaskFilter) (int64, error) {
	if m.countFunc != nil {
		return m.countFunc(ctx, filter)
	}
	return int64(len(m.tasks)), nil
}

func TestCreateTask(t *testing.T) {
	mockRepo := &mockTaskRepository{}
	service := NewTaskService(mockRepo)

	tests := []struct {
		name    string
		req     *models.CreateTaskRequest
		wantErr bool
	}{
		{
			name: "valid task",
			req: &models.CreateTaskRequest{
				Name:     "Test Task",
				Priority: "medium",
			},
			wantErr: false,
		},
		{
			name: "empty name",
			req: &models.CreateTaskRequest{
				Name:     "",
				Priority: "medium",
			},
			wantErr: true,
		},
		{
			name: "invalid priority",
			req: &models.CreateTaskRequest{
				Name:     "Test",
				Priority: "invalid",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			task, err := service.CreateTask(context.Background(), tt.req)
			if (err != nil) != tt.wantErr {
				t.Errorf("CreateTask() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && task == nil {
				t.Error("Expected task to be created")
			}
		})
	}
}

func TestGetTaskByID(t *testing.T) {
	mockRepo := &mockTaskRepository{
		tasks: make(map[primitive.ObjectID]*models.Task),
	}

	// Adiciona uma tarefa de teste
	testID := primitive.NewObjectID()
	mockRepo.tasks[testID] = &models.Task{
		ID:   testID,
		Name: "Test Task",
	}

	service := NewTaskService(mockRepo)

	tests := []struct {
		name    string
		id      string
		wantErr bool
	}{
		{
			name:    "valid id",
			id:      testID.Hex(),
			wantErr: false,
		},
		{
			name:    "invalid id format",
			id:      "invalid",
			wantErr: true,
		},
		{
			name:    "non-existent id",
			id:      primitive.NewObjectID().Hex(),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			task, err := service.GetTaskByID(context.Background(), tt.id)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetTaskByID() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && task == nil {
				t.Error("Expected task to be returned")
			}
		})
	}
}

func TestUpdateTask(t *testing.T) {
	mockRepo := &mockTaskRepository{
		tasks: make(map[primitive.ObjectID]*models.Task),
	}

	// Adiciona uma tarefa de teste
	testID := primitive.NewObjectID()
	mockRepo.tasks[testID] = &models.Task{
		ID:        testID,
		Name:      "Original Name",
		Priority:  "low",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	service := NewTaskService(mockRepo)

	tests := []struct {
		name    string
		id      string
		req     *models.UpdateTaskRequest
		wantErr bool
	}{
		{
			name: "valid update",
			id:   testID.Hex(),
			req: &models.UpdateTaskRequest{
				Name: stringPtr("Updated Name"),
			},
			wantErr: false,
		},
		{
			name:    "no updates",
			id:      testID.Hex(),
			req:     &models.UpdateTaskRequest{},
			wantErr: true,
		},
		{
			name: "invalid id",
			id:   "invalid",
			req: &models.UpdateTaskRequest{
				Name: stringPtr("Updated"),
			},
			wantErr: true,
		},
		{
			name: "non-existent task",
			id:   primitive.NewObjectID().Hex(),
			req: &models.UpdateTaskRequest{
				Name: stringPtr("Updated"),
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			task, err := service.UpdateTask(context.Background(), tt.id, tt.req)
			if (err != nil) != tt.wantErr {
				t.Errorf("UpdateTask() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && task == nil {
				t.Error("Expected updated task to be returned")
			}
		})
	}
}

func TestToggleTaskCompletion(t *testing.T) {
	mockRepo := &mockTaskRepository{
		tasks: make(map[primitive.ObjectID]*models.Task),
	}

	// Adiciona uma tarefa de teste
	testID := primitive.NewObjectID()
	mockRepo.tasks[testID] = &models.Task{
		ID:        testID,
		Name:      "Test Task",
		Completed: false,
		Priority:  "medium",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	service := NewTaskService(mockRepo)

	// Primeiro toggle (false -> true)
	task, err := service.ToggleTaskCompletion(context.Background(), testID.Hex())
	if err != nil {
		t.Errorf("ToggleTaskCompletion() error = %v", err)
		return
	}

	if !task.Completed {
		t.Error("Expected task to be completed")
	}

	// Segundo toggle (true -> false)
	task, err = service.ToggleTaskCompletion(context.Background(), testID.Hex())
	if err != nil {
		t.Errorf("ToggleTaskCompletion() error = %v", err)
		return
	}

	if task.Completed {
		t.Error("Expected task to be not completed")
	}
}

func TestDeleteTask(t *testing.T) {
	mockRepo := &mockTaskRepository{
		tasks: make(map[primitive.ObjectID]*models.Task),
	}

	// Adiciona uma tarefa de teste
	testID := primitive.NewObjectID()
	mockRepo.tasks[testID] = &models.Task{
		ID:   testID,
		Name: "Test Task",
	}

	service := NewTaskService(mockRepo)

	tests := []struct {
		name    string
		id      string
		wantErr bool
	}{
		{
			name:    "valid deletion",
			id:      testID.Hex(),
			wantErr: false,
		},
		{
			name:    "invalid id",
			id:      "invalid",
			wantErr: true,
		},
		{
			name:    "non-existent task",
			id:      primitive.NewObjectID().Hex(),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := service.DeleteTask(context.Background(), tt.id)
			if (err != nil) != tt.wantErr {
				t.Errorf("DeleteTask() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestGetTaskStats(t *testing.T) {
	mockRepo := &mockTaskRepository{
		countFunc: func(ctx context.Context, filter *models.TaskFilter) (int64, error) {
			if filter == nil {
				return 10, nil
			}
			if filter.Completed != nil {
				if *filter.Completed {
					return 6, nil
				}
				return 4, nil
			}
			if filter.Priority == "high" {
				return 2, nil
			}
			return 0, nil
		},
	}

	service := NewTaskService(mockRepo)

	stats, err := service.GetTaskStats(context.Background())
	if err != nil {
		t.Errorf("GetTaskStats() error = %v", err)
		return
	}

	if stats.Total != 10 {
		t.Errorf("Expected total = 10, got %d", stats.Total)
	}

	if stats.Completed != 6 {
		t.Errorf("Expected completed = 6, got %d", stats.Completed)
	}

	if stats.Pending != 4 {
		t.Errorf("Expected pending = 4, got %d", stats.Pending)
	}

	if stats.HighPriority != 2 {
		t.Errorf("Expected highPriority = 2, got %d", stats.HighPriority)
	}
}

// Helper functions
func stringPtr(s string) *string {
	return &s
}
