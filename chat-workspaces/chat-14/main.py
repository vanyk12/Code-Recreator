
import os
import json
import logging
from dotenv import load_dotenv
from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
)
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN не задан! Создайте .env файл и укажите токен от @BotFather")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# ─── База товаров ───
CATEGORIES = {
    "electronics": {"name": "📱 Электроника", "products": ["phone", "headphones", "powerbank"]},
    "clothing": {"name": "👕 Одежда", "products": ["tshirt", "hoodie", "cap"]},
    "accessories": {"name": "⌚ Аксессуары", "products": ["watch", "bag", "wallet"]},
    "home": {"name": "🏠 Для дома", "products": ["lamp", "pillow", "mug"]},
}

PRODUCTS = {
    "phone": {"name": "📱 Смартфон X Pro", "price": 29990, "desc": "6.5\" экран, 128GB, тройная камера 48MP", "category": "electronics", "image": "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400"},
    "headphones": {"name": "🎧 Беспроводные наушники", "price": 4990, "desc": "Bluetooth 5.2, активное шумоподавление, 30ч работы", "category": "electronics", "image": "https://images.unsplash.com/photo-1505740420928-5e560c81d3e5?w=400"},
    "powerbank": {"name": "🔋 PowerBank 20000mAh", "price": 1990, "desc": "Быстрая зарядка, 2 USB порта, Type-C", "category": "electronics", "image": "https://images.unsplash.com/photo-1609592484867-98729179752d?w=400"},
    "tshirt": {"name": "👕 Футболка оверсайз", "price": 1490, "desc": "100% хлопок, унисекс, 5 цветов", "category": "clothing", "image": "https://images.unsplash.com/photo-1521572163474-6864f9b17f5b?w=400"},
    "hoodie": {"name": "🧥 Худи утеплённое", "price": 3490, "desc": "Флис внутри, капюшон, карман-кенгуру", "category": "clothing", "image": "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400"},
    "cap": {"name": "🧢 Кепка с логотипом", "price": 990, "desc": "Регулируемая, 100% полиэстер, вышивка", "category": "clothing", "image": "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=400"},
    "watch": {"name": "⌚ Смарт-часы Watch S", "price": 8990, "desc": "Пульсометр, GPS, пульсоксиметр, AMOLED", "category": "accessories", "image": "https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=400"},
    "bag": {"name": "👜 Сумка городская", "price": 2590, "desc": "Водонепроницаемая, отдел для ноутбука 15\"", "category": "accessories", "image": "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400"},
    "wallet": {"name": "👛 Кошелёк кожаный", "price": 1290, "desc": "Натуральная кожа, 8 карточных слотов", "category": "accessories", "image": "https://images.unsplash.com/photo-1627123424574-724758594e93?w=400"},
    "lamp": {"name": "💡 Настольная лампа LED", "price": 1790, "desc": "3 режима яркости, сенсорное управление, USB", "category": "home", "image": "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=400"},
    "pillow": {"name": "🛏️ Подушка ортопедическая", "price": 1990, "desc": "Память формы, гипоаллергенная, чехол в комплекте", "category": "home", "image": "https://images.unsplash.com/photo-1584348174815-72d90f6e0d6e?w=400"},
    "mug": {"name": "☕ Кружка термостойкая", "price": 690, "desc": "500мл, двойные стенки, не обжигает руки", "category": "home", "image": "https://images.unsplash.com/photo-1514228742581-bcd1d9a8e5f1?w=400"},
}

# ─── Корзина (в памяти) ───
carts = {}
# cart[chat_id] = {"product_id": quantity, ...}

# ─── Заказы ───
orders = {}


def get_cart(chat_id):
    if chat_id not in carts:
        carts[chat_id] = {}
    return carts[chat_id]


def cart_total(chat_id):
    cart = get_cart(chat_id)
    return sum(PRODUCTS[pid]["price"] * qty for pid, qty in cart.items())


def cart_count(chat_id):
    return sum(get_cart(chat_id).values())


def fmt_price(price):
    return f"{price:,} ₽".replace(",", " ")


# ═══ КЛАВИАТУРЫ ═══

def main_menu_kb(cart_id=None):
    buttons = [
        [InlineKeyboardButton("🛍 Каталог товаров", callback_data="catalog")],
        [InlineKeyboardButton("🔎 Поиск", callback_data="search"),
         InlineKeyboardButton("🛒 Корзина" + (f" ({cart_count(cart_id)})" if cart_id and cart_count(cart_id) else ""), callback_data="cart")],
        [InlineKeyboardButton("📦 Мои заказы", callback_data="orders")],
        [InlineKeyboardButton("ℹ️ О магазине", callback_data="about"),
         InlineKeyboardButton("📞 Поддержка", callback_data="support")],
    ]
    return InlineKeyboardMarkup(buttons)


