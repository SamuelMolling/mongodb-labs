// Package main provides a test script to generate multiple MongoDB queries
// This helps test the query logging functionality
package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"
)

const (
	baseURL = "http://localhost:8080/api/v1"
)

type Task struct {
	ID          string     `json:"id,omitempty"`
	Name        string     `json:"name"`
	Description string     `json:"description,omitempty"`
	Priority    string     `json:"priority"`
	Completed   bool       `json:"completed"`
	DueDate     *time.Time `json:"dueDate,omitempty"`
}

func main() {
	log.Println("Starting MongoDB query test script...")
	log.Println("Make sure the API server is running on port 8080")
	time.Sleep(2 * time.Second)

	// Test 1: Create multiple tasks
	log.Println("\n=== Test 1: Creating tasks ===")
	taskIDs := createMultipleTasks()

	// Test 2: Get all tasks
	log.Println("\n=== Test 2: Getting all tasks ===")
	getAllTasks("")

	// Test 3: Filter by status
	log.Println("\n=== Test 3: Filtering by completed status ===")
	getAllTasks("?completed=true")
	time.Sleep(1 * time.Second)

	log.Println("\n=== Test 4: Filtering by pending status ===")
	getAllTasks("?completed=false")
	time.Sleep(1 * time.Second)

	// Test 5: Filter by priority
	log.Println("\n=== Test 5: Filtering by high priority ===")
	getAllTasks("?priority=high")
	time.Sleep(1 * time.Second)

	log.Println("\n=== Test 6: Filtering by medium priority ===")
	getAllTasks("?priority=medium")
	time.Sleep(1 * time.Second)

	log.Println("\n=== Test 7: Filtering by low priority ===")
	getAllTasks("?priority=low")
	time.Sleep(1 * time.Second)

	// Test 8: Combined filters
	log.Println("\n=== Test 8: Combined filter (completed + high priority) ===")
	getAllTasks("?completed=true&priority=high")
	time.Sleep(1 * time.Second)

	// Test 9: Get statistics (multiple aggregate queries)
	log.Println("\n=== Test 9: Getting statistics ===")
	getStats()
	time.Sleep(1 * time.Second)

	// Test 10: Update tasks (toggle completion)
	log.Println("\n=== Test 10: Toggling task completion ===")
	for i, id := range taskIDs {
		if i >= 3 { // Toggle first 3 tasks
			break
		}
		toggleTask(id)
		time.Sleep(500 * time.Millisecond)
	}

	// Test 11: Get tasks by ID
	log.Println("\n=== Test 11: Getting individual tasks ===")
	for i, id := range taskIDs {
		if i >= 2 { // Get first 2 tasks
			break
		}
		getTaskByID(id)
		time.Sleep(500 * time.Millisecond)
	}

	// Test 12: Update tasks
	log.Println("\n=== Test 12: Updating tasks ===")
	if len(taskIDs) > 0 {
		updateTask(taskIDs[0])
	}

	// Test 13: Get all tasks again to see changes
	log.Println("\n=== Test 13: Getting all tasks after updates ===")
	getAllTasks("")

	// Test 14: Delete some tasks
	log.Println("\n=== Test 14: Deleting tasks ===")
	for i, id := range taskIDs {
		if i >= 2 { // Delete first 2 tasks
			break
		}
		deleteTask(id)
		time.Sleep(500 * time.Millisecond)
	}

	// Test 15: Final statistics
	log.Println("\n=== Test 15: Final statistics ===")
	getStats()

	log.Println("\n=== Test completed! ===")
	log.Println("Check the server logs to see all MongoDB queries")
}

