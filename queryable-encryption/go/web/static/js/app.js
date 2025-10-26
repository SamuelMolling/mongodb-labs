// API Base URL
const API_BASE = '/api';

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
    event.target.classList.add('active');

    if (tabName === 'employees') {
        loadEmployees();
    }
}

// Search Sub-Tab Management
function openSearchTab(tabName) {
    const subTabContents = document.getElementsByClassName('sub-tab-content');
    for (let content of subTabContents) {
        content.classList.remove('active');
    }

    const subTabButtons = document.getElementsByClassName('sub-tab-button');
    for (let button of subTabButtons) {
        button.classList.remove('active');
    }

    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');

    // Clear search results when switching tabs
    document.getElementById('searchResults').innerHTML = '';
}

// Load Statistics
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/employees/stats`);
        const data = await response.json();
        document.getElementById('totalEmployees').textContent = data.totalEmployees || 0;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load Employees
async function loadEmployees() {
    const employeeList = document.getElementById('employeeList');
    employeeList.innerHTML = '<div class="loading">Loading employees...</div>';

    try {
        const department = document.getElementById('departmentFilter').value;
        const url = department
            ? `${API_BASE}/employees?department=${encodeURIComponent(department)}`
            : `${API_BASE}/employees`;

        const response = await fetch(url);
        const employees = await response.json();

        if (employees.length === 0) {
            employeeList.innerHTML = '<div class="loading">No employees found</div>';
            return;
        }

        employeeList.innerHTML = employees.map(emp => createEmployeeCard(emp)).join('');
        loadStats();
    } catch (error) {
        console.error('Error loading employees:', error);
        employeeList.innerHTML = '<div class="result-message error">Error loading employees</div>';
    }
}

// Create Employee Card HTML
function createEmployeeCard(employee) {
    const startDate = new Date(employee.startDate).toLocaleDateString();
    const createdAt = new Date(employee.createdAt).toLocaleDateString();

    return `
        <div class="employee-card">
            <div class="employee-header">
                <div class="employee-name">${escapeHtml(employee.name)}</div>
                <div class="employee-badge">${escapeHtml(employee.department)}</div>
            </div>
            <div class="employee-details">
                <div class="employee-detail">
                    <span class="employee-detail-label">Position</span>
                    <span class="employee-detail-value">${escapeHtml(employee.position)}</span>
                </div>
                <div class="employee-detail">
                    <span class="employee-detail-label">Email</span>
                    <span class="employee-detail-value">${escapeHtml(employee.email)}</span>
                </div>
                <div class="employee-detail">
                    <span class="employee-detail-label">SSN (Encrypted) 🔒</span>
                    <span class="employee-detail-value encrypted-field">${maskSSN(employee.ssn)}</span>
                </div>
                <div class="employee-detail">
                    <span class="employee-detail-label">Salary (Encrypted) 🔒</span>
                    <span class="employee-detail-value encrypted-field">$${formatNumber(employee.salary)}</span>
                </div>
                <div class="employee-detail">
                    <span class="employee-detail-label">Company</span>
                    <span class="employee-detail-value">${escapeHtml(employee.company)}</span>
                </div>
                <div class="employee-detail">
                    <span class="employee-detail-label">Start Date</span>
                    <span class="employee-detail-value">${startDate}</span>
                </div>
            </div>
            <div class="employee-actions">
                <button class="btn btn-danger" onclick="deleteEmployee('${employee.id}')">Delete</button>
            </div>
        </div>
    `;
}

// Add Employee Form Handler
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('addEmployeeForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await addEmployee();
        });
    }

    // Load initial data
    loadEmployees();
    loadStats();
});

// Add Employee
async function addEmployee() {
    const resultDiv = document.getElementById('addResult');
    resultDiv.innerHTML = '';

    const formData = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        ssn: document.getElementById('ssn').value,
        salary: parseInt(document.getElementById('salary').value),
        position: document.getElementById('position').value,
        department: document.getElementById('department').value,
        company: document.getElementById('company').value,
    };

    const startDate = document.getElementById('startDate').value;
    if (startDate) {
        formData.startDate = new Date(startDate).toISOString();
    }

    try {
        const response = await fetch(`${API_BASE}/employees`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData),
        });

        if (response.ok) {
            resultDiv.innerHTML = '<div class="result-message success">✅ Employee added successfully!</div>';
            document.getElementById('addEmployeeForm').reset();
            loadStats();

            // Switch to employees tab after 2 seconds
            setTimeout(() => {
                const employeesTab = Array.from(document.getElementsByClassName('tab-button'))
                    .find(btn => btn.textContent.includes('Employees'));
                if (employeesTab) {
                    employeesTab.click();
                }
            }, 2000);
        } else {
            const error = await response.json();
            resultDiv.innerHTML = `<div class="result-message error">❌ Error: ${error.error}</div>`;
        }
    } catch (error) {
        console.error('Error adding employee:', error);
        resultDiv.innerHTML = '<div class="result-message error">❌ Error adding employee</div>';
    }
}

// Delete Employee
async function deleteEmployee(id) {
    if (!confirm('Are you sure you want to delete this employee?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/employees/${id}`, {
            method: 'DELETE',
        });

        if (response.ok) {
            loadEmployees();
            loadStats();
        } else {
            alert('Error deleting employee');
        }
    } catch (error) {
        console.error('Error deleting employee:', error);
        alert('Error deleting employee');
    }
}

