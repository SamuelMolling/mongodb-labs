// Package repository provides data access layer for MongoDB operations with encryption.
package repository

import (
	"context"
	"errors"
	"fmt"
	"log"

	"queryable-encryption-lab/internal/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Error constants
var (
	ErrEmployeeNotFound = errors.New("employee not found")
)

// EmployeeRepository defines the interface for employee database operations
type EmployeeRepository interface {
	Create(ctx context.Context, employee *models.Employee) error
	FindAll(ctx context.Context, filter *models.EmployeeFilter) ([]*models.Employee, error)
	FindByID(ctx context.Context, id primitive.ObjectID) (*models.Employee, error)
	FindByName(ctx context.Context, name string) ([]*models.Employee, error)
	FindBySSN(ctx context.Context, ssn string) (*models.Employee, error)
	FindBySalaryRange(ctx context.Context, minSalary, maxSalary int) ([]*models.Employee, error)
	AdvancedSearch(ctx context.Context, name string, minSalary, maxSalary *int) ([]*models.Employee, error)
	Update(ctx context.Context, id primitive.ObjectID, employee *models.Employee) error
	Delete(ctx context.Context, id primitive.ObjectID) error
	Count(ctx context.Context) (int64, error)
	SeedEmployees(ctx context.Context, count int) error
}

type employeeRepository struct {
	collection *mongo.Collection
}

// NewEmployeeRepository creates a new employee repository
func NewEmployeeRepository(db *mongo.Database, collectionName string) EmployeeRepository {
	return &employeeRepository{
		collection: db.Collection(collectionName),
	}
}

// Create inserts a new employee document
func (r *employeeRepository) Create(ctx context.Context, employee *models.Employee) error {
	if employee.ID.IsZero() {
		employee.ID = primitive.NewObjectID()
	}

	_, err := r.collection.InsertOne(ctx, employee)
	if err != nil {
		return fmt.Errorf("error creating employee: %w", err)
	}

	log.Printf("Employee created: %s (ID: %s)", employee.Name, employee.ID.Hex())
	return nil
}

// FindAll retrieves all employees with optional filtering
func (r *employeeRepository) FindAll(ctx context.Context, filter *models.EmployeeFilter) ([]*models.Employee, error) {
	bsonFilter := bson.M{}

	if filter != nil {
		// Note: Name filtering requires encrypted search
		if filter.Name != "" {
			bsonFilter["name"] = filter.Name
		}

		if filter.Department != "" {
			bsonFilter["department"] = filter.Department
		}

		// Salary range filtering using encrypted range queries
		if filter.MinSalary != nil || filter.MaxSalary != nil {
			salaryFilter := bson.M{}
			if filter.MinSalary != nil {
				salaryFilter["$gte"] = *filter.MinSalary
			}
			if filter.MaxSalary != nil {
				salaryFilter["$lte"] = *filter.MaxSalary
			}
			bsonFilter["salary"] = salaryFilter
		}
	}

	opts := options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}})
	cursor, err := r.collection.Find(ctx, bsonFilter, opts)
	if err != nil {
		return nil, fmt.Errorf("error finding employees: %w", err)
	}
	defer func() {
		if err := cursor.Close(ctx); err != nil {
			log.Printf("Error closing cursor: %v", err)
		}
	}()

	var employees []*models.Employee
	if err := cursor.All(ctx, &employees); err != nil {
		return nil, fmt.Errorf("error decoding employees: %w", err)
	}

	if employees == nil {
		employees = []*models.Employee{}
	}

	return employees, nil
}

// FindByID retrieves an employee by ID
func (r *employeeRepository) FindByID(ctx context.Context, id primitive.ObjectID) (*models.Employee, error) {
	var employee models.Employee
	err := r.collection.FindOne(ctx, bson.M{"_id": id}).Decode(&employee)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrEmployeeNotFound
		}
		return nil, fmt.Errorf("error finding employee by ID: %w", err)
	}

	return &employee, nil
}

