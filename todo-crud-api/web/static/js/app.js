// Configuração da API
const API_BASE_URL = 'http://localhost:8080/api/v1';

// Estado da aplicação
const app = new Vue({
    el: '#app',
    data: {
        tasks: [],
        stats: {
            total: 0,
            completed: 0,
            pending: 0,
            highPriority: 0
        },
        newTask: {
            name: '',
            description: '',
            priority: 'medium',
            dueDate: ''
        },
        editingTask: null,
        filter: 'all', // all, completed, pending
        priorityFilter: '', // '', low, medium, high
        loading: false,
        error: null
    },
    computed: {
        filteredTasks() {
            let filtered = this.tasks;

            // Filtro por status
            if (this.filter === 'completed') {
                filtered = filtered.filter(task => task.completed);
            } else if (this.filter === 'pending') {
                filtered = filtered.filter(task => !task.completed);
            }

            // Filtro por prioridade
            if (this.priorityFilter) {
                filtered = filtered.filter(task => task.priority === this.priorityFilter);
            }

            return filtered;
        }
    },
    mounted() {
        this.loadTasks();
        this.loadStats();
    },
    methods: {
        // Carrega todas as tarefas
        async loadTasks() {
            this.loading = true;
            this.error = null;
            try {
                const response = await fetch(`${API_BASE_URL}/tasks`);
                if (!response.ok) throw new Error('Erro ao carregar tarefas');
                this.tasks = await response.json();
            } catch (error) {
                console.error('Erro ao carregar tarefas:', error);
                this.error = 'Erro ao carregar tarefas. Verifique sua conexão.';
            } finally {
                this.loading = false;
            }
        },

        // Carrega estatísticas
        async loadStats() {
            try {
                const response = await fetch(`${API_BASE_URL}/tasks/stats`);
                if (!response.ok) throw new Error('Erro ao carregar estatísticas');
                this.stats = await response.json();
            } catch (error) {
                console.error('Erro ao carregar estatísticas:', error);
            }
        },

        // Cria nova tarefa
        async createTask() {
            if (!this.newTask.name.trim()) {
                alert('Por favor, digite o nome da tarefa');
                return;
            }

            this.loading = true;
            try {
                const taskData = {
                    name: this.newTask.name,
                    description: this.newTask.description,
                    priority: this.newTask.priority
                };

                if (this.newTask.dueDate) {
                    taskData.dueDate = new Date(this.newTask.dueDate).toISOString();
                }

                const response = await fetch(`${API_BASE_URL}/tasks`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(taskData)
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Erro ao criar tarefa');
                }

                // Limpa o formulário
                this.newTask = {
                    name: '',
                    description: '',
                    priority: 'medium',
                    dueDate: ''
                };

                // Recarrega as tarefas
                await this.loadTasks();
                await this.loadStats();
            } catch (error) {
                console.error('Erro ao criar tarefa:', error);
                alert(error.message);
            } finally {
                this.loading = false;
            }
        },

        // Abre modal de edição
        openEditModal(task) {
            this.editingTask = {
                ...task,
                dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''
            };
        },

        // Fecha modal de edição
        closeEditModal() {
            this.editingTask = null;
        },

        // Atualiza tarefa
        async updateTask() {
            if (!this.editingTask.name.trim()) {
                alert('Por favor, digite o nome da tarefa');
                return;
            }

            this.loading = true;
            try {
                const taskData = {
                    name: this.editingTask.name,
                    description: this.editingTask.description,
                    priority: this.editingTask.priority,
                    completed: this.editingTask.completed
                };

                if (this.editingTask.dueDate) {
                    taskData.dueDate = new Date(this.editingTask.dueDate).toISOString();
                }

                const response = await fetch(`${API_BASE_URL}/tasks/${this.editingTask.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(taskData)
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Erro ao atualizar tarefa');
                }

                this.closeEditModal();
                await this.loadTasks();
                await this.loadStats();
            } catch (error) {
                console.error('Erro ao atualizar tarefa:', error);
                alert(error.message);
            } finally {
                this.loading = false;
            }
        },

        // Alterna conclusão da tarefa
        async toggleTask(taskId) {
            this.loading = true;
            try {
                const response = await fetch(`${API_BASE_URL}/tasks/${taskId}/toggle`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Erro ao atualizar tarefa');
                }

                await this.loadTasks();
                await this.loadStats();
            } catch (error) {
                console.error('Erro ao alternar tarefa:', error);
                alert(error.message);
            } finally {
                this.loading = false;
            }
        },

        // Deleta tarefa
        async deleteTask(taskId) {
            if (!confirm('Tem certeza que deseja excluir esta tarefa?')) {
                return;
            }

            this.loading = true;
            try {
                const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Erro ao deletar tarefa');
                }

                await this.loadTasks();
                await this.loadStats();
            } catch (error) {
                console.error('Erro ao deletar tarefa:', error);
                alert(error.message);
            } finally {
                this.loading = false;
            }
        },

        // Define filtro
        setFilter(filter) {
            this.filter = filter;
        },

        // Define filtro de prioridade
        setPriorityFilter(priority) {
            this.priorityFilter = this.priorityFilter === priority ? '' : priority;
        },

        // Formata data
        formatDate(dateString) {
            if (!dateString) return '';
            const date = new Date(dateString);
            return date.toLocaleDateString('pt-BR');
        },

        // Verifica se a tarefa está atrasada
        isOverdue(dueDate) {
            if (!dueDate) return false;
            return new Date(dueDate) < new Date();
        }
    }
});
