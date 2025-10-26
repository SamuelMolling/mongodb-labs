// Package models defines the data structures for the HR platform.
package models

import (
	"errors"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Department constants
const (
	DeptEngineering = "Engineering"
	DeptProduct     = "Product"
	DeptHR          = "HR"
	DeptMarketing   = "Marketing"
	DeptSales       = "Sales"
	DeptFinance     = "Finance"
)

// Position constants
const (
	PosSoftwareEngineer   = "Software Engineer"
	PosSeniorEngineer     = "Senior Software Engineer"
	PosProductManager     = "Product Manager"
	PosHRSpecialist       = "HR Specialist"
	PosMarketingManager   = "Marketing Manager"
	PosSalesRep           = "Sales Representative"
	PosFinancialAnalyst   = "Financial Analyst"
)

// Employee represents an employee document in the database.
// Fields marked with encryption are protected using MongoDB Queryable Encryption.
type Employee struct {
	ID primitive.ObjectID `json:"id" bson:"_id,omitempty"`

	// Basic Information
	Name  string `json:"name" bson:"name"`   // Encrypted with equality queries
	Email string `json:"email" bson:"email"` // Not encrypted (for demo purposes)

	// Sensitive Information (Encrypted)
	SSN    string `json:"ssn,omitempty" bson:"ssn"`       // Social Security Number - Encrypted with equality queries
	Salary int    `json:"salary,omitempty" bson:"salary"` // Encrypted with range queries

	// Job Information
	Position   string `json:"position" bson:"position"`
	Department string `json:"department" bson:"department"`
	Company    string `json:"company" bson:"company"`

	// Dates
	StartDate time.Time  `json:"startDate" bson:"startDate"`
	EndDate   *time.Time `json:"endDate,omitempty" bson:"endDate,omitempty"`

	// Metadata
	CreatedAt time.Time `json:"createdAt" bson:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt" bson:"updatedAt"`
}

// CreateEmployeeRequest represents the payload to create a new employee
type CreateEmployeeRequest struct {
	Name       string     `json:"name" binding:"required,min=2,max=100"`
	Email      string     `json:"email" binding:"required,email"`
	SSN        string     `json:"ssn" binding:"required,len=11"` // Format: XXX-XX-XXXX
	Salary     int        `json:"salary" binding:"required,min=0,max=10000000"`
	Position   string     `json:"position" binding:"required"`
	Department string     `json:"department" binding:"required"`
	Company    string     `json:"company" binding:"required"`
	StartDate  *time.Time `json:"startDate"`
}

// UpdateEmployeeRequest represents the payload to update an employee
type UpdateEmployeeRequest struct {
	Name       *string    `json:"name" binding:"omitempty,min=2,max=100"`
	Email      *string    `json:"email" binding:"omitempty,email"`
	Salary     *int       `json:"salary" binding:"omitempty,min=0,max=10000000"`
	Position   *string    `json:"position"`
	Department *string    `json:"department"`
	EndDate    *time.Time `json:"endDate"`
}

// EmployeeFilter represents search filters
type EmployeeFilter struct {
	Name       string
	Department string
	MinSalary  *int
	MaxSalary  *int
}

// Validate validates the employee data
func (e *Employee) Validate() error {
	if strings.TrimSpace(e.Name) == "" {
		return errors.New("employee name is required")
	}

	if strings.TrimSpace(e.Email) == "" {
		return errors.New("employee email is required")
	}

	if e.Salary < 0 {
		return errors.New("salary cannot be negative")
	}

	if strings.TrimSpace(e.Position) == "" {
		return errors.New("position is required")
	}

	if strings.TrimSpace(e.Department) == "" {
		return errors.New("department is required")
	}

	return nil
}

// ToEmployee converts CreateEmployeeRequest to Employee
func (r *CreateEmployeeRequest) ToEmployee() *Employee {
	now := time.Now()
	startDate := now
	if r.StartDate != nil {
		startDate = *r.StartDate
	}

	return &Employee{
		Name:       r.Name,
		Email:      r.Email,
		SSN:        r.SSN,
		Salary:     r.Salary,
		Position:   r.Position,
		Department: r.Department,
		Company:    r.Company,
		StartDate:  startDate,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}

// ApplyUpdates applies update request to employee
func (r *UpdateEmployeeRequest) ApplyUpdates(employee *Employee) {
	if r.Name != nil {
		employee.Name = *r.Name
	}
	if r.Email != nil {
		employee.Email = *r.Email
	}
	if r.Salary != nil {
		employee.Salary = *r.Salary
	}
	if r.Position != nil {
		employee.Position = *r.Position
	}
	if r.Department != nil {
		employee.Department = *r.Department
	}
	if r.EndDate != nil {
		employee.EndDate = r.EndDate
	}
	employee.UpdatedAt = time.Now()
}

// HasUpdates checks if there are any updates to apply
func (r *UpdateEmployeeRequest) HasUpdates() bool {
	return r.Name != nil || r.Email != nil || r.Salary != nil ||
		r.Position != nil || r.Department != nil || r.EndDate != nil
}

// SanitizedEmployee returns employee with sensitive data masked (for logging)
func (e *Employee) SanitizedEmployee() *Employee {
	sanitized := *e
	if len(sanitized.SSN) >= 4 {
		sanitized.SSN = "***-**-" + sanitized.SSN[len(sanitized.SSN)-4:]
	}
	return &sanitized
}
