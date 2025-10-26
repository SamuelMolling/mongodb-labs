// Package repository provides data access layer for MongoDB operations with encryption.
package repository

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"time"

	"queryable-encryption-lab/internal/models"
)

// SeedData contains sample data for seeding
type SeedData struct {
	FirstNames  []string
	LastNames   []string
	Positions   []string
	Departments []string
	Companies   []string
}

// GetSeedData returns sample data for generating employees
func GetSeedData() *SeedData {
	return &SeedData{
		FirstNames: []string{
			"Alice", "Bob", "Charlie", "Diana", "Evan", "Fiona", "George", "Hannah",
			"Ivan", "Julia", "Kevin", "Laura", "Michael", "Nancy", "Oliver", "Patricia",
			"Quinn", "Rachel", "Samuel", "Teresa", "Uma", "Victor", "Wendy", "Xavier",
			"Yara", "Zachary", "Sophia", "Liam", "Emma", "Noah", "Olivia", "Elijah",
			"Charlotte", "James", "Amelia", "Benjamin", "Mia", "Lucas", "Harper", "Mason",
			"Evelyn", "Ethan", "Abigail", "Alexander", "Emily", "Henry", "Ella", "Jacob",
			"Elizabeth", "William",
		},
		LastNames: []string{
			"Johnson", "Smith", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor",
			"Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Garcia",
			"Martinez", "Robinson", "Clark", "Rodriguez", "Lewis", "Lee", "Walker", "Hall",
			"Allen", "Young", "King", "Wright", "Lopez", "Hill", "Scott", "Green",
			"Adams", "Baker", "Nelson", "Carter", "Mitchell", "Perez", "Roberts", "Turner",
			"Phillips", "Campbell", "Parker", "Evans", "Edwards", "Collins", "Stewart", "Sanchez",
			"Morris", "Rogers",
		},
		Positions: []string{
			models.PosSoftwareEngineer,
			models.PosSeniorEngineer,
			models.PosProductManager,
			models.PosHRSpecialist,
			models.PosMarketingManager,
			models.PosSalesRep,
			models.PosFinancialAnalyst,
			"Junior Software Engineer",
			"Senior Product Manager",
			"Data Scientist",
			"DevOps Engineer",
			"QA Engineer",
			"Technical Writer",
			"UX Designer",
			"Recruitment Specialist",
			"Content Marketing Manager",
			"Account Executive",
			"Business Analyst",
		},
		Departments: []string{
			models.DeptEngineering,
			models.DeptProduct,
			models.DeptHR,
			models.DeptMarketing,
			models.DeptSales,
			models.DeptFinance,
		},
		Companies: []string{
			"MongoDB Inc.",
			"Tech Innovations Ltd",
			"Digital Solutions Corp",
			"Cloud Systems LLC",
			"Data Dynamics Inc",
			"Future Technologies",
		},
	}
}

// SeedEmployees creates sample employee data
func (r *employeeRepository) SeedEmployees(ctx context.Context, count int) error {
	log.Printf("Seeding %d employees...", count)

	seedData := GetSeedData()
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	startTime := time.Now()

	for i := 0; i < count; i++ {
		employee := generateRandomEmployee(i, seedData, rng)

		if err := r.Create(ctx, employee); err != nil {
			return fmt.Errorf("error seeding employee %d: %w", i+1, err)
		}

		// Log progress every 10 employees
		if (i+1)%10 == 0 {
			log.Printf("Seeded %d/%d employees...", i+1, count)
		}
	}

	duration := time.Since(startTime)
	log.Printf("Successfully seeded %d employees in %v", count, duration)

	return nil
}

// generateRandomEmployee generates a random employee with realistic data
func generateRandomEmployee(index int, data *SeedData, rng *rand.Rand) *models.Employee {
	now := time.Now()

	// Generate random name
	firstName := data.FirstNames[rng.Intn(len(data.FirstNames))]
	lastName := data.LastNames[rng.Intn(len(data.LastNames))]
	fullName := fmt.Sprintf("%s %s", firstName, lastName)

	// Generate SSN (format: XXX-XX-XXXX)
	ssn := fmt.Sprintf("%03d-%02d-%04d",
		rng.Intn(900)+100, // First 3 digits: 100-999
		rng.Intn(90)+10,   // Middle 2 digits: 10-99
		rng.Intn(9000)+1000, // Last 4 digits: 1000-9999
	)

	// Generate email
	email := fmt.Sprintf("%s.%s@example.com",
		firstName,
		lastName,
	)

	// Generate realistic salary based on position
	position := data.Positions[rng.Intn(len(data.Positions))]
	salary := generateSalaryForPosition(position, rng)

	// Random department and company
	department := data.Departments[rng.Intn(len(data.Departments))]
	company := data.Companies[rng.Intn(len(data.Companies))]

	// Generate start date (between 1-5 years ago)
	daysAgo := rng.Intn(365 * 5) // Up to 5 years ago
	startDate := now.AddDate(0, 0, -daysAgo)

	return &models.Employee{
		Name:       fullName,
		Email:      email,
		SSN:        ssn,
		Salary:     salary,
		Position:   position,
		Department: department,
		Company:    company,
		StartDate:  startDate,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}

// generateSalaryForPosition generates a realistic salary based on position
func generateSalaryForPosition(position string, rng *rand.Rand) int {
	baseSalaries := map[string]int{
		"Junior Software Engineer":          70000,
		models.PosSoftwareEngineer:          100000,
		models.PosSeniorEngineer:            150000,
		"Data Scientist":                    120000,
		"DevOps Engineer":                   110000,
		"QA Engineer":                       85000,
		models.PosProductManager:            140000,
		"Senior Product Manager":            180000,
		models.PosHRSpecialist:              75000,
		"Recruitment Specialist":            70000,
		models.PosMarketingManager:          95000,
		"Content Marketing Manager":         85000,
		models.PosSalesRep:                  80000,
		"Account Executive":                 90000,
		models.PosFinancialAnalyst:          85000,
		"Business Analyst":                  90000,
		"Technical Writer":                  75000,
		"UX Designer":                       95000,
	}

	baseSalary, exists := baseSalaries[position]
	if !exists {
		baseSalary = 80000 // Default
	}

	// Add some variation (±20%)
	variation := int(float64(baseSalary) * 0.2)
	randomVariation := rng.Intn(2*variation) - variation

	return baseSalary + randomVariation
}
