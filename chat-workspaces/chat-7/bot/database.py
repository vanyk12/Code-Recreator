
import sqlite3
import aiosqlite
from datetime import datetime
from config import DATABASE_PATH
from typing import Optional, List, Tuple


# --- Synchronous init ---
def init_db():
    conn = sqlite3.connect(DATABASE_PATH)
    cur = conn.cursor()
    cur.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            folder_id INTEGER,
            content_type TEXT DEFAULT 'text',
            content TEXT,
            file_id TEXT,
            caption TEXT,
            is_task INTEGER DEFAULT 0,
            assigned_to INTEGER,
            is_done INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(user_id),
            FOREIGN KEY (folder_id) REFERENCES folders(id)
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            note_id INTEGER,
            remind_at TEXT NOT NULL,
            text TEXT,
            is_sent INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(user_id),
            FOREIGN KEY (note_id) REFERENCES notes(id)
        );

        CREATE TABLE IF NOT EXISTS chat_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT DEFAULT 'member',
            joined_at TEXT DEFAULT (datetime('now')),
            UNIQUE(chat_id, user_id)
        );
    """)
    conn.commit()
    conn.close()


# --- Async helpers ---
async def add_user(user_id: int, username: Optional[str], first_name: Optional[str]):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO users (user_id, username, first_name) VALUES (?, ?, ?)",
            (user_id, username, first_name),
        )
        await db.commit()


async def get_folders(user_id: int) -> List[Tuple[int, str]]:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, name FROM folders WHERE user_id = ? ORDER BY created_at", (user_id,)
        )
        rows = await cursor.fetchall()
        return [(row["id"], row["name"]) for row in rows]


async def add_folder(user_id: int, name: str) -> int:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO folders (user_id, name) VALUES (?, ?)", (user_id, name)
        )
        await db.commit()
        return cursor.lastrowid


async def delete_folder(folder_id: int, user_id: int) -> bool:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # delete all notes in folder
        await db.execute("DELETE FROM notes WHERE folder_id = ? AND user_id = ?", (folder_id, user_id))
        cursor = await db.execute(
            "DELETE FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id)
        )
        await db.commit()
        return cursor.rowcount > 0


async def add_note(
    user_id: int,
    folder_id: int,
    content_type: str = "text",
    content: Optional[str] = None,
    file_id: Optional[str] = None,
    caption: Optional[str] = None,
    is_task: int = 0,
) -> int:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """INSERT INTO notes (user_id, folder_id, content_type, content, file_id, caption, is_task)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, folder_id, content_type, content, file_id, caption, is_task),
        )
        await db.commit()
        return cursor.lastrowid


async def get_notes_by_folder(user_id: int, folder_id: int) -> List[dict]:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT id, content_type, content, file_id, caption, is_task, is_done, assigned_to, created_at
               FROM notes WHERE user_id = ? AND folder_id = ? ORDER BY created_at DESC""",
            (user_id, folder_id),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_note_by_id(note_id: int, user_id: int) -> Optional[dict]:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def toggle_task_done(note_id: int, user_id: int):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            "UPDATE notes SET is_done = CASE WHEN is_done = 0 THEN 1 ELSE 0 END WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        )
        await db.commit()


async def assign_task(note_id: int, assigned_to: int, user_id: int):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            "UPDATE notes SET assigned_to = ? WHERE id = ? AND user_id = ?",
            (assigned_to, note_id, user_id),
        )
        await db.commit()


async def delete_note(note_id: int, user_id: int) -> bool:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("DELETE FROM reminders WHERE note_id = ?", (note_id,))
        cursor = await db.execute(
            "DELETE FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id)
        )
        await db.commit()
        return cursor.rowcount > 0


async def add_reminder(user_id: int, note_id: int, remind_at: str, text: str):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO reminders (user_id, note_id, remind_at, text) VALUES (?, ?, ?, ?)",
            (user_id, note_id, remind_at, text),
        )
        await db.commit()
        return cursor.lastrowid


async def get_pending_reminders() -> List[dict]:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT id, user_id, note_id, text FROM reminders
               WHERE is_sent = 0 AND remind_at <= datetime('now')"""
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def mark_reminder_sent(reminder_id: int):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            "UPDATE reminders SET is_sent = 1 WHERE id = ?", (reminder_id,)
        )
        await db.commit()


async def add_chat_member(chat_id: int, user_id: int, role: str = "member"):
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO chat_members (chat_id, user_id, role) VALUES (?, ?, ?)",
            (chat_id, user_id, role),
        )
        await db.commit()
