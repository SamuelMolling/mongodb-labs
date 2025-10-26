// Package handler provides HTTP handlers for the API endpoints.
package handler

import (
	"net/http"
	"strconv"

	"queryable-encryption-lab/internal/models"
	"queryable-encryption-lab/internal/repository"
	"queryable-encryption-lab/internal/service"

	"github.com/gin-gonic/gin"
)

// EmployeeHandler manages HTTP requests related to employees
type EmployeeHandler struct {
	service service.EmployeeService
}

// NewEmployeeHandler creates a new handler instance
func NewEmployeeHandler(service service.EmployeeService) *EmployeeHandler {
	return &EmployeeHandler{
		service: service,
	}
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error string `json:"error"`
}

// SuccessResponse represents a success response
type SuccessResponse struct {
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// CreateEmployee handles POST /api/employees
func (h *EmployeeHandler) CreateEmployee(c *gin.Context) {
	var req models.CreateEmployeeRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid data: " + err.Error()})
		return
	}

	employee, err := h.service.CreateEmployee(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusCreated, employee)
}

// GetAllEmployees handles GET /api/employees
func (h *EmployeeHandler) GetAllEmployees(c *gin.Context) {
	filter := &models.EmployeeFilter{}

	if department := c.Query("department"); department != "" {
		filter.Department = department
	}

	if minSalaryStr := c.Query("minSalary"); minSalaryStr != "" {
		if minSalary, err := strconv.Atoi(minSalaryStr); err == nil {
			filter.MinSalary = &minSalary
		}
	}

	if maxSalaryStr := c.Query("maxSalary"); maxSalaryStr != "" {
		if maxSalary, err := strconv.Atoi(maxSalaryStr); err == nil {
			filter.MaxSalary = &maxSalary
		}
	}

	employees, err := h.service.GetAllEmployees(c.Request.Context(), filter)
	if err != nil {
		// Log the detailed error
		c.Error(err)
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Error fetching employees: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, employees)
}

// GetEmployeeByID handles GET /api/employees/:id
func (h *EmployeeHandler) GetEmployeeByID(c *gin.Context) {
	id := c.Param("id")

	employee, err := h.service.GetEmployeeByID(c.Request.Context(), id)
	if err != nil {
		if err == repository.ErrEmployeeNotFound {
			c.JSON(http.StatusNotFound, ErrorResponse{Error: err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, employee)
}

// SearchByName handles GET /api/employees/search/name/:name
func (h *EmployeeHandler) SearchByName(c *gin.Context) {
	name := c.Param("name")

	employees, err := h.service.SearchByName(c.Request.Context(), name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, employees)
}

// SearchBySSN handles GET /api/employees/search/ssn/:ssn
func (h *EmployeeHandler) SearchBySSN(c *gin.Context) {
	ssn := c.Param("ssn")

	employee, err := h.service.SearchBySSN(c.Request.Context(), ssn)
	if err != nil {
		if err == repository.ErrEmployeeNotFound {
			c.JSON(http.StatusNotFound, ErrorResponse{Error: "Employee not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, employee)
}

// SearchBySalaryRange handles GET /api/employees/search/salary
func (h *EmployeeHandler) SearchBySalaryRange(c *gin.Context) {
	minSalaryStr := c.Query("min")
	maxSalaryStr := c.Query("max")

	if minSalaryStr == "" || maxSalaryStr == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Both min and max salary are required"})
		return
	}

	minSalary, err := strconv.Atoi(minSalaryStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid minimum salary"})
		return
	}

	maxSalary, err := strconv.Atoi(maxSalaryStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid maximum salary"})
		return
	}

	employees, err := h.service.SearchBySalaryRange(c.Request.Context(), minSalary, maxSalary)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, employees)
}

// UpdateEmployee handles PUT /api/employees/:id
func (h *EmployeeHandler) UpdateEmployee(c *gin.Context) {
	id := c.Param("id")

	var req models.UpdateEmployeeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid data: " + err.Error()})
		return
	}

	employee, err := h.service.UpdateEmployee(c.Request.Context(), id, &req)
	if err != nil {
		if err == repository.ErrEmployeeNotFound {
			c.JSON(http.StatusNotFound, ErrorResponse{Error: err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, employee)
}

// DeleteEmployee handles DELETE /api/employees/:id
func (h *EmployeeHandler) DeleteEmployee(c *gin.Context) {
	id := c.Param("id")

	err := h.service.DeleteEmployee(c.Request.Context(), id)
	if err != nil {
		if err == repository.ErrEmployeeNotFound {
			c.JSON(http.StatusNotFound, ErrorResponse{Error: err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// GetStats handles GET /api/employees/stats
func (h *EmployeeHandler) GetStats(c *gin.Context) {
	stats, err := h.service.GetStats(c.Request.Context())
	if err != nil {
		c.Error(err)
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Error fetching statistics: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, stats)
}

// AdvancedSearch handles GET /api/employees/search/advanced
// Combines multiple encrypted field queries (name AND salary range)
func (h *EmployeeHandler) AdvancedSearch(c *gin.Context) {
	name := c.Query("name")
	minSalaryStr := c.Query("minSalary")
	maxSalaryStr := c.Query("maxSalary")

	// At least one filter must be provided
	if name == "" && minSalaryStr == "" && maxSalaryStr == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "At least one search parameter is required"})
		return
	}

	var minSalary, maxSalary *int

	if minSalaryStr != "" {
		min, err := strconv.Atoi(minSalaryStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid minimum salary"})
			return
		}
		minSalary = &min
	}

	if maxSalaryStr != "" {
		max, err := strconv.Atoi(maxSalaryStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid maximum salary"})
			return
		}
		maxSalary = &max
	}

	employees, err := h.service.AdvancedSearch(c.Request.Context(), name, minSalary, maxSalary)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, employees)
}
