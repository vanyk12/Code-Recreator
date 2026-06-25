
import logging
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, ContentType
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from database import get_folders, add_note, get_notes_by_folder, get_note_by_id, delete_note, add_user
from keyboards import (
    main_menu_keyboard,
    folder_picker_keyboard,
    note_actions_keyboard,
    cancel_keyboard,
)
from config import DATABASE_PATH

router = Router()
logger = logging.getLogger(__name__)


class NoteStates(StatesGroup):
    waiting_for_folder = State()


async def handle_incoming_content(message: Message, content_type: str):
    """Обрабатывает любое входящее сообщение и предлагает сохранить в папку."""
    user = message.from_user
    await add_user(user.id, user.username, user.first_name)

    folders = await get_folders(user.id)
    if not folders:
        # Создаём папку "Общее" по умолчанию
        from database import add_folder
        await add_folder(user.id, "📥 Общее")
        folders = await get_folders(user.id)

    # Сохраняем контент в FSM
    state = FSMContext(
        storage=message.bot.storage,
        key=f"user:{user.id}:note_content"
    )
    # Используем Datastore или просто сохраняем во временной переменной
    # Проще: передаём через callback_data или храним в FSM

    # Покажем клавиатуру выбора папки
    await message.answer(
        "📂 В какую папку сохранить?",
        reply_markup=folder_picker_keyboard(folders, "save_note_to"),
    )


@router.message(F.text & ~F.text.startswith("/") & ~F.text.startswith("➕") & ~F.text.startswith("📁") & ~F.text.startswith("⏰"))
async def handle_text(message: Message, state: FSMContext):
    # Сохраняем контент в state
    await state.update_data(
        content_type="text",
        content=message.text,
        file_id=None,
        caption=None,
    )
    await handle_incoming_content(message, "text")


@router.message(F.photo)
async def handle_photo(message: Message, state: FSMContext):
    photo = message.photo[-1]
    await state.update_data(
        content_type="photo",
        content=message.caption or "",
        file_id=photo.file_id,
        caption=message.caption,
    )
    await handle_incoming_content(message, "photo")


@router.message(F.video)
async def handle_video(message: Message, state: FSMContext):
    video = message.video
    await state.update_data(
        content_type="video",
        content=message.caption or "",
        file_id=video.file_id,
        caption=message.caption,
    )
    await handle_incoming_content(message, "video")


@router.message(F.voice)
async def handle_voice(message: Message, state: FSMContext):
    voice = message.voice
    await state.update_data(
        content_type="voice",
        content=message.caption or "",
        file_id=voice.file_id,
        caption=message.caption,
    )
    await handle_incoming_content(message, "voice")


@router.message(F.document)
async def handle_document(message: Message, state: FSMContext):
    doc = message.document
    await state.update_data(
        content_type="document",
        content=message.caption or doc.file_name or "",
        file_id=doc.file_id,
        caption=message.caption,
    )
    await handle_incoming_content(message, "document")


@router.callback_query(F.data.startswith("save_note_to:"))
async def save_note_to_folder(callback: CallbackQuery, state: FSMContext):
    folder_id = int(callback.data.split(":")[1])
    user_id = callback.from_user.id
    data = await state.get_data()

    if not data:
        await callback.message.edit_text("❌ Ошибка: данные не найдены. Попробуйте снова.")
        await callback.answer()
        return

    note_id = await add_note(
        user_id=user_id,
        folder_id=folder_id,
        content_type=data.get("content_type", "text"),
        content=data.get("content"),
        file_id=data.get("file_id"),
        caption=data.get("caption"),
    )

    await state.clear()
    await callback.message.edit_text(f"✅ Сохранено! ID заметки: {note_id}")
    await callback.answer()


@router.callback_query(F.data.startswith("view_note:"))
async def view_note(callback: CallbackQuery):
    note_id = int(callback.data.split(":")[1])
    user_id = callback.from_user.id
    note = await get_note_by_id(note_id, user_id)

    if not note:
        await callback.message.edit_text("❌ Заметка не найдена.")
        await callback.answer()
        return

    text = f"📌 **Заметка #{note['id']}**\n"
    text += f"📁 Папка: {note['folder_id']}\n"
    text += f"📄 Тип: {note['content_type']}\n"
    text += f"📝 Содержание: {note['content'] or 'медиафайл'}\n"
    if note["is_task"]:
        status = "✅ Выполнено" if note["is_done"] else "⬜ В работе"
        text += f"📊 Статус: {status}\n"
    if note["assigned_to"]:
        text += f"👤 Ответственный: {note['assigned_to']}\n"
    text += f"🕐 Создано: {note['created_at']}"

    # Отправляем медиа если есть
    if note["file_id"] and note["content_type"] == "photo":
        await callback.message.answer_photo(
            photo=note["file_id"],
            caption=text,
            reply_markup=note_actions_keyboard(note["id"], note["is_task"], note["is_done"]),
        )
    elif note["file_id"] and note["content_type"] == "video":
        await callback.message.answer_video(
            video=note["file_id"],
            caption=text,
            reply_markup=note_actions_keyboard(note["id"], note["is_task"], note["is_done"]),
        )
    elif note["file_id"] and note["content_type"] == "voice":
        await callback.message.answer_voice(
            voice=note["file_id"],
            caption=text,
            reply_markup=note_actions_keyboard(note["id"], note["is_task"], note["is_done"]),
        )
    elif note["file_id"] and note["content_type"] == "document":
        await callback.message.answer_document(
            document=note["file_id"],
            caption=text,
            reply_markup=note_actions_keyboard(note["id"], note["is_task"], note["is_done"]),
        )
    else:
        await callback.message.edit_text(text, reply_markup=note_actions_keyboard(note["id"], note["is_task"], note["is_done"]))
    await callback.answer()


@router.callback_query(F.data.startswith("del_note:"))
async def remove_note(callback: CallbackQuery):
    note_id = int(callback.data.split(":")[1])
    user_id = callback.from_user.id
    success = await delete_note(note_id, user_id)
    if success:
        await callback.message.edit_text("✅ Заметка удалена.")
    else:
        await callback.message.edit_text("❌ Не удалось удалить заметку.")
    await callback.answer()


@router.callback_query(F.data.startswith("back_to_folder:"))
async def back_to_folder_notes(callback: CallbackQuery):
    # Найдём folder_id по заметке — для простоты покажем папки
    await callback.message.edit_text("📁 Используйте «Мои папки» в меню для просмотра.")
    await callback.answer()
