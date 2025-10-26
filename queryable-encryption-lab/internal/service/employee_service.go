// Package service contains the business logic layer of the application.
package service

import (
	"context"
	"fmt"
	"log"

	"queryable-encryption-lab/internal/models"
	"queryable-encryption-lab/internal/repository"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// EmployeeService defines the interface for employee business logic
type EmployeeService interface {
	CreateEmployee(ctx context.Context, req *models.CreateEmployeeRequest) (*models.Employee, error)
	GetAllEmployees(ctx context.Context, filter *models.EmployeeFilter) ([]*models.Employee, error)
	GetEmployeeByID(ctx context.Context, id string) (*models.Employee, error)
	SearchByName(ctx context.Context, name string) ([]*models.Employee, error)
	SearchBySSN(ctx context.Context, ssn string) (*models.Employee, error)
	SearchBySalaryRange(ctx context.Context, minSalary, maxSalary int) ([]*models.Employee, error)
	AdvancedSearch(ctx context.Context, name string, minSalary, maxSalary *int) ([]*models.Employee, error)
	UpdateEmployee(ctx context.Context, id string, req *models.UpdateEmployeeRequest) (*models.Employee, error)
	DeleteEmployee(ctx context.Context, id string) error
	GetStats(ctx context.Context) (*EmployeeStats, error)
}

// EmployeeStats contains employee statistics
type EmployeeStats struct {
	TotalEmployees int64 `json:"totalEmployees"`
}

type employeeService struct {
	repo repository.EmployeeRepository
}

// NewEmployeeService creates a new employee service
func NewEmployeeService(repo repository.EmployeeRepository) EmployeeService {
	return &employeeService{
		repo: repo,
	}
}

// CreateEmployee creates a new employee
func (s *employeeService) CreateEmployee(ctx context.Context, req *models.CreateEmployeeRequest) (*models.Employee, error) {
	employee := req.ToEmployee()

	if err := employee.Validate(); err != nil {
		return nil, fmt.Errorf("validation error: %w", err)
	}

	if err := s.repo.Create(ctx, employee); err != nil {
		return nil, fmt.Errorf("error creating employee: %w", err)
	}

	log.Printf("Employee created successfully: %s", employee.SanitizedEmployee().Name)
	return employee, nil
}

// GetAllEmployees retrieves all employees with optional filtering
func (s *employeeService) GetAllEmployees(ctx context.Context, filter *models.EmployeeFilter) ([]*models.Employee, error) {
	employees, err := s.repo.FindAll(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("error fetching employees: %w", err)
	}
	return employees, nil
}

// GetEmployeeByID retrieves an employee by ID
func (s *employeeService) GetEmployeeByID(ctx context.Context, id string) (*models.Employee, error) {
	objectID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, fmt.Errorf("invalid employee ID format: %w", err)
	}

	employee, err := s.repo.FindByID(ctx, objectID)
	if err != nil {
		log.Printf("Error fetching employee: %v", err)
		return nil, err
	}

	return employee, nil
}

// SearchByName searches for employees by name (encrypted equality search)
func (s *employeeService) SearchByName(ctx context.Context, name string) ([]*models.Employee, error) {
	employees, err := s.repo.FindByName(ctx, name)
	if err != nil {
		return nil, fmt.Errorf("error searching by name: %w", err)
	}
	return employees, nil
}

// SearchBySSN searches for an employee by SSN (encrypted equality search)
func (s *employeeService) SearchBySSN(ctx context.Context, ssn string) (*models.Employee, error) {
	employee, err := s.repo.FindBySSN(ctx, ssn)
	if err != nil {
		log.Printf("Error searching by SSN: %v", err)
		return nil, err
	}
	return employee, nil
}

// SearchBySalaryRange searches for employees within a salary range (encrypted range query)
func (s *employeeService) SearchBySalaryRange(ctx context.Context, minSalary, maxSalary int) ([]*models.Employee, error) {
	if minSalary < 0 || maxSalary < 0 {
		return nil, fmt.Errorf("salary values cannot be negative")
	}
	if minSalary > maxSalary {
		return nil, fmt.Errorf("minimum salary cannot be greater than maximum salary")
	}

	employees, err := s.repo.FindBySalaryRange(ctx, minSalary, maxSalary)
	if err != nil {
		return nil, fmt.Errorf("error searching by salary range: %w", err)
	}
	return employees, nil
}

// AdvancedSearch performs a combined search on encrypted fields (name AND salary range)
func (s *employeeService) AdvancedSearch(ctx context.Context, name string, minSalary, maxSalary *int) ([]*models.Employee, error) {
	// Validate salary range if provided
	if minSalary != nil && maxSalary != nil {
		if *minSalary < 0 || *maxSalary < 0 {
			return nil, fmt.Errorf("salary values cannot be negative")
		}
		if *minSalary > *maxSalary {
			return nil, fmt.Errorf("minimum salary cannot be greater than maximum salary")
		}
	}

	employees, err := s.repo.AdvancedSearch(ctx, name, minSalary, maxSalary)
	if err != nil {
		return nil, fmt.Errorf("error performing advanced search: %w", err)
	}
	return employees, nil
}

// UpdateEmployee updates an existing employee
func (s *employeeService) UpdateEmployee(ctx context.Context, id string, req *models.UpdateEmployeeRequest) (*models.Employee, error) {
	objectID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, fmt.Errorf("invalid employee ID format: %w", err)
	}

	if !req.HasUpdates() {
		return nil, fmt.Errorf("no updates provided")
	}

	employee, err := s.repo.FindByID(ctx, objectID)
	if err != nil {
		return nil, err
	}

	req.ApplyUpdates(employee)

	if err := employee.Validate(); err != nil {
		return nil, fmt.Errorf("validation error: %w", err)
	}

	if err := s.repo.Update(ctx, objectID, employee); err != nil {
		return nil, fmt.Errorf("error updating employee: %w", err)
	}

	log.Printf("Employee updated successfully: %s", employee.SanitizedEmployee().Name)
	return employee, nil
}

// DeleteEmployee deletes an employee
func (s *employeeService) DeleteEmployee(ctx context.Context, id string) error {
	objectID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return fmt.Errorf("invalid employee ID format: %w", err)
	}

	if err := s.repo.Delete(ctx, objectID); err != nil {
		log.Printf("Error deleting employee: %v", err)
		return err
	}

	log.Printf("Employee deleted successfully: ID %s", id)
	return nil
}

// GetStats returns employee statistics
func (s *employeeService) GetStats(ctx context.Context) (*EmployeeStats, error) {
	count, err := s.repo.Count(ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting stats: %w", err)
	}

	return &EmployeeStats{
		TotalEmployees: count,
	}, nil
}
