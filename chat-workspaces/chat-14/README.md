
# 🏪 TestShopTG — Telegram-бот магазин

Клон бота @zipppppppppaaaabot — интернет-магазин прямо в Telegram.

## 🚀 Запуск на ПК

### 1. Установите Python 3.10+
Скачать: [python.org](https://python.org)

### 2. Создайте бота в @BotFather
1. Откройте [@BotFather](https://t.me/BotFather) в Telegram
2. Команда `/newbot` → выберите имя → выберите username
3. Скопируйте токен

### 3. Настройте проект
```bash
pip install -r requirements.txt
```

Скопируйте `.env.example` в `.env` и вставьте токен:
```
BOT_TOKEN=123456789:ABCdefGhi...
```

### 4. Запустите бота
```bash
python main.py
```

Бот работает! Откройте его в Telegram и нажмите `/start`.

## 📋 Функции

- 🛍 Каталог товаров по категориям (4 категории, 12 товаров)
- 🔎 Поиск по названию
- 🛒 Корзина с +/- и удалением товаров
- 📦 Оформление заказа (3 способа оплаты/доставки)
- 📦 История заказов со статусами
- ℹ️ Страница о магазине
- 📞 Поддержка

## 🛠 Технологии

- Python 3.10+
- python-telegram-bot 21.6
- python-dotenv