def categories_kb():
    buttons = []
    for key, cat in CATEGORIES.items():
        buttons.append([InlineKeyboardButton(cat["name"], callback_data=f"cat:{key}")])
    buttons.append([InlineKeyboardButton("⬅️ Назад", callback_data="main")])
    return InlineKeyboardMarkup(buttons)


def products_kb(category_key):
    buttons = []
    for pid in CATEGORIES[category_key]["products"]:
        p = PRODUCTS[pid]
        buttons.append([InlineKeyboardButton(f"{p['name']} — {fmt_price(p['price'])}", callback_data=f"prod:{pid}")])
    buttons.append([InlineKeyboardButton("⬅️ К категориям", callback_data="catalog")])
    return InlineKeyboardMarkup(buttons)


def product_kb(product_id):
    buttons = [
        [InlineKeyboardButton("➕ Добавить в корзину", callback_data=f"add:{product_id}")],
        [InlineKeyboardButton("🛒 Перейти в корзину", callback_data="cart")],
        [InlineKeyboardButton("⬅️ Назад", callback_data=f"cat:{PRODUCTS[product_id]['category']}")],
    ]
    return InlineKeyboardMarkup(buttons)


def cart_kb(chat_id):
    cart = get_cart(chat_id)
    buttons = []
    for pid, qty in cart.items():
        p = PRODUCTS[pid]
        buttons.append([
            InlineKeyboardButton(f"➖", callback_data=f"dec:{pid}"),
            InlineKeyboardButton(f"{p['name']} x{qty}", callback_data=f"prod:{pid}"),
            InlineKeyboardButton(f"➕", callback_data=f"inc:{pid}"),
        ])
        buttons.append([
            InlineKeyboardButton(f"❌ Удалить {p['name'][:20]}", callback_data=f"del:{pid}"),
        ])
    if cart:
        buttons.append([InlineKeyboardButton(f"✅ Оформить заказ — {fmt_price(cart_total(chat_id))}", callback_data="checkout")])
        buttons.append([InlineKeyboardButton("🗑 Очистить корзину", callback_data="clear_cart")])
    buttons.append([InlineKeyboardButton("⬅️ В меню", callback_data="main")])
    return InlineKeyboardMarkup(buttons)


def checkout_kb():
    buttons = [
        [InlineKeyboardButton("💳 Картой онлайн", callback_data="pay:card")],
        [InlineKeyboardButton("📦 СДЭК / Почта (наложенный платёж)", callback_data="pay:cod")],
        [InlineKeyboardButton("🚚 Курьер по городу", callback_data="pay:courier")],
        [InlineKeyboardButton("⬅️ Назад в корзину", callback_data="cart")],
    ]
    return InlineKeyboardMarkup(buttons)


def confirm_kb(order_id):
    buttons = [
        [InlineKeyboardButton("✅ Подтвердить заказ", callback_data=f"confirm_order:{order_id}")],
        [InlineKeyboardButton("❌ Отменить", callback_data="cart")],
    ]
    return InlineKeyboardMarkup(buttons)


def back_to_main_kb():
    return InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ В главное меню", callback_data="main")]])


# ═══ HANDLERS ═══

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    name = update.effective_user.first_name or "друг"
    text = (
        f"👋 Добро пожаловать, {name}!\n\n"
        f"🏪 **TestShopTG** — ваш онлайн-магазин\n\n"
        f"Здесь вы можете:\n"
        f"🛍 Просмотреть каталог товаров\n"
        f"🔎 Найти нужный товар\n"
        f"🛒 Собрать корзину и оформить заказ\n"
        f"📦 Отслеживать свои заказы\n\n"
        f"Выберите действие на клавиатуре ниже 👇"
    )
    if update.callback_query:
        await update.callback_query.edit_message_text(text, reply_markup=main_menu_kb(chat_id), parse_mode="Markdown")
    else:
        await update.message.reply_text(text, reply_markup=main_menu_kb(chat_id), parse_mode="Markdown")