func createMultipleTasks() []string {
	futureDate := time.Now().AddDate(0, 0, 7)
	anotherFutureDate := time.Now().AddDate(0, 0, 14)

	tasks := []Task{
		{Name: "Test High Priority 1", Description: "Test task with high priority", Priority: "high", Completed: false},
		{Name: "Test High Priority 2", Description: "Another high priority task", Priority: "high", Completed: true},
		{Name: "Test Medium Priority 1", Description: "Test task with medium priority", Priority: "medium", Completed: false},
		{Name: "Test Medium Priority 2", Description: "Another medium priority task", Priority: "medium", Completed: true},
		{Name: "Test Low Priority 1", Description: "Test task with low priority", Priority: "low", Completed: false},
		{Name: "Test Low Priority 2", Description: "Another low priority task", Priority: "low", Completed: true},
		{Name: "Future Task 1", Description: "Task with future due date (7 days)", Priority: "high", Completed: false, DueDate: &futureDate},
		{Name: "Future Task 2", Description: "Task with future due date (14 days)", Priority: "medium", Completed: false, DueDate: &anotherFutureDate},
	}

	var taskIDs []string
	for i, task := range tasks {
		log.Printf("Creating task %d: %s", i+1, task.Name)
		id := createTask(task)
		if id != "" {
			taskIDs = append(taskIDs, id)
		}
		time.Sleep(300 * time.Millisecond)
	}

	return taskIDs
}

func createTask(task Task) string {
	jsonData, err := json.Marshal(task)
	if err != nil {
		log.Printf("Error marshaling task: %v", err)
		return ""
	}

	resp, err := http.Post(baseURL+"/tasks", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("Error creating task: %v", err)
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("Failed to create task: %s", string(body))
		return ""
	}

	var createdTask Task
	if err := json.NewDecoder(resp.Body).Decode(&createdTask); err != nil {
		log.Printf("Error decoding response: %v", err)
		return ""
	}

	log.Printf("✓ Created task: %s (ID: %s)", createdTask.Name, createdTask.ID)
	return createdTask.ID
}

func getAllTasks(queryParams string) {
	resp, err := http.Get(baseURL + "/tasks" + queryParams)
	if err != nil {
		log.Printf("Error getting tasks: %v", err)
		return
	}
	defer resp.Body.Close()

	var tasks []Task
	if err := json.NewDecoder(resp.Body).Decode(&tasks); err != nil {
		log.Printf("Error decoding tasks: %v", err)
		return
	}

	log.Printf("✓ Retrieved %d tasks with query: %s", len(tasks), queryParams)
}

func getTaskByID(id string) {
	resp, err := http.Get(baseURL + "/tasks/" + id)
	if err != nil {
		log.Printf("Error getting task: %v", err)
		return
	}
	defer resp.Body.Close()

	var task Task
	if err := json.NewDecoder(resp.Body).Decode(&task); err != nil {
		log.Printf("Error decoding task: %v", err)
		return
	}

	log.Printf("✓ Retrieved task: %s", task.Name)
}

func toggleTask(id string) {
	req, err := http.NewRequest(http.MethodPatch, baseURL+"/tasks/"+id+"/toggle", nil)
	if err != nil {
		log.Printf("Error creating request: %v", err)
		return
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("Error toggling task: %v", err)
		return
	}
	defer resp.Body.Close()

	log.Printf("✓ Toggled task: %s", id)
}

func updateTask(id string) {
	futureDate := time.Now().AddDate(0, 0, 30)
	updateData := Task{
		Name:        "Updated Task Name",
		Description: "This task has been updated by the test script",
		Priority:    "high",
		Completed:   true,
		DueDate:     &futureDate,
	}

	jsonData, err := json.Marshal(updateData)
	if err != nil {
		log.Printf("Error marshaling update: %v", err)
		return
	}

	req, err := http.NewRequest(http.MethodPut, baseURL+"/tasks/"+id, bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("Error creating request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("Error updating task: %v", err)
		return
	}
	defer resp.Body.Close()

	log.Printf("✓ Updated task: %s", id)
}

func deleteTask(id string) {
	req, err := http.NewRequest(http.MethodDelete, baseURL+"/tasks/"+id, nil)
	if err != nil {
		log.Printf("Error creating request: %v", err)
		return
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("Error deleting task: %v", err)
		return
	}
	defer resp.Body.Close()

	log.Printf("✓ Deleted task: %s", id)
}

func getStats() {
	resp, err := http.Get(baseURL + "/tasks/stats")
	if err != nil {
		log.Printf("Error getting stats: %v", err)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Error reading stats: %v", err)
		return
	}

	log.Printf("✓ Retrieved statistics: %s", string(body))
}
