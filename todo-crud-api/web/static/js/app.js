// API Base URL
const API_BASE = '/api/v1';

// State
let currentStatusFilter = 'all';
let currentPriorityFilter = '';

// Tab Management
function openTab(tabName) {
    const tabContents = document.getElementsByClassName('tab-content');
    for (let content of tabContents) {
        content.classList.remove('active');
    }

    const tabButtons = document.getElementsByClassName('tab-button');
    for (let button of tabButtons) {
        button.classList.remove('active');
    }

    document.getElementById(tabName).classList.add('active');

    // Find and activate the clicked button
    const clickedButton = Array.from(tabButtons).find(btn =>
        btn.textContent.includes(tabName === 'tasks' ? 'Tasks' :
                                 tabName === 'add' ? 'New' : 'About')
    );
    if (clickedButton) {
        clickedButton.classList.add('active');
    }

    if (tabName === 'tasks') {
        loadTasks();
    }
}

// Filter Management
function setStatusFilter(filter) {
    currentStatusFilter = filter;

    // Update button states
    const filterBtns = document.querySelectorAll('[data-filter]');
    filterBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    // Reload tasks from database with filter
    loadTasks();
}

function setPriorityFilter(priority) {
    // Toggle priority filter
    if (currentPriorityFilter === priority) {
        currentPriorityFilter = '';
    } else {
        currentPriorityFilter = priority;
    }

    // Update button states
    const priorityBtns = document.querySelectorAll('[data-priority]');
    priorityBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.priority === currentPriorityFilter);
    });

    // Reload tasks from database with filter
    loadTasks();
}

// Load Statistics
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/tasks/stats`);
        const data = await response.json();

        document.getElementById('totalTasks').textContent = data.total || 0;
        document.getElementById('pendingTasks').textContent = data.pending || 0;
        document.getElementById('completedTasks').textContent = data.completed || 0;
        document.getElementById('highPriorityTasks').textContent = data.highPriority || 0;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load Tasks
async function loadTasks() {
    const taskList = document.getElementById('taskList');
    taskList.innerHTML = '<div class="loading">Loading tasks...</div>';

    try {
        // Build query string with filters
        const params = new URLSearchParams();

        // Add status filter
        if (currentStatusFilter === 'completed') {
            params.append('completed', 'true');
        } else if (currentStatusFilter === 'pending') {
            params.append('completed', 'false');
        }

        // Add priority filter
        if (currentPriorityFilter) {
            params.append('priority', currentPriorityFilter);
        }

        // Build URL with query parameters
        const url = `${API_BASE}/tasks${params.toString() ? '?' + params.toString() : ''}`;
        console.log('Fetching tasks with URL:', url); // Debug log

        const response = await fetch(url);
        const tasks = await response.json();

        if (tasks.length === 0) {
            taskList.innerHTML = '<div class="empty-state">No tasks found</div>';
            return;
        }

        taskList.innerHTML = tasks.map(task => createTaskCard(task)).join('');
        loadStats();
    } catch (error) {
        console.error('Error loading tasks:', error);
        taskList.innerHTML = '<div class="result-message error">Error loading tasks</div>';
    }
}

// Create Simple Task Card
function createTaskCard(task) {
    const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US') : null;
    const isOverdue = task.dueDate && !task.completed && new Date(task.dueDate) < new Date();
    const priorityClass = `priority-${task.priority}`;

    // Priority icons and labels
    const priorityIcons = {
        'high': '🔴',
        'medium': '🟡',
        'low': '🔵'
    };

    return `
        <div class="task-card ${task.completed ? 'completed' : ''} ${priorityClass}">
            <div class="task-card-header">
                <h3 class="task-name">${escapeHtml(task.name)}</h3>
                <span class="priority-badge ${priorityClass}">
                    ${priorityIcons[task.priority]} ${task.priority.toUpperCase()}
                </span>
            </div>

            ${task.description ? `
                <p class="task-description">${escapeHtml(task.description)}</p>
            ` : ''}

            <div class="task-footer">
                <div class="task-info">
                    ${dueDate ? `
                        <span class="info-badge ${isOverdue ? 'overdue' : ''}">
                            📅 ${dueDate} ${isOverdue ? '⚠️' : ''}
                        </span>
                    ` : ''}
                    ${task.completed ? '<span class="info-badge success">✅ Completed</span>' : ''}
                </div>

                <div class="task-buttons">
                    <button class="btn-action btn-complete"
                            onclick="toggleTask('${task.id}')"
                            title="${task.completed ? 'Reopen task' : 'Mark as complete'}">
                        ${task.completed ? '↩️ Reopen' : '✓ Complete'}
                    </button>
                    <button class="btn-action btn-delete"
                            onclick="deleteTask('${task.id}')"
                            title="Delete task">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Add Task Form Handler
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('addTaskForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await addTask();
        });
    }

    // Load initial data
    loadTasks();
    loadStats();
});

// Add Task
async function addTask() {
    const resultDiv = document.getElementById('addResult');
    resultDiv.innerHTML = '';

    const formData = {
        name: document.getElementById('taskName').value,
        description: document.getElementById('taskDescription').value,
        priority: document.getElementById('taskPriority').value,
    };

    const dueDate = document.getElementById('taskDueDate').value;
    if (dueDate) {
        formData.dueDate = new Date(dueDate).toISOString();
    }

    try {
        const response = await fetch(`${API_BASE}/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData),
        });

        if (response.ok) {
            resultDiv.innerHTML = '<div class="result-message success">✅ Task added successfully!</div>';
            document.getElementById('addTaskForm').reset();
            loadStats();

            // Switch to tasks tab after 2 seconds
            setTimeout(() => {
                const tasksTab = Array.from(document.getElementsByClassName('tab-button'))
                    .find(btn => btn.textContent.includes('Tasks'));
                if (tasksTab) {
                    tasksTab.click();
                }
            }, 2000);
        } else {
            const error = await response.json();
            resultDiv.innerHTML = `<div class="result-message error">❌ Error: ${error.error}</div>`;
        }
    } catch (error) {
        console.error('Error adding task:', error);
        resultDiv.innerHTML = '<div class="result-message error">❌ Error adding task</div>';
    }
}

// Toggle Task
async function toggleTask(id) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${id}/toggle`, {
            method: 'PATCH',
        });

        if (response.ok) {
            loadTasks();
            loadStats();
        } else {
            alert('Error updating task');
        }
    } catch (error) {
        console.error('Error toggling task:', error);
        alert('Error updating task');
    }
}

// Delete Task
async function deleteTask(id) {
    if (!confirm('Are you sure you want to delete this task?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/tasks/${id}`, {
            method: 'DELETE',
        });

        if (response.ok) {
            loadTasks();
            loadStats();
        } else {
            alert('Error deleting task');
        }
    } catch (error) {
        console.error('Error deleting task:', error);
        alert('Error deleting task');
    }
}

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