async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    chat_id = query.message.chat_id
    data = query.data

    # ─── MAIN ───
    if data == "main":
        await start(update, context)

    # ─── CATALOG ───
    elif data == "catalog":
        text = "🛍 **Каталог товаров**\n\nВыберите категорию:"
        await query.edit_message_text(text, reply_markup=categories_kb(), parse_mode="Markdown")

    elif data.startswith("cat:"):
        cat_key = data.split(":")[1]
        cat = CATEGORIES[cat_key]
        text = f"{cat['name']}\n\nВыберите товар:"
        await query.edit_message_text(text, reply_markup=products_kb(cat_key), parse_mode="Markdown")

    elif data.startswith("prod:"):
        pid = data.split(":")[1]
        p = PRODUCTS[pid]
        text = (
            f"{p['name']}\n\n"
            f"📝 {p['desc']}\n\n"
            f"💰 Цена: {fmt_price(p['price'])}\n"
        )
        try:
            await query.message.delete()
        except Exception:
            pass
        await context.bot.send_photo(
            chat_id=chat_id,
            photo=p["image"],
            caption=text,
            reply_markup=product_kb(pid),
            parse_mode="Markdown",
        )

    # ─── CART ───
    elif data == "cart":
        cart = get_cart(chat_id)
        if not cart:
            text = "🛒 Ваша корзина пуста.\n\nДобавьте товары из каталога!"
            await query.edit_message_text(text, reply_markup=back_to_main_kb())
        else:
            lines = ["🛒 **Ваша корзина:**\n"]
            for pid, qty in cart.items():
                p = PRODUCTS[pid]
                lines.append(f"• {p['name']} x{qty} = {fmt_price(p['price'] * qty)}")
            lines.append(f"\n💰 **Итого: {fmt_price(cart_total(chat_id))}**")
            await query.edit_message_text("\n".join(lines), reply_markup=cart_kb(chat_id), parse_mode="Markdown")

    elif data.startswith("add:"):
        pid = data.split(":")[1]
        cart = get_cart(chat_id)
        cart[pid] = cart.get(pid, 0) + 1
        await query.answer(f"✅ {PRODUCTS[pid]['name']} добавлен в корзину!", show_alert=False)

    elif data.startswith("inc:"):
        pid = data.split(":")[1]
        get_cart(chat_id)[pid] = get_cart(chat_id).get(pid, 0) + 1
        await cart_refresh(update, context, chat_id)

    elif data.startswith("dec:"):
        pid = data.split(":")[1]
        cart = get_cart(chat_id)
        if cart[pid] > 1:
            cart[pid] -= 1
        else:
            del cart[pid]
        await cart_refresh(update, context, chat_id)

    elif data.startswith("del:"):
        pid = data.split(":")[1]
        cart = get_cart(chat_id)
        if pid in cart:
            del cart[pid]
        await cart_refresh(update, context, chat_id)

    elif data == "clear_cart":
        carts[chat_id] = {}
        await query.edit_message_text("🗑 Корзина очищена.", reply_markup=back_to_main_kb())

    # ─── CHECKOUT ───
    elif data == "checkout":
        if not get_cart(chat_id):
            await query.edit_message_text("Корзина пуста!", reply_markup=back_to_main_kb())
            return
        text = "📝 **Оформление заказа**\n\nВыберите способ оплаты и доставки:"
        await query.edit_message_text(text, reply_markup=checkout_kb(), parse_mode="Markdown")

    elif data.startswith("pay:"):
        method = data.split(":")[1]
        method_names = {
            "card": "💳 Картой онлайн",
            "cod": "📦 СДЭК / Почта (наложенный платёж)",
            "courier": "🚚 Курьер по городу",
        }
        # создаём заказ
        order_id = f"ORD-{len(orders) + 1001}"
        orders[order_id] = {
            "chat_id": chat_id,
            "items": dict(get_cart(chat_id)),
            "total": cart_total(chat_id),
            "method": method_names[method],
            "status": "Ожидает подтверждения",
        }
        context.user_data["current_order"] = order_id

        lines = [f"📋 **Заказ {order_id}**\n"]
        for pid, qty in get_cart(chat_id).items():
            p = PRODUCTS[pid]
            lines.append(f"• {p['name']} x{qty} = {fmt_price(p['price'] * qty)}")
        lines.append(f"\n💰 Итого: {fmt_price(cart_total(chat_id))}")
        lines.append(f"📦 Доставка/оплата: {method_names[method]}")
        lines.append(f"\n✏️ Для оформления напишите ваш **адрес доставки** в чат")
        await query.edit_message_text("\n".join(lines), reply_markup=confirm_kb(order_id), parse_mode="Markdown")

    elif data.startswith("confirm_order:"):
        order_id = data.split(":")[1]
        if order_id in orders:
            orders[order_id]["status"] = "Принят, в обработке"
            # очищаем корзину
            carts[chat_id] = {}
            text = (
                f"✅ **Заказ {order_id} подтверждён!**\n\n"
                f"Статус: Принят, в обработке\n"
                f"Мы свяжемся с вами в ближайшее время для уточнения деталей.\n\n"
                f"Спасибо за покупку! 🎉"
            )
            await query.edit_message_text(text, reply_markup=back_to_main_kb(), parse_mode="Markdown")

    # ─── ORDERS ───
    elif data == "orders":
        user_orders = {oid: o for oid, o in orders.items() if o["chat_id"] == chat_id}
        if not user_orders:
            text = "📦 У вас пока нет заказов.\n\nСделайте первую покупку!"
            await query.edit_message_text(text, reply_markup=back_to_main_kb())
        else:
            lines = ["📦 **Мои заказы:**\n"]
            for oid, o in user_orders.items():
                lines.append(f"**{oid}**")
                lines.append(f"  Статус: {o['status']}")
                lines.append(f"  Сумма: {fmt_price(o['total'])}")
                lines.append(f"  Доставка: {o['method']}")
                lines.append("")
            await query.edit_message_text("\n".join(lines), reply_markup=back_to_main_kb(), parse_mode="Markdown")

    # ─── ABOUT ───
    elif data == "about":
        text = (
            "🏪 **О магазине TestShopTG**\n\n"
            "Мы — онлайн-магазин с быстрой доставкой по всей стране.\n\n"
            "✅ Быстрая доставка 1-3 дня\n"
            "✅ Гарантия на все товары\n"
            "✅ Возврат в течение 14 дней\n"
            "✅ Безопасная оплата\n\n"
            "Работаем для вас 24/7!"
        )
        await query.edit_message_text(text, reply_markup=back_to_main_kb(), parse_mode="Markdown")

    # ─── SUPPORT ───
    elif data == "support":
        text = (
            "📞 **Поддержка**\n\n"
            "Если у вас есть вопросы по заказу или товару — напишите нам:\n\n"
            "📧 Email: support@testshoptg.ru\n"
            "💬 Telegram: @testshoptg_support\n\n"
            "Время ответа: обычно в течение 30 минут."
        )
        await query.edit_message_text(text, reply_markup=back_to_main_kb(), parse_mode="Markdown")

    # ─── SEARCH ───
    elif data == "search":
        text = (
            "🔎 **Поиск товара**\n\n"
            "Напишите название или категорию товара в чат, и я найду его для вас!\n\n"
            "Например: `наушники`, `футболка`, `часы`"
        )
        context.user_data["mode"] = "search"
        await query.edit_message_text(text, reply_markup=back_to_main_kb(), parse_mode="Markdown")


