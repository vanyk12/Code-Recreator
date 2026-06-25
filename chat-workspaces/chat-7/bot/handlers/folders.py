
import logging
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from database import get_folders, add_folder, delete_folder, get_notes_by_folder
from keyboards import (
    main_menu_keyboard,
    folder_actions_keyboard,
    notes_list_keyboard,
)

router = Router()
logger = logging.getLogger(__name__)


class FolderStates(StatesGroup):
    waiting_for_name = State()


@router.message(F.text == "📁 Мои папки")
async def show_folders(message: Message):
    folders = await get_folders(message.from_user.id)
    if not folders:
        await message.answer(
            "📁 У вас пока нет папок.\nСоздайте новую через кнопку «➕ Новая папка»",
            reply_markup=main_menu_keyboard(),
        )
        return

    text = "📁 **Ваши папки:**\n\n"
    for fid, fname in folders:
        notes = await get_notes_by_folder(message.from_user.id, fid)
        done_count = sum(1 for n in notes if n["is_done"])
        total_count = len(notes)
        text += f"• {fname} ({done_count}/{total_count} задач)\n"
        await message.answer(f"📁 **{fname}**", reply_markup=folder_actions_keyboard(fid))

    await message.answer("Выберите действие с папкой выше 👆", reply_markup=main_menu_keyboard())


@router.message(F.text == "➕ Новая папка")
async def new_folder_start(message: Message, state: FSMContext):
    await state.set_state(FolderStates.waiting_for_name)
    await message.answer("✏️ Введите название новой папки:")


@router.message(F.text, FolderStates.waiting_for_name)
async def new_folder_finish(message: Message, state: FSMContext):
    name = message.text.strip()
    if len(name) > 50:
        await message.answer("❌ Название слишком длинное (макс. 50 символов). Попробуйте короче.")
        return

    await add_folder(message.from_user.id, name)
    await state.clear()
    await message.answer(f"✅ Папка «{name}» создана!", reply_markup=main_menu_keyboard())


@router.callback_query(F.data.startswith("view_folder:"))
async def view_folder(callback: CallbackQuery):
    folder_id = int(callback.data.split(":")[1])
    user_id = callback.from_user.id
    notes = await get_notes_by_folder(user_id, folder_id)

    if not notes:
        await callback.message.edit_text(
            "📭 В этой папке пока нет заметок.\nОтправьте мне любое сообщение, чтобы сохранить его.",
        )
        await callback.answer()
        return

    await callback.message.edit_text(
        f"📝 Заметки в папке ({len(notes)} шт.):",
        reply_markup=notes_list_keyboard(notes, folder_id),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("del_folder:"))
async def remove_folder(callback: CallbackQuery):
    folder_id = int(callback.data.split(":")[1])
    user_id = callback.from_user.id
    success = await delete_folder(folder_id, user_id)
    if success:
        await callback.message.edit_text("✅ Папка удалена вместе с содержимым.")
    else:
        await callback.message.edit_text("❌ Не удалось удалить папку.")
    await callback.answer()


@router.callback_query(F.data == "back_to_folders")
async def back_to_folders(callback: CallbackQuery):
    await callback.message.edit_text("📁 Возвращаемся к папкам...")
    await callback.answer()
    # User can press "Мои папки" again
