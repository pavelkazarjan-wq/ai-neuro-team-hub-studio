# AINeuroTeamHubStudio Web App

Веб-приложение для доступа к AI Team с телефона.

## Деплой на Netlify

### Шаг 1: Создать репозиторий на GitHub

```bash
cd webapp
git init
git add .
git commit -m "Initial commit: AINeuroTeamHubStudio webapp"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ai-neuro-team-hub-studio.git
git push -u origin main
```

### Шаг 2: Подключить к Netlify

1. Зайди на [netlify.com](https://netlify.com)
2. Нажми "Add new site" → "Import an existing project"
3. Выбери GitHub и найди репозиторий `ai-neuro-team-hub-studio`
4. Настройки сборки:
   - Build command: (оставить пустым)
   - Publish directory: `public`

### Шаг 3: Добавить API ключ

1. В Netlify перейди в Site settings → Environment variables
2. Добавь переменную:
   - Key: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-api03-...` (твой ключ)

### Шаг 4: Готово!

После деплоя получишь URL типа: `https://ai-neuro-team-hub-studio.netlify.app`

## Локальный запуск

```bash
npm install
npm run dev
```

## Структура

```
webapp/
├── public/
│   ├── index.html      # Фронтенд
│   ├── manifest.json   # PWA манифест
│   └── sw.js           # Service Worker
├── netlify/
│   └── functions/
│       └── chat.js     # Serverless функция
├── netlify.toml        # Конфиг Netlify
└── package.json
```

## Функции

- **Агенты:** General, Content Strategist, Presentations, Data Analyst
- **PWA:** Можно добавить на главный экран телефона
- **История:** Сохраняет контекст диалога

