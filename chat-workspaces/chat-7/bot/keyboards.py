
from aiogram.types import (
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    ReplyKeyboardMarkup,
    KeyboardButton,
)
from typing import List, Tuple


def main_menu_keyboard() -> ReplyKeyboardMarkup:
    kb = [
        [KeyboardButton(text="📁 Мои папки")],
        [KeyboardButton(text="➕ Новая папка")],
        [KeyboardButton(text="⏰ Напоминания")],
    ]
    return ReplyKeyboardMarkup(keyboard=kb, resize_keyboard=True)


def folder_actions_keyboard(folder_id: int) -> InlineKeyboardMarkup:
    buttons = [
        [
            InlineKeyboardButton(text="📝 Просмотр", callback_data=f"view_folder:{folder_id}"),
            InlineKeyboardButton(text="❌ Удалить", callback_data=f"del_folder:{folder_id}"),
        ]
    ]
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def notes_list_keyboard(notes: List[dict], folder_id: int) -> InlineKeyboardMarkup:
    buttons = []
    for note in notes:
        prefix = "✅" if note["is_done"] else "⬜"
        label = f"{prefix} {note['content'][:30]}" if note["content"] else f"{prefix} [{note['content_type']}]"
        buttons.append([
            InlineKeyboardButton(text=label, callback_data=f"view_note:{note['id']}")
        ])
    buttons.append([
        InlineKeyboardButton(text="🔙 Назад", callback_data="back_to_folders")
    ])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def note_actions_keyboard(note_id: int, is_task: int, is_done: int) -> InlineKeyboardMarkup:
    buttons = []
    if is_task:
        status_text = "✅ Выполнено" if not is_done else "🔄 Отменить выполнение"
        buttons.append([
            InlineKeyboardButton(text=status_text, callback_data=f"toggle_done:{note_id}")
        ])
    buttons.append([
        InlineKeyboardButton(text="⏰ Напомнить", callback_data=f"set_reminder:{note_id}"),
        InlineKeyboardButton(text="❌ Удалить", callback_data=f"del_note:{note_id}"),
    ])
    buttons.append([
        InlineKeyboardButton(text="🔙 Назад", callback_data=f"back_to_folder:notes")
    ])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def folder_picker_keyboard(folders: List[Tuple[int, str]], action: str) -> InlineKeyboardMarkup:
    buttons = []
    for fid, fname in folders:
        buttons.append([
            InlineKeyboardButton(text=fname, callback_data=f"{action}:{fid}")
        ])
    buttons.append([
        InlineKeyboardButton(text="🔙 Отмена", callback_data="cancel")
    ])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def cancel_keyboard() -> InlineKeyboardMarkup:
    kb = [[InlineKeyboardButton(text="🔙 Отмена", callback_data="cancel")]]
    return InlineKeyboardMarkup(inline_keyboard=kb)
