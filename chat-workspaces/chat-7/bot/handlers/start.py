
import logging
from aiogram import Router, F
from aiogram.filters import CommandStart, Command
from aiogram.types import Message, CallbackQuery
from database import add_user
from keyboards import main_menu_keyboard

router = Router()
logger = logging.getLogger(__name__)


@router.message(CommandStart())
async def cmd_start(message: Message):
    user = message.from_user
    await add_user(user.id, user.username, user.first_name)

    await message.answer(
        f"👋 Привет, {user.first_name}!\n\n"
        "Я — бот-органайзер, как Тукан.\n"
        "📌 Помогаю хранить заметки, задачи и напоминания.\n\n"
        "📁 Отправь мне любое сообщение (текст, фото, видео, голосовое) — "
        "я помогу его отсортировать по папкам.\n\n"
        "Используй кнопки меню ниже 👇",
        reply_markup=main_menu_keyboard(),
    )


@router.message(Command("help"))
async def cmd_help(message: Message):
    await message.answer(
        "🤖 Как пользоваться ботом:\n\n"
        "📁 **Мои папки** — просмотреть все папки\n"
        "➕ **Новая папка** — создать папку\n"
        "📩 **Отправь любое сообщение** — я предложу сохранить его в папку\n"
        "✅ **Задачи** — можно отмечать как выполненные\n"
        "👥 **Групповые чаты** — добавьте меня в группу, чтобы назначать задачи\n"
        "⏰ **Напоминания** — установите напоминание на задачу\n\n"
        "Пример: отправьте «напомни завтра в 10:00 купить молоко»"
    )


@router.message(Command("menu"))
async def cmd_menu(message: Message):
    await message.answer("Главное меню:", reply_markup=main_menu_keyboard())


@router.callback_query(F.data == "cancel")
async def cancel_action(callback: CallbackQuery):
    await callback.message.edit_text("❌ Действие отменено.")
    await callback.answer()
