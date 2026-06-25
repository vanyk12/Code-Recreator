
import logging
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from datetime import datetime
import re

from database import (
    add_reminder,
    get_folders,
    get_notes_by_folder,
    get_note_by_id,
)
from keyboards import main_menu_keyboard

router = Router()
logger = logging.getLogger(__name__)


class ReminderStates(StatesGroup):
    waiting_for_folder = State()
    waiting_for_note = State()
    waiting_for_time = State()
    waiting_for_text = State()


# Обработка фразы "напомни ..."
@router.message(lambda msg: msg.text and msg.text.lower().startswith("напомни"))
async def parse_reminder(message: Message, state: FSMContext):
    """Распознаёт: напомни завтра в 10:00 сделать Х"""
    text = message.text[7:].strip()

    # Простой парсинг времени
    time_pattern = r"(\d{1,2}:\d{2})"
    match = re.search(time_pattern, text)
    remind_text = text

    if match:
        time_str = match.group(1)
        remind_text = text.replace(match.group(0), "").strip()

        # Определяем дату
        today = datetime.now()
        if "завтра" in text.lower():
            day = today.day + 1
            month = today.month
            year = today.year
        elif "послезавтра" in text.lower():
            day = today.day + 2
            month = today.month
            year = today.year
        else:
            day = today.day
            month = today.month
            year = today.year

        remind_dt = f"{year:04d}-{month:02d}-{day:02d} {time_str}:00"

        # Сохраняем напрямую как заметку + напоминание
        folders = await get_folders(message.from_user.id)
        if not folders:
            from database import add_folder as af
            await af(message.from_user.id, "📥 Напоминания")
            folders = await get_folders(message.from_user.id)

        # Создаём заметку
        from database import add_note
        note_id = await add_note(
            user_id=message.from_user.id,
            folder_id=folders[0][0],
            content_type="text",
            content=remind_text,
            is_task=1,
        )

        # Создаём напоминание
        await add_reminder(
            user_id=message.from_user.id,
            note_id=note_id,
            remind_at=remind_dt,
            text=remind_text,
        )

        await message.answer(
            f"✅ Напоминание установлено на {day}.{month:02d}.{year} в {time_str}\n"
            f"📝 Текст: {remind_text}",
            reply_markup=main_menu_keyboard(),
        )
    else:
        await message.answer(
            "❌ Не удалось распознать время.\n"
            "Пример: «напомни завтра в 10:00 купить молоко»"
        )


@router.callback_query(F.data.startswith("set_reminder:"))
async def set_reminder_start(callback: CallbackQuery, state: FSMContext):
    note_id = int(callback.data.split(":")[1])
    await state.update_data(note_id=note_id)
    await state.set_state(ReminderStates.waiting_for_time)
    await callback.message.edit_text(
        "⏰ Введите дату и время напоминания в формате:\n"
        "`ДД.ММ.ГГГГ ЧЧ:ММ`\n"
        "Например: `25.12.2025 15:30`"
    )
    await callback.answer()


@router.message(ReminderStates.waiting_for_time)
async def set_reminder_time(message: Message, state: FSMContext):
    text = message.text.strip()
    # Парсим "25.12.2025 15:30"
    pattern = r"(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})"
    match = re.match(pattern, text)
    if not match:
        await message.answer(
            "❌ Неверный формат. Используйте: `ДД.ММ.ГГГГ ЧЧ:ММ`\n"
            "Например: `25.12.2025 15:30`"
        )
        return

    day, month, year, hour, minute = match.groups()
    remind_dt = f"{year}-{month}-{day} {hour}:{minute}:00"

    data = await state.get_data()
    note_id = data.get("note_id")
    note = await get_note_by_id(note_id, message.from_user.id)

    if not note:
        await message.answer("❌ Заметка не найдена.")
        await state.clear()
        return

    await add_reminder(
        user_id=message.from_user.id,
        note_id=note_id,
        remind_at=remind_dt,
        text=note["content"] or "Напоминание",
    )

    await state.clear()
    await message.answer(
        f"✅ Напоминание установлено на {day}.{month}.{year} в {hour}:{minute}",
        reply_markup=main_menu_keyboard(),
    )


@router.message(F.text == "⏰ Напоминания")
async def show_reminders_help(message: Message):
    await message.answer(
        "⏰ **Напоминания**\n\n"
        "Чтобы установить напоминание, просто напишите:\n"
        "`напомни завтра в 10:00 купить молоко`\n\n"
        "Или выберите заметку и нажмите «⏰ Напомнить».\n\n"
        "Формат времени: `ДД.ММ.ГГГГ ЧЧ:ММ`"
    )
