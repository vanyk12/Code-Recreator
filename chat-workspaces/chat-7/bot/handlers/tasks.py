
import logging
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from database import get_note_by_id, toggle_task_done, add_note, get_folders, assign_task
from keyboards import folder_picker_keyboard, main_menu_keyboard

router = Router()
logger = logging.getLogger(__name__)


class TaskStates(StatesGroup):
    waiting_for_folder = State()


@router.callback_query(F.data.startswith("toggle_done:"))
async def toggle_done(callback: CallbackQuery):
    note_id = int(callback.data.split(":")[1])
    user_id = callback.from_user.id
    await toggle_task_done(note_id, user_id)
    note = await get_note_by_id(note_id, user_id)
    if note:
        status = "✅" if note["is_done"] else "⬜"
        await callback.message.edit_text(f"{status} Статус задачи обновлён!")
    else:
        await callback.message.edit_text("❌ Задача не найдена.")
    await callback.answer()


@router.message(lambda msg: msg.text and msg.text.lower().startswith("задача:"))
async def create_task_from_text(message: Message, state: FSMContext):
    """Создать задачу напрямую: Задача: купить молоко"""
    content = message.text[7:].strip()
    if not content:
        await message.answer("❌ Напишите так: `Задача: купить молоко`")
        return

    folders = await get_folders(message.from_user.id)
    if not folders:
        from database import add_folder as af
        await af(message.from_user.id, "📋 Задачи")
        folders = await get_folders(message.from_user.id)

    await state.update_data(
        content_type="text",
        content=content,
        file_id=None,
        caption=None,
        is_task=1,
    )
    await state.set_state(TaskStates.waiting_for_folder)
    await message.answer(
        "📂 В какую папку сохранить задачу?",
        reply_markup=folder_picker_keyboard(folders, "save_task_to"),
    )


@router.callback_query(F.data.startswith("save_task_to:"))
async def save_task_to_folder(callback: CallbackQuery, state: FSMContext):
    folder_id = int(callback.data.split(":")[1])
    user_id = callback.from_user.id
    data = await state.get_data()

    if not data:
        await callback.message.edit_text("❌ Ошибка: данные не найдены.")
        await callback.answer()
        return

    note_id = await add_note(
        user_id=user_id,
        folder_id=folder_id,
        content_type=data.get("content_type", "text"),
        content=data.get("content"),
        is_task=1,
    )

    await state.clear()
    await callback.message.edit_text(f"✅ Задача создана! ID: {note_id}")
    await callback.answer()