async def cart_refresh(update: Update, context: ContextTypes.DEFAULT_TYPE, chat_id: int):
    query = update.callback_query
    cart = get_cart(chat_id)
    if not cart:
        await query.edit_message_text("🛒 Корзина пуста.", reply_markup=back_to_main_kb())
        return
    lines = ["🛒 **Ваша корзина:**\n"]
    for pid, qty in cart.items():
        p = PRODUCTS[pid]
        lines.append(f"• {p['name']} x{qty} = {fmt_price(p['price'] * qty)}")
    lines.append(f"\n💰 **Итого: {fmt_price(cart_total(chat_id))}**")
    await query.edit_message_text("\n".join(lines), reply_markup=cart_kb(chat_id), parse_mode="Markdown")


async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    text = update.message.text.lower().strip()

    if context.user_data.get("mode") == "search":
        context.user_data["mode"] = None
        results = []
        for pid, p in PRODUCTS.items():
            if text in p["name"].lower() or text in p["desc"].lower() or text in p["category"].lower():
                results.append(pid)
        if results:
            buttons = []
            for pid in results:
                p = PRODUCTS[pid]
                buttons.append([InlineKeyboardButton(f"{p['name']} — {fmt_price(p['price'])}", callback_data=f"prod:{pid}")])
            buttons.append([InlineKeyboardButton("⬅️ В меню", callback_data="main")])
            await update.message.reply_text(
                f"🔎 Найдено {len(results)} товар(ов):",
                reply_markup=InlineKeyboardMarkup(buttons),
            )
        else:
            await update.message.reply_text(
                "Ничего не найдено. Попробуйте другой запрос.",
                reply_markup=back_to_main_kb(),
            )
    else:
        await update.message.reply_text(
            "Используйте меню ниже 👇",
            reply_markup=main_menu_kb(chat_id),
        )


def main():
    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(button_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

    print("🚀 Бот запущен! Нажмите Ctrl+C для остановки.")
    app.run_polling(allow_updates=True)


if __name__ == "__main__":
    main()