// FindByName retrieves employees by name using encrypted equality search
// This demonstrates queryable encryption with equality queries
func (r *employeeRepository) FindByName(ctx context.Context, name string) ([]*models.Employee, error) {
	filter := bson.M{"name": name}
	cursor, err := r.collection.Find(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("error finding employees by name: %w", err)
	}
	defer func() {
		if err := cursor.Close(ctx); err != nil {
			log.Printf("Error closing cursor: %v", err)
		}
	}()

	var employees []*models.Employee
	if err := cursor.All(ctx, &employees); err != nil {
		return nil, fmt.Errorf("error decoding employees: %w", err)
	}

	if employees == nil {
		employees = []*models.Employee{}
	}

	return employees, nil
}

// FindBySSN retrieves an employee by SSN using encrypted equality search
// This demonstrates searching on encrypted sensitive data
func (r *employeeRepository) FindBySSN(ctx context.Context, ssn string) (*models.Employee, error) {
	var employee models.Employee
	filter := bson.M{"ssn": ssn}
	err := r.collection.FindOne(ctx, filter).Decode(&employee)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrEmployeeNotFound
		}
		return nil, fmt.Errorf("error finding employee by SSN: %w", err)
	}

	return &employee, nil
}

// FindBySalaryRange retrieves employees within a salary range using encrypted range queries
// This demonstrates queryable encryption with range queries
func (r *employeeRepository) FindBySalaryRange(ctx context.Context, minSalary, maxSalary int) ([]*models.Employee, error) {
	filter := bson.M{
		"salary": bson.M{
			"$gte": minSalary,
			"$lte": maxSalary,
		},
	}

	cursor, err := r.collection.Find(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("error finding employees by salary range: %w", err)
	}
	defer func() {
		if err := cursor.Close(ctx); err != nil {
			log.Printf("Error closing cursor: %v", err)
		}
	}()

	var employees []*models.Employee
	if err := cursor.All(ctx, &employees); err != nil {
		return nil, fmt.Errorf("error decoding employees: %w", err)
	}

	if employees == nil {
		employees = []*models.Employee{}
	}

	return employees, nil
}

// AdvancedSearch combines multiple encrypted field queries (name AND salary range)
// This demonstrates combining equality queries with range queries on encrypted fields
func (r *employeeRepository) AdvancedSearch(ctx context.Context, name string, minSalary, maxSalary *int) ([]*models.Employee, error) {
	filter := bson.M{}

	// Add name filter if provided (encrypted equality query)
	if name != "" {
		filter["name"] = name
	}

	// Add salary range filter if provided (encrypted range query)
	if minSalary != nil || maxSalary != nil {
		salaryFilter := bson.M{}
		if minSalary != nil {
			salaryFilter["$gte"] = *minSalary
		}
		if maxSalary != nil {
			salaryFilter["$lte"] = *maxSalary
		}
		filter["salary"] = salaryFilter
	}

	cursor, err := r.collection.Find(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("error performing advanced search: %w", err)
	}
	defer func() {
		if err := cursor.Close(ctx); err != nil {
			log.Printf("Error closing cursor: %v", err)
		}
	}()

	var employees []*models.Employee
	if err := cursor.All(ctx, &employees); err != nil {
		return nil, fmt.Errorf("error decoding employees: %w", err)
	}

	if employees == nil {
		employees = []*models.Employee{}
	}

	return employees, nil
}

// Update updates an existing employee
func (r *employeeRepository) Update(ctx context.Context, id primitive.ObjectID, employee *models.Employee) error {
	filter := bson.M{"_id": id}
	update := bson.M{"$set": employee}

	result, err := r.collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return fmt.Errorf("error updating employee: %w", err)
	}

	if result.MatchedCount == 0 {
		return ErrEmployeeNotFound
	}

	log.Printf("Employee updated: %s (ID: %s)", employee.Name, id.Hex())
	return nil
}

// Delete removes an employee from the database
func (r *employeeRepository) Delete(ctx context.Context, id primitive.ObjectID) error {
	result, err := r.collection.DeleteOne(ctx, bson.M{"_id": id})
	if err != nil {
		return fmt.Errorf("error deleting employee: %w", err)
	}

	if result.DeletedCount == 0 {
		return ErrEmployeeNotFound
	}

	log.Printf("Employee deleted: ID %s", id.Hex())
	return nil
}

// Count returns the total number of employees
func (r *employeeRepository) Count(ctx context.Context) (int64, error) {
	count, err := r.collection.CountDocuments(ctx, bson.M{})
	if err != nil {
		return 0, fmt.Errorf("error counting employees: %w", err)
	}
	return count, nil
}
