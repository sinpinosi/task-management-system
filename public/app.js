const API_BASE = window.location.origin + '/api';

const app = {
    config: { userName: 'Guest' },
    templates: [],
    tasks: [],
    filters: {
        status: '',
        priority: '',
        dueDateStart: '',
        dueDateEnd: '',
        assignee: ''
    },
    expandedNodes: new Set(), // Store expanded state
    currentTab: 'board',
    alarmView: 'active',
    alarms: [],
    draggingNodeId: null,
    draggingParentId: null,

    async init() {
        await this.loadConfig();
        await this.loadTemplates();
        await this.loadAlarms();
        await this.loadTasks();
    },

    async loadAlarms() {
        try {
            const res = await fetch(`${API_BASE}/alarms`);
            if (res.ok) {
                const data = await res.json();
                this.alarms = Array.isArray(data) ? data : (data ? [data] : []);
            }
        } catch (e) {
            console.error('Failed to load alarms', e);
            this.alarms = [];
        }
    },

    async saveAlarmsToServer() {
        try {
            await fetch(`${API_BASE}/alarms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.alarms)
            });
            await this.loadAlarms();
        } catch (e) {
            console.error('Failed to save alarms', e);
        }
    },

    async loadTemplates() {
        try {
            const res = await fetch(`${API_BASE}/templates`);
            if (res.ok) {
                this.templates = await res.json();
                this.updateTemplateDropdown();
            }
        } catch (e) {
            console.error('Failed to load templates', e);
        }
    },

    updateTemplateDropdown() {
        const tplSelect = document.getElementById('task-template');
        if (!tplSelect) return;
        tplSelect.innerHTML = '<option value="">- No Template -</option>';
        if (this.templates && this.templates.length > 0) {
            this.templates.forEach(tpl => {
                const opt = document.createElement('option');
                opt.value = tpl.id;
                opt.textContent = tpl.name;
                tplSelect.appendChild(opt);
            });
        }
    },

    async loadConfig() {
        try {
            const res = await fetch(`${API_BASE}/config`);
            if (res.ok) {
                this.config = await res.json();
                document.getElementById('user-name').textContent = this.config.userName;
                document.getElementById('user-avatar').textContent = this.config.userName.charAt(0).toUpperCase();
            }
        } catch (e) {
            console.error('Failed to load config', e);
        }
    },

    async loadTasks() {
        const listEl = document.getElementById('task-list');
        listEl.innerHTML = '<div class="loading-state">タスクを読み込み中...</div>';
        try {
            const res = await fetch(`${API_BASE}/tasks`);
            if (res.ok) {
                this.tasks = await res.json();
                this.tasks.sort((a, b) => {
                    const orderA = a.order !== undefined ? a.order : 999999;
                    const orderB = b.order !== undefined ? b.order : 999999;
                    return orderA - orderB;
                });
                this.render();
            }
        } catch (e) {
            console.error('Failed to load tasks', e);
            listEl.innerHTML = '<div class="loading-state" style="color:var(--danger-color)">ローカルサーバーへの接続に失敗しました。start.batが実行されていることを確認してください。</div>';
        }
    },

    filterTaskTree(tasks, filters) {
        return tasks.map(task => {
            let matches = true;
            if (filters.status && task.status !== filters.status) matches = false;
            if (filters.priority && task.priority !== filters.priority) matches = false;

            if (filters.dueDateStart || filters.dueDateEnd) {
                if (!task.dueDate) {
                    matches = false;
                } else {
                    if (filters.dueDateStart && task.dueDate < filters.dueDateStart) matches = false;
                    if (filters.dueDateEnd && task.dueDate > filters.dueDateEnd) matches = false;
                }
            }

            if (filters.assignee) {
                if (filters.assignee === '_unassigned') {
                    if (task.assignee && task.assignee.trim() !== '') matches = false;
                } else if (task.assignee !== filters.assignee) {
                    matches = false;
                }
            }

            let filteredChildren = [];
            if (task.children && task.children.length > 0) {
                filteredChildren = this.filterTaskTree(task.children, filters);
            }

            if (matches || filteredChildren.length > 0) {
                if (filteredChildren.length > 0 && !matches) {
                    this.expandedNodes.add(task.id);
                }
                return { ...task, children: filteredChildren };
            }
            return null;
        }).filter(t => t !== null);
    },

    render() {
        const listEl = document.getElementById('task-list');
        listEl.innerHTML = '';
        if (this.tasks.length === 0) {
            listEl.innerHTML = '<div class="loading-state">タスクがありません。作成しましょう！</div>';
            return;
        }

        const hideTrashed = (taskList) => {
            return taskList.map(t => {
                if (t.isTrashed) return null;
                const children = t.children && t.children.length > 0 ? hideTrashed(t.children) : [];
                return { ...t, children };
            }).filter(t => t !== null);
        };

        let tasksToRender = hideTrashed(this.tasks);

        if (this.currentTab === 'archive') {
            tasksToRender = tasksToRender.filter(t => t.isArchived);
        } else {
            tasksToRender = tasksToRender.filter(t => !t.isArchived);
        }

        if (this.filters.status || this.filters.priority || this.filters.dueDateStart || this.filters.dueDateEnd || this.filters.assignee) {
            tasksToRender = this.filterTaskTree(tasksToRender, this.filters);
        }

        if (tasksToRender.length === 0) {
            listEl.innerHTML = '<div class="loading-state">条件に一致するタスクがありません。</div>';
            return;
        }

        if (this.currentTab === 'my-tasks') {
            const myTasks = [];
            const findMyTasks = (taskList, parentTitle = '') => {
                taskList.forEach(task => {
                    if (task.assignee === this.config.userName) {
                        myTasks.push({ task, parentTitle });
                    }
                    if (task.children && task.children.length > 0) {
                        findMyTasks(task.children, task.title);
                    }
                });
            };
            findMyTasks(tasksToRender, '');

            if (myTasks.length === 0) {
                listEl.innerHTML = '<div class="loading-state">あなたに割り当てられたタスクはありません。</div>';
                return;
            }

            myTasks.forEach(({ task, parentTitle }) => {
                const el = this.createTaskElement(task, 0, null, parentTitle, true);
                listEl.appendChild(el);
            });
        } else {
            tasksToRender.forEach(task => {
                const el = this.createTaskElement(task, 0, null, '', this.currentTab === 'archive');
                listEl.appendChild(el);
            });
        }
    },

    setTab(tabId) {
        this.currentTab = tabId;
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

        document.getElementById('tasks-board-view').style.display = 'none';
        document.getElementById('templates-board-view').style.display = 'none';
        const trashBoard = document.getElementById('trash-board-view');
        if (trashBoard) trashBoard.style.display = 'none';
        const alarmsBoard = document.getElementById('alarms-board-view');
        if (alarmsBoard) alarmsBoard.style.display = 'none';

        document.getElementById('header-btn-refresh').style.display = 'none';
        const headerBtnNewTask = document.getElementById('header-btn-new-task');
        if (headerBtnNewTask) headerBtnNewTask.style.display = 'none';

        const filterBar = document.getElementById('task-filter-bar');
        if (filterBar) {
            filterBar.style.display = (tabId === 'board' || tabId === 'my-tasks' || tabId === 'archive') ? 'flex' : 'none';
        }

        if (tabId === 'board') {
            document.getElementById('nav-board').classList.add('active');
            document.getElementById('page-title').textContent = 'Tasks overview';
            document.getElementById('tasks-board-view').style.display = 'flex';
            document.getElementById('header-btn-refresh').style.display = 'block';
            if (headerBtnNewTask) headerBtnNewTask.style.display = 'flex';
            this.render();
        } else if (tabId === 'my-tasks') {
            document.getElementById('nav-my-tasks').classList.add('active');
            document.getElementById('page-title').textContent = 'My Tasks';
            document.getElementById('tasks-board-view').style.display = 'flex';
            document.getElementById('header-btn-refresh').style.display = 'block';
            if (headerBtnNewTask) headerBtnNewTask.style.display = 'flex';
            this.render();
        } else if (tabId === 'archive') {
            document.getElementById('nav-archive').classList.add('active');
            document.getElementById('page-title').textContent = 'アーカイブ済みタスク';
            document.getElementById('tasks-board-view').style.display = 'flex';
            document.getElementById('header-btn-refresh').style.display = 'block';
            this.render();
        } else if (tabId === 'templates') {
            document.getElementById('nav-templates').classList.add('active');
            document.getElementById('page-title').textContent = 'Templates Management';
            document.getElementById('templates-board-view').style.display = 'block';
            this.renderTemplates();
        } else if (tabId === 'alarms') {
            document.getElementById('nav-alarms').classList.add('active');
            document.getElementById('page-title').textContent = 'アラーム';
            document.getElementById('alarms-board-view').style.display = 'block';
            this.loadAlarms().then(() => this.renderAlarms());
        } else if (tabId === 'trash') {
            document.getElementById('nav-trash').classList.add('active');
            document.getElementById('page-title').textContent = 'ゴミ箱';
            if (document.getElementById('trash-board-view')) document.getElementById('trash-board-view').style.display = 'block';
            this.renderTrashList();
        }
    },

    renderTemplates() {
        const listEl = document.getElementById('templates-list');
        listEl.innerHTML = '';
        if (this.templates.length === 0) {
            listEl.innerHTML = '<div class="loading-state">テンプレートがありません。作成しましょう！</div>';
            return;
        }

        this.templates.forEach(tpl => {
            const row = document.createElement('div');
            row.className = 'task-item task-row';
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.padding = '16px';

            const taskCount = tpl.tasks ? tpl.tasks.length : 0;

            row.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <div style="font-weight:600; font-size:15px;">${tpl.name}</div>
                    <div style="font-size:13px; color:var(--text-secondary);">${taskCount}個のタスクが設定されています</div>
                </div>
                <div class="task-actions">
                    <button class="action-btn" title="Edit" onclick="app.openTemplateModal('${tpl.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="action-btn delete" title="Delete" onclick="app.deleteTemplate('${tpl.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            `;
            listEl.appendChild(row);
        });
    },

    openTemplateModal(id = '') {
        const container = document.getElementById('template-tasks-container');
        container.innerHTML = '';

        if (id) {
            const tpl = this.templates.find(t => t.id === id);
            document.getElementById('template-modal-title').textContent = 'テンプレートを編集';
            document.getElementById('edit-template-id').value = id;
            document.getElementById('edit-template-name').value = tpl.name;
            if (tpl.tasks && tpl.tasks.length > 0) {
                tpl.tasks.forEach(t => this.addTemplateTaskRow(t.title, t.description));
            } else {
                this.addTemplateTaskRow();
            }
        } else {
            document.getElementById('template-modal-title').textContent = '新規テンプレート';
            document.getElementById('edit-template-id').value = '';
            document.getElementById('edit-template-name').value = '';
            this.addTemplateTaskRow();
        }

        document.getElementById('template-editor-modal').classList.add('active');
    },

    closeTemplateModal() {
        document.getElementById('template-editor-modal').classList.remove('active');
    },

    addTemplateTaskRow(title = '', desc = '') {
        const container = document.getElementById('template-tasks-container');
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '12px';
        row.style.alignItems = 'flex-start';
        row.style.background = 'var(--bg-surface)';
        row.style.padding = '12px';
        row.style.borderRadius = '8px';
        row.style.border = '1px solid var(--border-color)';

        row.innerHTML = `
            <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
                <input type="text" class="tpl-task-title" placeholder="タスクタイトル（例：設計）" value="${title}" required style="padding:8px;">
                <input type="text" class="tpl-task-desc" placeholder="タスク詳細（任意）" value="${desc}" style="padding:8px;">
            </div>
            <button class="action-btn delete" onclick="this.parentElement.remove()" style="margin-top:4px;">&times;</button>
        `;
        container.appendChild(row);
    },

    async saveTemplateBuilder() {
        const id = document.getElementById('edit-template-id').value;
        const name = document.getElementById('edit-template-name').value.trim();
        if (!name) return alert("テンプレート名は必須です");

        const tasks = [];
        document.querySelectorAll('#template-tasks-container > div').forEach(row => {
            const title = row.querySelector('.tpl-task-title').value.trim();
            const desc = row.querySelector('.tpl-task-desc').value.trim();
            if (title) {
                tasks.push({ title, description: desc, children: [] });
            }
        });

        const newTplId = id || ('tpl_' + Date.now());
        const templateObj = { id: newTplId, name, tasks };

        try {
            await fetch(`${API_BASE}/templates/${newTplId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(templateObj, null, 2)
            });
            await this.loadTemplates();
            this.closeTemplateModal();
            if (this.currentTab === 'templates') this.renderTemplates();
        } catch (e) {
            console.error(e);
            alert("テンプレートの保存に失敗しました。");
        }
    },

    async deleteTemplate(id) {
        if (!confirm("このテンプレートを削除してもよろしいですか？")) return;
        try {
            await fetch(`${API_BASE}/templates/${id}`, { method: 'DELETE' });
            await this.loadTemplates();
            this.renderTemplates();
        } catch (e) {
            console.error(e);
        }
    },

    createTaskElement(task, depth, parentId = null, parentTitle = '', isFlatView = false) {
        const container = document.createElement('div');
        container.className = 'task-node';

        const hasChildren = task.children && task.children.length > 0;
        const isExpanded = this.expandedNodes.has(task.id);

        let statusClass = 'status-todo';
        if (task.status === '進行中') statusClass = 'status-progress';
        if (task.status === 'レビュー依頼中') statusClass = 'status-review';
        if (task.status === '完了') statusClass = 'status-done';

        let prioClass = 'prio-medium';
        if (task.priority === 'High') prioClass = 'prio-high';
        if (task.priority === 'Low') prioClass = 'prio-low';

        // Render main row
        const row = document.createElement('div');
        row.className = 'task-item';

        // Depth indent base (px)
        const indentPadding = depth * 24;

        let titleHtml = task.title;
        if (parentTitle) {
            titleHtml = `<span style="color:var(--text-secondary);font-size:13px;font-weight:400;margin-right:4px;">${parentTitle} &gt;</span> ` + task.title;
        }

        row.innerHTML = `
            <div class="task-row">
                <div class="col-task task-cell" style="padding-left: ${indentPadding}px; flex-direction: row; align-items: center; gap: 8px;">
                    ${!isFlatView && hasChildren ? `
                        <div class="toggle-subtasks" onclick="app.toggleExpand('${task.id}')">
                            ${isExpanded
                    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>`
                    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>`
                }
                        </div>
                    ` : `<div style="width:24px;height:24px"></div>`}
                    <div style="display:flex; flex-direction:column; overflow:hidden;">
                        <div style="display:flex; align-items:center; gap: 8px;">
                            <div class="task-title" title="${task.title}">${titleHtml}</div>
                            <button class="action-btn" title="Add Subtask" onclick="app.openModal('${task.id}')" style="padding:4px; display:flex; align-items:center; justify-content:center;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </button>
                        </div>
                        <div class="task-desc" title="${task.description}">${task.description}</div>
                    </div>
                </div>
                <div class="col-status task-cell">
                    <span class="badge ${statusClass}">${task.status}</span>
                </div>
                <div class="col-assignee task-cell">
                    ${task.assignee || '-'}
                </div>
                <div class="col-due task-cell">
                    ${task.dueDate || '-'}
                </div>
                <div class="col-priority task-cell">
                    <span class="badge ${prioClass}">${task.priority}</span>
                </div>
                <div class="col-actions task-cell">
                    <div class="task-actions">
                        <button class="action-btn" title="${task.isArchived ? 'アーカイブから戻す' : 'アーカイブ'}" onclick="app.toggleArchive('${task.id}')">
                            ${task.isArchived
                ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>`
                : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`
            }
                        </button>
                        <button class="action-btn" title="Save as Template" onclick="app.saveAsTemplate('${task.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                        </button>
                        <button class="action-btn" title="Edit" onclick="app.editTask('${task.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="action-btn delete" title="Delete" onclick="app.moveToTrash('${task.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(row);

        if (!isFlatView) {
            const myParentId = parentId || 'root';
            row.draggable = true;

            row.addEventListener('dragstart', (e) => {
                e.stopPropagation();
                app.draggingNodeId = task.id;
                app.draggingParentId = myParentId;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', task.id);
                setTimeout(() => { row.classList.add('dragging-ghost'); }, 0);
            });

            row.addEventListener('dragend', (e) => {
                e.stopPropagation();
                row.classList.remove('dragging-ghost');
                app.draggingNodeId = null;
                app.draggingParentId = null;
                document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
                    el.classList.remove('drag-over-top', 'drag-over-bottom');
                });
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!app.draggingNodeId || app.draggingNodeId === task.id) return;
                if (app.draggingParentId !== myParentId) return;

                const bounding = row.getBoundingClientRect();
                const offset = bounding.y + (bounding.height / 2);

                row.classList.remove('drag-over-top', 'drag-over-bottom');
                if (e.clientY < offset) {
                    row.classList.add('drag-over-top');
                } else {
                    row.classList.add('drag-over-bottom');
                }
            });

            row.addEventListener('dragleave', (e) => {
                e.stopPropagation();
                row.classList.remove('drag-over-top', 'drag-over-bottom');
            });

            row.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                row.classList.remove('drag-over-top', 'drag-over-bottom');

                const dragId = app.draggingNodeId;
                if (!dragId || dragId === task.id || app.draggingParentId !== myParentId) return;

                const bounding = row.getBoundingClientRect();
                const offset = bounding.y + (bounding.height / 2);
                const dropPosition = e.clientY < offset ? 'before' : 'after';

                app.reorderTask(dragId, task.id, dropPosition, myParentId);
            });
        }

        if (!isFlatView && hasChildren && isExpanded) {
            const subContainer = document.createElement('div');
            subContainer.className = 'subtasks-container open';
            task.children.forEach(child => {
                subContainer.appendChild(this.createTaskElement(child, depth + 1, task.id));
            });
            container.appendChild(subContainer);
        }
        return container;
    },

    async toggleArchive(id) {
        const info = this.findNodeInfo(id);
        if (!info) return;

        info.node.isArchived = !info.node.isArchived;
        await this.updateRootOnServer(info.rootId);
        this.render();
    },

    async reorderTask(dragId, targetId, position, parentId) {
        if (dragId === targetId) return;

        let listToUpdate = [];
        let rootToSave = null;

        if (parentId === 'root') {
            listToUpdate = this.tasks;
        } else {
            const parentInfo = this.findNodeInfo(parentId);
            if (!parentInfo || !parentInfo.node.children) return;
            listToUpdate = parentInfo.node.children;
            rootToSave = parentInfo.rootId;
        }

        const dragIndex = listToUpdate.findIndex(t => t.id === dragId);
        const targetIndex = listToUpdate.findIndex(t => t.id === targetId);

        if (dragIndex === -1 || targetIndex === -1) return;

        const [dragItem] = listToUpdate.splice(dragIndex, 1);
        const newTargetIndex = listToUpdate.findIndex(t => t.id === targetId);

        if (position === 'before') {
            listToUpdate.splice(newTargetIndex, 0, dragItem);
        } else {
            listToUpdate.splice(newTargetIndex + 1, 0, dragItem);
        }

        if (parentId === 'root') {
            // Bulk update roots order
            const promises = [];
            listToUpdate.forEach((t, i) => {
                t.order = i;
                promises.push(this.updateRootOnServer(t.id));
            });
            await Promise.all(promises);
        } else {
            // Update children in root
            await this.updateRootOnServer(rootToSave);
        }

        this.render();
    },

    toggleExpand(id) {
        if (this.expandedNodes.has(id)) {
            this.expandedNodes.delete(id);
        } else {
            this.expandedNodes.add(id);
        }
        this.render();
    },

    updateAssigneeSelect() {
        const select = document.getElementById('task-assignee-select');
        const filterSelect = document.getElementById('filter-assignee');

        const assignees = new Set();
        const traverse = (tasks) => {
            tasks.forEach(t => {
                if (t.assignee && t.assignee.trim() !== '') assignees.add(t.assignee.trim());
                if (t.children && t.children.length > 0) traverse(t.children);
            });
        };
        traverse(this.tasks);

        const sortedAssignees = Array.from(assignees).sort();

        if (select) {
            select.innerHTML = '<option value="">-- 登録済みから選択 --</option>';
            sortedAssignees.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a;
                opt.textContent = a;
                select.appendChild(opt);
            });
        }

        if (filterSelect) {
            const currentVal = filterSelect.value;
            filterSelect.innerHTML = `
                <option value="">すべて</option>
                <option value="_unassigned">担当者なし</option>
            `;
            sortedAssignees.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a;
                opt.textContent = a;
                filterSelect.appendChild(opt);
            });
            if (currentVal && (currentVal === '_unassigned' || assignees.has(currentVal))) {
                filterSelect.value = currentVal;
            }
        }
    },

    handleFilterChange() {
        this.filters.status = document.getElementById('filter-status').value;
        this.filters.priority = document.getElementById('filter-priority').value;
        this.filters.dueDateStart = document.getElementById('filter-due-start').value;
        this.filters.dueDateEnd = document.getElementById('filter-due-end').value;
        this.filters.assignee = document.getElementById('filter-assignee').value;
        this.render();
    },

    clearFilters() {
        document.getElementById('filter-status').value = '';
        document.getElementById('filter-priority').value = '';
        document.getElementById('filter-due-start').value = '';
        document.getElementById('filter-due-end').value = '';
        document.getElementById('filter-assignee').value = '';
        this.filters = { status: '', priority: '', dueDateStart: '', dueDateEnd: '', assignee: '' };
        this.render();
    },

    findNodeInfo(id, taskList = this.tasks, rootId = null) {
        for (let i = 0; i < taskList.length; i++) {
            let task = taskList[i];
            let currentRoot = rootId || task.id;
            if (task.id === id) {
                return { node: task, rootId: currentRoot, parentList: taskList, index: i };
            }
            if (task.children && task.children.length > 0) {
                let found = this.findNodeInfo(id, task.children, currentRoot);
                if (found) return found;
            }
        }
        return null;
    },

    openModal(parentId = '') {
        this.updateAssigneeSelect();
        document.getElementById('task-form').reset();
        document.getElementById('task-id').value = '';
        document.getElementById('parent-id').value = parentId;
        document.getElementById('modal-title').textContent = parentId ? 'サブタスク作成' : 'タスク作成';

        const tmplGroup = document.getElementById('template-group');
        if (tmplGroup) {
            document.getElementById('task-template').value = '';
            tmplGroup.style.display = (this.templates && this.templates.length > 0) ? 'block' : 'none';
        }

        // Defaults
        document.getElementById('task-status').value = '未着手';
        document.getElementById('task-priority').value = 'Medium';
        document.getElementById('task-assignee').value = this.config.userName || '';

        const selectEl = document.getElementById('task-assignee-select');
        const opts = Array.from(selectEl.options).map(o => o.value);
        if (opts.includes(this.config.userName)) {
            selectEl.value = this.config.userName;
        } else {
            selectEl.value = '';
        }

        document.getElementById('task-modal').classList.add('active');
    },

    closeModal() {
        document.getElementById('task-modal').classList.remove('active');
    },

    editTask(id) {
        const info = this.findNodeInfo(id);
        if (!info) return;

        this.updateAssigneeSelect();

        const tmplGroup = document.getElementById('template-group');
        if (tmplGroup) tmplGroup.style.display = 'none';

        document.getElementById('task-id').value = info.node.id;
        document.getElementById('parent-id').value = ''; // Update doesn't change parent

        document.getElementById('task-title').value = info.node.title;
        document.getElementById('task-desc').value = info.node.description || '';
        document.getElementById('task-status').value = info.node.status;
        document.getElementById('task-priority').value = info.node.priority;
        document.getElementById('task-assignee').value = info.node.assignee || '';
        document.getElementById('task-assignee-select').value = info.node.assignee || '';
        document.getElementById('task-due').value = info.node.dueDate || '';

        document.getElementById('modal-title').textContent = 'タスクを編集';
        document.getElementById('task-modal').classList.add('active');
    },

    async saveTask() {
        const id = document.getElementById('task-id').value;
        const parentId = document.getElementById('parent-id').value;
        const title = document.getElementById('task-title').value.trim();
        const assignee = document.getElementById('task-assignee').value.trim();
        const dueDate = document.getElementById('task-due').value;

        if (!title) {
            alert("タイトルは必須です。");
            return;
        }

        if (!assignee) {
            alert("担当者は必須です。");
            return;
        }

        if (dueDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const due = new Date(dueDate);
            if (due < today) {
                alert("期限は未来の日付または本日を指定してください。");
                return;
            }
        }

        const taskData = {
            title: title,
            description: document.getElementById('task-desc').value,
            status: document.getElementById('task-status').value,
            priority: document.getElementById('task-priority').value,
            assignee: assignee,
            dueDate: dueDate,
        };

        if (id) {
            // Edit existing
            const info = this.findNodeInfo(id);
            if (!info) return;
            Object.assign(info.node, taskData);
            await this.updateRootOnServer(info.rootId);
        } else {
            // Create new
            const newId = 't_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            let childTasks = [];

            const generateNodes = (nodes) => {
                return nodes.map(n => ({
                    id: 't_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    title: n.title,
                    description: n.description || '',
                    status: '未着手',
                    priority: 'Medium',
                    assignee: '',
                    dueDate: '',
                    creator: this.config.userName,
                    children: n.children ? generateNodes(n.children) : []
                }));
            };

            const tplSelect = document.getElementById('task-template');
            const tplId = tplSelect ? tplSelect.value : '';
            if (tplId && this.templates) {
                const tpl = this.templates.find(t => t.id === tplId);
                if (tpl && tpl.tasks) {
                    childTasks = generateNodes(tpl.tasks);
                }
            }

            const newNode = {
                id: newId,
                creator: this.config.userName,
                children: childTasks,
                ...taskData
            };

            if (parentId) {
                // Add subtask
                const parentInfo = this.findNodeInfo(parentId);
                if (parentInfo) {
                    if (!parentInfo.node.children) parentInfo.node.children = [];
                    parentInfo.node.children.push(newNode);
                    this.expandedNodes.add(parentId); // auto expand
                    await this.updateRootOnServer(parentInfo.rootId);
                }
            } else {
                // Add Root task
                newNode.order = Date.now();
                this.tasks.push(newNode);
                await this.updateRootOnServer(newId);
            }
        }

        this.closeModal();
        this.render();
    },

    async saveAsTemplate(taskId) {
        const info = this.findNodeInfo(taskId);
        if (!info) return;

        const tmplName = prompt("新しいテンプレートの名前を入力してください:");
        if (!tmplName) return;

        // Strip internal properties from tasks
        const stripProps = (nodes) => {
            return nodes.map(n => ({
                title: n.title,
                description: n.description || '',
                children: n.children ? stripProps(n.children) : []
            }));
        };

        const newTplId = 'tpl_' + Date.now();
        const templateObj = {
            id: newTplId,
            name: tmplName,
            tasks: stripProps(info.node.children || [])
        };

        try {
            await fetch(`${API_BASE}/templates/${newTplId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(templateObj, null, 2)
            });
            await this.loadTemplates();
            alert("テンプレートを保存しました。");
        } catch (e) {
            console.error(e);
            alert("テンプレートの保存に失敗しました。");
        }
    },

    async updateRootOnServer(rootId) {
        const rootNode = this.tasks.find(t => t.id === rootId);
        if (!rootNode) return;

        try {
            await fetch(`${API_BASE}/tasks/${rootId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rootNode, null, 2)
            });
        } catch (e) {
            console.error('Failed to save to server', e);
            alert("サーバーへのタスク保存に失敗しました。");
        }
    },

    async moveToTrash(id) {
        const info = this.findNodeInfo(id);
        if (!info) return;

        info.node.isTrashed = true;
        await this.updateRootOnServer(info.rootId);
        if (this.currentTab === 'board' || this.currentTab === 'my-tasks' || this.currentTab === 'archive') {
            this.render();
        } else if (this.currentTab === 'trash') {
            this.renderTrashList();
        }
    },

    renderTrashList() {
        const listEl = document.getElementById('trash-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        const trashedTasks = [];
        const findTrashed = (taskList, parentTitle = '') => {
            taskList.forEach(task => {
                if (task.isTrashed) {
                    trashedTasks.push({ task, parentTitle });
                } else if (task.children && task.children.length > 0) {
                    findTrashed(task.children, task.title);
                }
            });
        };
        findTrashed(this.tasks, '');

        if (trashedTasks.length === 0) {
            listEl.innerHTML = '<div class="loading-state">ゴミ箱には何もありません。</div>';
            return;
        }

        trashedTasks.forEach(({ task, parentTitle }) => {
            const row = document.createElement('div');
            row.className = 'task-item task-row';
            // borderBottom is removed to fix the strange box UI
            row.innerHTML = `
                <div class="col-task task-cell" style="flex-direction: column; align-items: flex-start; justify-content: center;">
                    <div class="task-title" style="font-size: 14px; font-weight: 500;">${task.title}</div>
                    <div class="task-desc" style="font-size: 12px; color: var(--text-secondary);">${task.description || ''}</div>
                </div>
                <div class="col-status task-cell" style="font-size: 13px; color: var(--text-secondary);">
                    ${parentTitle || '-'}
                </div>
                <div class="col-assignee task-cell" style="font-size: 13px;">
                    ${task.assignee || '-'}
                </div>
                <div class="col-due task-cell" style="font-size: 13px;">
                    ${task.dueDate || '-'}
                </div>
                <div class="col-actions task-cell">
                    <div class="task-actions">
                        <button class="action-btn" title="復元" onclick="app.restoreTask('${task.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>
                        </button>
                        <button class="action-btn delete" title="完全に削除" onclick="app.requestDeleteTask('${task.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
            `;
            listEl.appendChild(row);
        });
    },

    async restoreTask(id) {
        const info = this.findNodeInfo(id);
        if (!info) return;
        info.node.isTrashed = false;
        await this.updateRootOnServer(info.rootId);
        this.renderTrashList();
    },

    async emptyTrash() {
        if (!confirm("ゴミ箱内のすべてのタスクを完全に削除しますか？")) return;
        
        const trashedIds = [];
        const findTrashed = (taskList) => {
            taskList.forEach(task => {
                if (task.isTrashed) {
                    trashedIds.push(task.id);
                } else if (task.children) {
                    findTrashed(task.children);
                }
            });
        };
        findTrashed(this.tasks);

        if (trashedIds.length === 0) {
            return alert("ゴミ箱はすでに空です");
        }

        for (const id of trashedIds) {
            await this.deleteTaskInternal(id);
        }
        
        this.renderTrashList();
    },

    async requestDeleteTask(id) {
        if (!confirm("このタスクを完全に削除しますか？この操作は元に戻せません。")) return;
        await this.deleteTaskInternal(id);
        this.renderTrashList();
    },

    async deleteTaskInternal(id) {
        const info = this.findNodeInfo(id);
        if (!info) return;

        if (info.node.id === info.rootId) {
            try {
                await fetch(`${API_BASE}/tasks/${info.rootId}`, { method: 'DELETE' });
                this.tasks.splice(this.tasks.findIndex(t => t.id === info.rootId), 1);
            } catch (e) {
                console.error("Failed to delete", e);
            }
        } else {
            info.parentList.splice(info.index, 1);
            await this.updateRootOnServer(info.rootId);
        }
    },

    openDeleteModal(id) {
        document.getElementById('delete-task-id').value = id;
        document.getElementById('delete-modal').classList.add('active');
    },

    closeDeleteModal() {
        document.getElementById('delete-modal').classList.remove('active');
    },

    async confirmDelete() {
        const id = document.getElementById('delete-task-id').value;
        const info = this.findNodeInfo(id);
        if (!info) {
            this.closeDeleteModal();
            return;
        }

        if (info.node.id === info.rootId) {
            // Is a root task, delete from server
            try {
                await fetch(`${API_BASE}/tasks/${info.rootId}`, { method: 'DELETE' });
                this.tasks.splice(info.index, 1);
            } catch (e) {
                console.error("Failed to delete", e);
            }
        } else {
            // Is a subtask, remove from parentList and save root
            info.parentList.splice(info.index, 1);
            await this.updateRootOnServer(info.rootId);
        }

        this.closeDeleteModal();
        this.render();
    },

    setAlarmView(view) {
        this.alarmView = view;
        document.getElementById('tab-active-alarms').classList.toggle('active', view === 'active');
        document.getElementById('tab-history-alarms').classList.toggle('active', view === 'history');
        this.renderAlarms();
    },

    renderAlarms() {
        const listEl = document.getElementById('alarms-list');
        listEl.innerHTML = '';
        
        const filtered = this.alarms.filter(a => this.alarmView === 'active' ? a.status === 'pending' : a.status === 'completed');
        
        if (filtered.length === 0) {
            listEl.innerHTML = '<div class="loading-state">アラームがありません。</div>';
            return;
        }

        filtered.sort((a, b) => new Date(a.triggerTime) - new Date(b.triggerTime));

        filtered.forEach(alarm => {
            const row = document.createElement('div');
            row.className = 'task-item task-row';
            row.style.paddingLeft = '16px';
            if (alarm.status === 'completed') {
                row.style.opacity = '0.6';
                row.style.background = 'var(--bg-surface)';
            }
            
            const recLabel = {
                'none': 'なし',
                'daily': '日次',
                'weekly': '週次',
                'monthly': '月次'
            }[alarm.recurrence] || 'なし';

            // format date
            const dt = new Date(alarm.triggerTime);
            const dtStr = dt.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

            row.innerHTML = `
                <div class="col-task" style="flex:2">
                    <div style="font-weight: 500;">${alarm.title}</div>
                </div>
                <div class="col-due">
                    ${dtStr}
                </div>
                <div class="col-status">
                    <span class="badge prio-medium">${recLabel}</span>
                </div>
                <div class="col-actions">
                    <div class="task-actions">
                        ${alarm.status === 'completed' ? `
                            <button class="action-btn" title="再設定してアクティブにする" onclick="app.copyAlarmToActive('${alarm.id}')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 2v6h-6M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                </svg>
                            </button>
                        ` : `
                            <button class="action-btn" title="編集" onclick="app.openAlarmModal('${alarm.id}')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button class="action-btn" title="完了する" onclick="app.completeAlarm('${alarm.id}')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            </button>
                        `}
                        <button class="action-btn delete" title="削除" onclick="app.deleteAlarm('${alarm.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
            `;
            listEl.appendChild(row);
        });
    },

    openAlarmModal(id = '') {
        const form = document.getElementById('alarm-form');
        form.reset();
        document.getElementById('alarm-id').value = '';
        document.getElementById('alarm-modal-title').textContent = '新規アラーム作成';
        
        // Default to now + 30 mins
        const now = new Date();
        now.setMinutes(now.getMinutes() + 30);
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('alarm-datetime').value = now.toISOString().slice(0, 16);

        if (id) {
            const alarm = this.alarms.find(a => a.id === id);
            if (alarm) {
                document.getElementById('alarm-modal-title').textContent = 'アラーム編集';
                document.getElementById('alarm-id').value = alarm.id;
                document.getElementById('alarm-title').value = alarm.title;
                document.getElementById('alarm-datetime').value = alarm.triggerTime;
                document.getElementById('alarm-recurrence').value = alarm.recurrence || 'none';
            }
        }
        document.getElementById('alarm-modal').classList.add('active');
    },

    closeAlarmModal() {
        document.getElementById('alarm-modal').classList.remove('active');
    },

    async saveAlarm() {
        const id = document.getElementById('alarm-id').value;
        const title = document.getElementById('alarm-title').value.trim();
        const datetime = document.getElementById('alarm-datetime').value;
        const recurrence = document.getElementById('alarm-recurrence').value;

        if (!title || !datetime) {
            alert("タイトルと通知日時は必須です。");
            return;
        }

        if (id) {
            const alarm = this.alarms.find(a => a.id === id);
            if (alarm) {
                alarm.title = title;
                alarm.triggerTime = datetime;
                alarm.recurrence = recurrence;
                alarm.status = 'pending';
            }
        } else {
            this.alarms.push({
                id: 'al_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                title: title,
                triggerTime: datetime,
                recurrence: recurrence,
                status: 'pending'
            });
        }

        await this.saveAlarmsToServer();
        this.closeAlarmModal();
        if (this.currentTab === 'alarms') {
            this.setAlarmView('active'); // show active tab
        }
    },

    async deleteAlarm(id) {
        if (!confirm("このアラームを削除してもよろしいですか？")) return;
        this.alarms = this.alarms.filter(a => a.id !== id);
        await this.saveAlarmsToServer();
        if (this.currentTab === 'alarms') this.renderAlarms();
    },

    async completeAlarm(id) {
        const alarm = this.alarms.find(a => a.id === id);
        if (!alarm) return;
        alarm.status = 'completed';
        await this.saveAlarmsToServer();
        if (this.currentTab === 'alarms') this.renderAlarms();
    },

    copyAlarmToActive(id) {
        const alarm = this.alarms.find(a => a.id === id);
        if (!alarm) return;
        
        this.openAlarmModal();
        document.getElementById('alarm-modal-title').textContent = '再設定';
        document.getElementById('alarm-title').value = alarm.title;
        document.getElementById('alarm-recurrence').value = alarm.recurrence || 'none';
        // id stays empty to create a new record
    }
};

// Init app when DOM loads
document.addEventListener('DOMContentLoaded', () => app.init());
