
// Получаем user_id из скрытого поля
const user_id = parseInt(document.getElementById('user_id').value);
let activeFolderId = parseInt(document.getElementById('activeFolderId').value);

// При загрузке — загружаем заметки для первой папки
document.addEventListener('DOMContentLoaded', function() {
    loadNotes(activeFolderId);
});

// === ЗАГРУЗКА ЗАМЕТОК ===
async function loadNotes(folderId) {
    activeFolderId = folderId;
    document.getElementById('activeFolderId').value = folderId;

    // Подсвечиваем активную папку
    document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
    const folderEl = document.querySelector(`.folder-item[data-folder-id="${folderId}"]`);
    if (folderEl) folderEl.classList.add('active');

    const container = document.getElementById('notesContainer');
    container.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><h3>Загрузка...</h3></div>';

    try {
        const resp = await fetch(`/api/folders/${folderId}/notes?user_id=${user_id}`);
        const notes = await resp.json();

        // Обновляем название папки
        const folderName = document.querySelector(`.folder-item[data-folder-id="${folderId}"] .folder-name`);
        if (folderName) {
            document.getElementById('currentFolderName').textContent = folderName.textContent;
        }

        // Обновляем счётчик
        const countEl = document.getElementById(`count-${folderId}`);
        if (countEl) countEl.textContent = notes.length;

        if (notes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📭</div>
                    <h3>Здесь пока пусто</h3>
                    <p>Создайте первую заметку или задачу</p>
                </div>
            `;
            return;
        }

        container.innerHTML = notes.map(note => renderNoteCard(note)).join('');

    } catch (err) {
        console.error('Ошибка загрузки:', err);
        container.innerHTML = '<div class="empty-state"><div class="icon">❌</div><h3>Ошибка загрузки</h3></div>';
    }
}

// === ОТРИСОВКА КАРТОЧКИ ЗАМЕТКИ ===
function renderNoteCard(note) {
    const isTask = note.is_task === 1;
    const isDone = note.is_done === 1;
    const badgeClass = isTask ? (isDone ? 'done' : 'task') : '';
    const badgeText = isTask ? (isDone ? '✓ Выполнено' : 'Задача') : 'Заметка';
    const cardClass = isTask ? 'note-card task' : 'note-card';
    const doneClass = isDone ? 'done' : '';

    const content = note.content || `[${note.content_type}]`;

    return `
        <div class="${cardClass} ${doneClass}" onclick="showNoteDetail(${note.id})">
            <div class="note-header">
                <span class="note-badge ${badgeClass}">${badgeText}</span>
                <div class="note-actions">
                    ${isTask ? `<button onclick="event.stopPropagation(); toggleDone(${note.id})" title="${isDone ? 'Отменить' : 'Выполнить'}">${isDone ? '↩️' : '✅'}</button>` : ''}
                    <button onclick="event.stopPropagation(); deleteNote(${note.id})" title="Удалить">🗑️</button>
                </div>
            </div>
            <div class="note-text">${escapeHtml(content)}</div>
            <div class="note-footer">
                <span>${new Date(note.created_at).toLocaleString('ru-RU')}</span>
                ${note.assigned_to ? `<span>👤 ${note.assigned_to}</span>` : ''}
            </div>
        </div>
    `;
}

// === ВЫБОР ПАПКИ ===
function selectFolder(folderId) {
    loadNotes(folderId);
}

// === МОДАЛЬНЫЕ ОКНА ===
function showCreateFolderModal() {
    document.getElementById('folderNameInput').value = '';
    document.getElementById('folderModal').classList.add('show');
}

function showCreateNoteModal() {
    document.getElementById('noteContentInput').value = '';
    document.getElementById('noteModal').classList.add('show');
}

function showCreateTaskModal() {
    document.getElementById('taskContentInput').value = '';
    document.getElementById('taskModal').classList.add('show');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('show');
}

// Закрытие по клику вне модалки
document.querySelectorAll('.modal').forEach(el => {
    el.addEventListener('click', function(e) {
        if (e.target === this) this.classList.remove('show');
    });
});

// === СОЗДАНИЕ ПАПКИ ===
async function createFolder() {
    const name = document.getElementById('folderNameInput').value.trim();
    if (!name) return alert('Введите название папки');

    try {
        const formData = new FormData();
        formData.append('user_id', user_id);
        formData.append('name', name);

        const resp = await fetch('/api/folders', {
            method: 'POST',
            body: formData,
        });
        const result = await resp.json();

        // Добавляем папку в боковую панель
        const container = document.getElementById('foldersContainer');
        const div = document.createElement('div');
        div.className = 'folder-item active';
        div.dataset.folderId = result.id;
        div.onclick = function() { selectFolder(result.id); };
        div.innerHTML = `
            <span class="folder-icon">📁</span>
            <span class="folder-name">${escapeHtml(name)}</span>
            <span class="folder-count" id="count-${result.id}">0</span>
        `;

        // Убираем active с других
        container.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
        container.appendChild(div);

        closeModal('folderModal');
        loadNotes(result.id);
    } catch (err) {
        console.error(err);
        alert('Ошибка при создании папки');
    }
}

// === СОЗДАНИЕ ЗАМЕТКИ ===
async function createNote() {
    const content = document.getElementById('noteContentInput').value.trim();
    if (!content) return alert('Введите текст заметки');

    try {
        const formData = new FormData();
        formData.append('user_id', user_id);
        formData.append('folder_id', activeFolderId);
        formData.append('content', content);
        formData.append('is_task', 0);

        const resp = await fetch('/api/notes', { method: 'POST', body: formData });
        await resp.json();

        closeModal('noteModal');
        loadNotes(activeFolderId);
    } catch (err) {
        console.error(err);
        alert('Ошибка при создании заметки');
    }
}

// === СОЗДАНИЕ ЗАДАЧИ ===
async function createTask() {
    const content = document.getElementById('taskContentInput').value.trim();
    if (!content) return alert('Введите описание задачи');

    try {
        const formData = new FormData();
        formData.append('user_id', user_id);
        formData.append('folder_id', activeFolderId);
        formData.append('content', content);
        formData.append('is_task', 1);

        const resp = await fetch('/api/notes', { method: 'POST', body: formData });
        await resp.json();

        closeModal('taskModal');
        loadNotes(activeFolderId);
    } catch (err) {
        console.error(err);
        alert('Ошибка при создании задачи');
    }
}

// === ПЕРЕКЛЮЧЕНИЕ СТАТУСА ЗАДАЧИ ===
async function toggleDone(noteId) {
    try {
        await fetch(`/api/notes/${noteId}/toggle?user_id=${user_id}`, { method: 'PUT' });
        loadNotes(activeFolderId);
    } catch (err) {
        console.error(err);
    }
}

// === УДАЛЕНИЕ ЗАМЕТКИ ===
async function deleteNote(noteId) {
    if (!confirm('Удалить заметку?')) return;
    try {
        await fetch(`/api/notes/${noteId}?user_id=${user_id}`, { method: 'DELETE' });
        loadNotes(activeFolderId);
    } catch (err) {
        console.error(err);
    }
}

// === ДЕТАЛИ ЗАМЕТКИ ===
async function showNoteDetail(noteId) {
    try {
        const resp = await fetch(`/api/notes/${noteId}?user_id=${user_id}`);
        const note = await resp.json();

        const modal = document.getElementById('detailModal');
        const content = document.getElementById('detailContent');

        const isTask = note.is_task === 1;
        const isDone = note.is_done === 1;

        content.innerHTML = `
            <div class="meta">
                <span>📁 Папка #${note.folder_id}</span> · 
                <span>📄 ${note.content_type}</span> ·
                <span>🕐 ${new Date(note.created_at).toLocaleString('ru-RU')}</span>
            </div>
            <div class="body">${escapeHtml(note.content || '(медиафайл)')}</div>
            ${isTask ? `
                <div style="margin-top: 12px;">
                    <span class="note-badge ${isDone ? 'done' : 'task'}">
                        ${isDone ? '✅ Выполнено' : '⬜ В работе'}
                    </span>
                </div>
            ` : ''}
            <div class="reminder-form">
                <h4>⏰ Установить напоминание</h4>
                <input type="datetime-local" id="reminderTime">
                <button class="btn-primary" onclick="setReminder(${noteId})">Установить</button>
            </div>
        `;

        modal.classList.add('show');
    } catch (err) {
        console.error(err);
    }
}

// === НАПОМИНАНИЕ ===
async function setReminder(noteId) {
    const timeInput = document.getElementById('reminderTime');
    if (!timeInput.value) return alert('Выберите дату и время');

    try {
        const formData = new FormData();
        formData.append('user_id', user_id);
        formData.append('note_id', noteId);
        formData.append('remind_at', timeInput.value + ':00');
        formData.append('text', '');

        const resp = await fetch('/api/reminders', { method: 'POST', body: formData });
        await resp.json();
        alert('✅ Напоминание установлено!');
        closeModal('detailModal');
    } catch (err) {
        console.error(err);
        alert('Ошибка при установке напоминания');
    }
}

// === ПОИСК ===
let searchTimeout;
async function searchNotes(query) {
    clearTimeout(searchTimeout);
    if (!query.trim()) {
        loadNotes(activeFolderId);
        return;
    }

    searchTimeout = setTimeout(async () => {
        try {
            const resp = await fetch(`/api/search?user_id=${user_id}&q=${encodeURIComponent(query)}`);
            const notes = await resp.json();

            const container = document.getElementById('notesContainer');
            if (notes.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="icon">🔍</div>
                        <h3>Ничего не найдено</h3>
                        <p>Попробуйте изменить запрос</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = notes.map(note => renderNoteCard(note)).join('');
        } catch (err) {
            console.error(err);
        }
    }, 400);
}

// === HELPER ===
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
