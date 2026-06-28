
import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
import google.generativeai as genai
from config import TELEGRAM_BOT_TOKEN, GEMINI_API_KEY

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-pro')

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Привет! Я бот с интеграцией Google Gemini.\n"
        "Просто напиши мне сообщение, и я отвечу с помощью ИИ."
    )

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Доступные команды:\n"
        "/start - начать работу\n"
        "/help - показать это сообщение\n"
        "/clear - очистить историю диалога\n\n"
        "Просто отправь любое сообщение, и я отвечу!"
    )

async def clear_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if 'history' in context.user_data:
        context.user_data['history'] = []
    await update.message.reply_text("История диалога очищена!")

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_message = update.message.text
    user_id = update.message.from_user.id

    try:
        if 'history' not in context.user_data:
            context.user_data['history'] = []

        context.user_data['history'].append({"role": "user", "parts": [user_message]})

        await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")

        response = model.generate_content(user_message)

        if response.prompt_feedback and response.prompt_feedback.block_reason:
            await update.message.reply_text(
                f"❌ Запрос заблокирован по причине: {response.prompt_feedback.block_reason}"
            )
            return

        bot_response = response.text

        context.user_data['history'].append({"role": "model", "parts": [bot_response]})

        await update.message.reply_text(bot_response)

    except Exception as e:
        logger.error(f"Ошибка при обработке сообщения: {e}")
        await update.message.reply_text(
            f"❌ Произошла ошибка: {str(e)}\n"
            "Попробуйте еще раз или измените запрос."
        )

async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.error(f"Update {update} caused error {context.error}")

    if update and update.effective_message:
        await update.effective_message.reply_text(
            "❌ Извините, произошла внутренняя ошибка. Попробуйте позже."
        )

def main():
    if not TELEGRAM_BOT_TOKEN or not GEMINI_API_KEY:
        logger.error("Не найдены TELEGRAM_BOT_TOKEN или GEMINI_API_KEY в переменных окружения")
        print("❌ Ошибка: Установите TELEGRAM_BOT_TOKEN и GEMINI_API_KEY в переменных окружения")
        return

    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("clear", clear_command))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    application.add_error_handler(error_handler)

    print("🤖 Бот запущен! Нажми Ctrl+C для остановки.")
    logger.info("Бот запущен")
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
