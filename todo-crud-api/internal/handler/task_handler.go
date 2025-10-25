// Package handler provides HTTP handlers for the API endpoints.
package handler

import (
	"net/http"
	"strconv"

	"todo-list-golang/internal/models"
	"todo-list-golang/internal/service"

	"github.com/gin-gonic/gin"
)

// TaskHandler manages HTTP requests related to tasks
type TaskHandler struct {
	service service.TaskService
}

// NewTaskHandler creates a new handler instance
func NewTaskHandler(service service.TaskService) *TaskHandler {
	return &TaskHandler{
		service: service,
	}
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error string `json:"error"`
}

// SuccessResponse represents a generic success response
type SuccessResponse struct {
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// CreateTask godoc
// @Summary Create a new task
// @Description Creates a new task in the system
// @Tags tasks
// @Accept json
// @Produce json
// @Param task body models.CreateTaskRequest true "Task data"
// @Success 201 {object} models.Task
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /tasks [post]
func (h *TaskHandler) CreateTask(c *gin.Context) {
	var req models.CreateTaskRequest

	// Validate the received JSON
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid data: " + err.Error()})
		return
	}

	// Call the service
	task, err := h.service.CreateTask(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusCreated, task)
}

// GetAllTasks godoc
// @Summary List all tasks
// @Description Returns all tasks with optional filters
// @Tags tasks
// @Produce json
// @Param completed query bool false "Filter by completion status"
// @Param priority query string false "Filter by priority (low, medium, high)"
// @Success 200 {array} models.Task
// @Failure 500 {object} ErrorResponse
// @Router /tasks [get]
func (h *TaskHandler) GetAllTasks(c *gin.Context) {
	// Process query string filters
	filter := &models.TaskFilter{}

	// Completed filter
	if completedStr := c.Query("completed"); completedStr != "" {
		completed, err := strconv.ParseBool(completedStr)
		if err == nil {
			filter.Completed = &completed
		}
	}

	// Priority filter
	if priority := c.Query("priority"); priority != "" {
		filter.Priority = priority
	}

	// Call the service
	tasks, err := h.service.GetAllTasks(c.Request.Context(), filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, tasks)
}

// GetTaskByID godoc
// @Summary Get a task by ID
// @Description Returns the details of a specific task
// @Tags tasks
// @Produce json
// @Param id path string true "Task ID"
// @Success 200 {object} models.Task
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /tasks/{id} [get]
func (h *TaskHandler) GetTaskByID(c *gin.Context) {
	id := c.Param("id")

	task, err := h.service.GetTaskByID(c.Request.Context(), id)
	if err != nil {
		if err.Error() == models.ErrTaskNotFound {
			c.JSON(http.StatusNotFound, ErrorResponse{Error: err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, task)
}

// UpdateTask godoc
// @Summary Update a task
// @Description Updates the data of an existing task
// @Tags tasks
// @Accept json
// @Produce json
// @Param id path string true "Task ID"
// @Param task body models.UpdateTaskRequest true "Update data"
// @Success 200 {object} models.Task
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /tasks/{id} [put]
func (h *TaskHandler) UpdateTask(c *gin.Context) {
	id := c.Param("id")

	var req models.UpdateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid data: " + err.Error()})
		return
	}

	task, err := h.service.UpdateTask(c.Request.Context(), id, &req)
	if err != nil {
		if err.Error() == models.ErrTaskNotFound {
			c.JSON(http.StatusNotFound, ErrorResponse{Error: err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, task)
}

// ToggleTaskCompletion godoc
// @Summary Toggle completion status
// @Description Marks a task as completed or pending
// @Tags tasks
// @Produce json
// @Param id path string true "Task ID"
// @Success 200 {object} models.Task
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /tasks/{id}/toggle [patch]
func (h *TaskHandler) ToggleTaskCompletion(c *gin.Context) {
	id := c.Param("id")

	task, err := h.service.ToggleTaskCompletion(c.Request.Context(), id)
	if err != nil {
		if err.Error() == models.ErrTaskNotFound {
			c.JSON(http.StatusNotFound, ErrorResponse{Error: err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, task)
}

// DeleteTask godoc
// @Summary Delete a task
// @Description Removes a task from the system
// @Tags tasks
// @Param id path string true "Task ID"
// @Success 204
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /tasks/{id} [delete]
func (h *TaskHandler) DeleteTask(c *gin.Context) {
	id := c.Param("id")

	err := h.service.DeleteTask(c.Request.Context(), id)
	if err != nil {
		if err.Error() == models.ErrTaskNotFound {
			c.JSON(http.StatusNotFound, ErrorResponse{Error: err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// GetTaskStats godoc
// @Summary Get task statistics
// @Description Returns general statistics about tasks
// @Tags tasks
// @Produce json
// @Success 200 {object} service.TaskStats
// @Failure 500 {object} ErrorResponse
// @Router /tasks/stats [get]
func (h *TaskHandler) GetTaskStats(c *gin.Context) {
	stats, err := h.service.GetTaskStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Error fetching statistics"})
		return
	}

	c.JSON(http.StatusOK, stats)
}
