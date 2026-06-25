
import os
import sys
import asyncio
import logging
from pathlib import Path
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query, Request, Form
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from contextlib import asynccontextmanager

# Добавляем корень проекта в путь
sys.path.insert(0, str(Path(__file__).parent.parent))
from database import (
    get_folders,
    get_notes_by_folder,
    get_note_by_id,
    add_note,
    add_folder,
    delete_folder,
    delete_note,
    toggle_task_done,
    assign_task,
    add_reminder,
    add_user,
)
from config import DATABASE_PATH

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

app = FastAPI(title="Toucan Web")

# Монтируем статику
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request, user_id: int | None = None):
    """Главная страница. Если user_id не указан, показываем страницу входа."""
    if not user_id:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": None},
        )
    # Проверяем, существует ли пользователь
    import aiosqlite
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "SELECT user_id, username, first_name FROM users WHERE user_id = ?",
            (user_id,),
        )
        user = await cursor.fetchone()
        if not user:
            return templates.TemplateResponse(
                "login.html",
                {"request": request, "error": "Пользователь не найден. Сначала напишите боту в Telegram."},
            )
    return RedirectResponse(url=f"/dashboard?user_id={user_id}")


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request, user_id: int):
    """Дашборд с папками и заметками."""
    folders = await get_folders(user_id)
    import aiosqlite
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "SELECT first_name, username FROM users WHERE user_id = ?", (user_id,)
        )
        user = await cursor.fetchone()

    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "user_id": user_id,
            "username": user[0] or user[1] if user else str(user_id),
            "folders": folders,
        },
    )


# ============== API ==============

@app.get("/api/folders")
async def api_get_folders(user_id: int):
    folders = await get_folders(user_id)
    return [{"id": fid, "name": fname} for fid, fname in folders]


@app.post("/api/folders")
async def api_create_folder(user_id: int, name: str = Form(...)):
    if len(name.strip()) < 1:
        raise HTTPException(400, "Название не может быть пустым")
    fid = await add_folder(user_id, name.strip())
    return {"id": fid, "name": name.strip()}


@app.delete("/api/folders/{folder_id}")
async def api_delete_folder(folder_id: int, user_id: int):
    success = await delete_folder(folder_id, user_id)
    if not success:
        raise HTTPException(404, "Папка не найдена")
    return {"ok": True}


@app.get("/api/folders/{folder_id}/notes")
async def api_get_notes(folder_id: int, user_id: int):
    notes = await get_notes_by_folder(user_id, folder_id)
    return notes


@app.get("/api/notes/{note_id}")
async def api_get_note(note_id: int, user_id: int):
    note = await get_note_by_id(note_id, user_id)
    if not note:
        raise HTTPException(404, "Заметка не найдена")
    return note


@app.post("/api/notes")
async def api_create_note(
    user_id: int,
    folder_id: int = Form(...),
    content: str = Form(""),
    is_task: int = Form(0),
):
    if not content.strip() and is_task == 0:
        raise HTTPException(400, "Содержание не может быть пустым")
    note_id = await add_note(
        user_id=user_id,
        folder_id=folder_id,
        content_type="text",
        content=content.strip(),
        is_task=is_task,
    )
    return {"id": note_id}


@app.put("/api/notes/{note_id}/toggle")
async def api_toggle_note(note_id: int, user_id: int):
    await toggle_task_done(note_id, user_id)
    note = await get_note_by_id(note_id, user_id)
    return {"is_done": note["is_done"] if note else 0}


@app.delete("/api/notes/{note_id}")
async def api_delete_note(note_id: int, user_id: int):
    success = await delete_note(note_id, user_id)
    if not success:
        raise HTTPException(404, "Заметка не найдена")
    return {"ok": True}


@app.post("/api/reminders")
async def api_create_reminder(
    user_id: int,
    note_id: int = Form(...),
    remind_at: str = Form(...),
    text: str = Form(""),
):
    await add_reminder(user_id, note_id, remind_at, text)
    return {"ok": True}


@app.get("/api/search")
async def api_search(user_id: int, q: str = Query("")):
    """Поиск по заметкам пользователя."""
    import aiosqlite
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT id, folder_id, content, content_type, is_task, is_done, created_at
               FROM notes
               WHERE user_id = ? AND content LIKE ?
               ORDER BY created_at DESC LIMIT 50""",
            (user_id, f"%{q}%"),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


if __name__ == "__main__":
    import uvicorn
    # Инициализируем БД при запуске
    from database import init_db
    init_db()
    logger.info("Starting web server on http://localhost:8080")
    uvicorn.run(app, host="0.0.0.0", port=8080)