// Search by Name (Encrypted Equality Query)
async function searchByName() {
    const name = document.getElementById('searchName').value.trim();
    if (!name) {
        alert('Please enter a name to search');
        return;
    }

    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '<div class="loading">Searching encrypted field...</div>';

    try {
        const response = await fetch(`${API_BASE}/employees/search/name/${encodeURIComponent(name)}`);
        const employees = await response.json();

        if (employees.length === 0) {
            resultsDiv.innerHTML = '<div class="result-message">No employees found with that name</div>';
            return;
        }

        resultsDiv.innerHTML = `
            <h3>🔐 Search Results (Encrypted Field)</h3>
            <p>Found ${employees.length} employee(s) using encrypted equality query</p>
            ${employees.map(emp => createEmployeeCard(emp)).join('')}
        `;
    } catch (error) {
        console.error('Error searching by name:', error);
        resultsDiv.innerHTML = '<div class="result-message error">Error searching</div>';
    }
}

// Search by SSN (Encrypted Equality Query)
async function searchBySSN() {
    const ssn = document.getElementById('searchSSN').value.trim();
    if (!ssn) {
        alert('Please enter an SSN to search');
        return;
    }

    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '<div class="loading">Searching encrypted field...</div>';

    try {
        const response = await fetch(`${API_BASE}/employees/search/ssn/${encodeURIComponent(ssn)}`);

        if (response.status === 404) {
            resultsDiv.innerHTML = '<div class="result-message">No employee found with that SSN</div>';
            return;
        }

        const employee = await response.json();
        resultsDiv.innerHTML = `
            <h3>🔐 Search Results (Encrypted Field)</h3>
            <p>Found 1 employee using encrypted equality query on SSN</p>
            ${createEmployeeCard(employee)}
        `;
    } catch (error) {
        console.error('Error searching by SSN:', error);
        resultsDiv.innerHTML = '<div class="result-message error">Error searching</div>';
    }
}

// Search by Salary Range (Encrypted Range Query)
async function searchBySalary() {
    const minSalary = document.getElementById('minSalary').value;
    const maxSalary = document.getElementById('maxSalary').value;

    if (!minSalary || !maxSalary) {
        alert('Please enter both minimum and maximum salary');
        return;
    }

    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '<div class="loading">Searching encrypted field...</div>';

    try {
        const response = await fetch(
            `${API_BASE}/employees/search/salary?min=${minSalary}&max=${maxSalary}`
        );
        const employees = await response.json();

        if (employees.length === 0) {
            resultsDiv.innerHTML = '<div class="result-message">No employees found in that salary range</div>';
            return;
        }

        resultsDiv.innerHTML = `
            <h3>🔐 Search Results (Encrypted Field)</h3>
            <p>Found ${employees.length} employee(s) using encrypted range query on salary</p>
            ${employees.map(emp => createEmployeeCard(emp)).join('')}
        `;
    } catch (error) {
        console.error('Error searching by salary:', error);
        resultsDiv.innerHTML = '<div class="result-message error">Error searching</div>';
    }
}

// Advanced Search - Combine Name AND Salary Range (Both Encrypted)
async function advancedSearch() {
    const name = document.getElementById('advancedName').value.trim();
    const minSalary = document.getElementById('advancedMinSalary').value;
    const maxSalary = document.getElementById('advancedMaxSalary').value;

    if (!name && !minSalary && !maxSalary) {
        alert('Please enter at least one search criteria');
        return;
    }

    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '<div class="loading">Performing advanced search on encrypted fields...</div>';

    try {
        let url = `${API_BASE}/employees/search/advanced?`;
        const params = [];

        if (name) params.push(`name=${encodeURIComponent(name)}`);
        if (minSalary) params.push(`minSalary=${minSalary}`);
        if (maxSalary) params.push(`maxSalary=${maxSalary}`);

        url += params.join('&');

        const response = await fetch(url);
        const employees = await response.json();

        if (employees.length === 0) {
            resultsDiv.innerHTML = '<div class="result-message">No employees found matching the criteria</div>';
            return;
        }

        let searchDescription = 'Advanced search: ';
        const criteria = [];
        if (name) criteria.push(`Name = "${name}"`);
        if (minSalary && maxSalary) criteria.push(`Salary between $${formatNumber(minSalary)} and $${formatNumber(maxSalary)}`);
        else if (minSalary) criteria.push(`Salary >= $${formatNumber(minSalary)}`);
        else if (maxSalary) criteria.push(`Salary <= $${formatNumber(maxSalary)}`);
        searchDescription += criteria.join(' AND ');

        resultsDiv.innerHTML = `
            <h3>🔥 Advanced Search Results (Multiple Encrypted Fields)</h3>
            <p style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px; border-radius: 8px; margin: 10px 0;">
                ${searchDescription}<br>
                Found ${employees.length} employee(s) using combined encrypted queries!
            </p>
            ${employees.map(emp => createEmployeeCard(emp)).join('')}
        `;
    } catch (error) {
        console.error('Error in advanced search:', error);
        resultsDiv.innerHTML = '<div class="result-message error">Error performing advanced search</div>';
    }
}

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function maskSSN(ssn) {
    if (!ssn || ssn.length < 4) return '***-**-****';
    return '***-**-' + ssn.slice(-4);
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
