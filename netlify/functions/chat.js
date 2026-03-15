const OpenAI = require('openai');

const WORDPRESS_URL = 'https://ninarkotikam.com';

// Supabase config
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ngxbfuimddefjeufwcwf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

// Supabase REST API helper
async function supabaseQuery(table, method = 'GET', body = null, query = '') {
  if (!SUPABASE_KEY) return null;

  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const options = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=minimal' : undefined
    }
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(url, options);
    if (method === 'POST') return { success: true };
    return await res.json();
  } catch (e) {
    console.error('Supabase error:', e.message);
    return null;
  }
}

// Save message to Supabase
async function saveMessage(sessionId, agent, role, content) {
  return supabaseQuery('chat_messages', 'POST', {
    session_id: sessionId,
    agent,
    role,
    content: content.substring(0, 10000) // Limit content size
  });
}

// Get recent messages for context
async function getRecentMessages(sessionId, limit = 20) {
  const data = await supabaseQuery(
    'chat_messages',
    'GET',
    null,
    `?session_id=eq.${sessionId}&order=created_at.desc&limit=${limit}`
  );
  return data ? data.reverse() : [];
}

// Save a learned fact to memory
async function saveFact(category, fact, sourceMessage) {
  return supabaseQuery('user_memory', 'POST', {
    category,
    fact,
    source_message: sourceMessage?.substring(0, 500)
  });
}

// Get all remembered facts
async function getMemory() {
  const data = await supabaseQuery('user_memory', 'GET', null, '?order=created_at.desc&limit=50');
  return data || [];
}

// Extract facts from assistant response (simple pattern matching)
function extractFacts(response) {
  const facts = [];
  // Look for statements about user
  const patterns = [
    /(?:ты|вы|павел|пользователь)\s+(?:является|работает|имеет|использует|предпочитает|хочет)\s+([^.]+)/gi,
    /(?:у тебя|у вас|у павла)\s+([^.]+\d+[^.]*)/gi, // Numbers/stats
    /(?:твой|ваш|его)\s+(?:канал|сайт|бизнес|продукт)\s+([^.]+)/gi
  ];

  for (const pattern of patterns) {
    const matches = response.matchAll(pattern);
    for (const match of matches) {
      if (match[1]?.length > 10 && match[1]?.length < 200) {
        facts.push(match[1].trim());
      }
    }
  }
  return facts;
}

// Format memory for prompt
function formatMemoryContext(memories) {
  if (!memories?.length) return '';

  const grouped = {};
  for (const m of memories) {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m.fact);
  }

  let context = '\n\nПАМЯТЬ О ПОЛЬЗОВАТЕЛЕ:\n';
  for (const [cat, facts] of Object.entries(grouped)) {
    context += `${cat}: ${facts.slice(0, 3).join('; ')}\n`;
  }
  return context;
}

// Extract URLs from message
function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;
  return text.match(urlRegex) || [];
}

// Fetch URL content with 4 second timeout
async function fetchUrlContent(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    // YouTube video
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoId = extractYouTubeId(url);
      if (videoId) {
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const res = await fetch(oembedUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          return `[YouTube видео]\nЗаголовок: ${data.title}\nАвтор: ${data.author_name}\nСсылка: ${url}`;
        }
      }
    }

    // Regular webpage
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIBot/1.0)' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const html = await res.text();

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : '';

      // Extract meta description
      const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      const desc = descMatch ? descMatch[1] : '';

      // Extract text (simplified) - limit for speed
      let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 1500);

      return `[Страница: ${url}]\n${title ? 'Заголовок: ' + title + '\n' : ''}${desc ? 'Описание: ' + desc + '\n' : ''}Текст: ${text}`;
    }
  } catch (e) {
    clearTimeout(timeout);
    console.log('URL fetch error:', e.message);
  }
  return null;
}

function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}
const WRITE_ACTIONS = ['update_media_alt', 'update_page', 'update_seo'];
const CONFIRMATION_CODE = 'ПОДТВЕРЖДАЮ';

// Perplexity API for search + reasoning (with history)
async function askPerplexity(query, systemPrompt, history = []) {
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  if (!perplexityKey) {
    return null; // Fallback to GPT
  }

  try {
    // Build messages with history
    const messages = [{ role: 'system', content: systemPrompt }];
    if (history?.length) {
      history.slice(-6).forEach(m => messages.push({ role: m.role, content: m.content }));
    }
    messages.push({ role: 'user', content: query });

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${perplexityKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages,
        temperature: 0.2,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      console.error('Perplexity error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Perplexity error:', error);
    return null;
  }
}

// WordPress API
async function callWordPressAPI(action, params = {}) {
  const wpUser = process.env.WP_USER || 'AI-Assistant';
  const wpPassword = process.env.WP_APP_PASSWORD;
  if (!wpPassword) return { error: 'WordPress not configured' };

  const authHeader = 'Basic ' + Buffer.from(`${wpUser}:${wpPassword}`).toString('base64');

  async function wpRequest(endpoint, method = 'GET', body = null) {
    const options = {
      method,
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }
    };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(`${WORDPRESS_URL}/wp-json/wp/v2/${endpoint}`, options);
    if (!response.ok) throw new Error(`WordPress error: ${response.status}`);
    return response.json();
  }

  try {
    switch (action) {
      case 'get_posts':
        const posts = await wpRequest('posts?per_page=10');
        return posts.map(p => ({ id: p.id, title: p.title.rendered, link: p.link }));
      case 'get_pages':
        const pages = await wpRequest('pages?per_page=20');
        return pages.map(p => ({ id: p.id, title: p.title.rendered, link: p.link }));
      case 'get_media_without_alt':
        const media = await wpRequest('media?per_page=50&media_type=image');
        return media.filter(m => !m.alt_text).map(m => ({ id: m.id, title: m.title.rendered }));
      case 'update_media_alt':
        await wpRequest(`media/${params.id}`, 'POST', { alt_text: params.alt_text });
        return { success: true };
      default:
        return { error: 'Unknown action' };
    }
  } catch (error) {
    return { error: error.message };
  }
}

// WordPress tools for GPT
const wpTools = [
  { type: 'function', function: { name: 'wp_get_pages', description: 'Список страниц сайта', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'wp_get_posts', description: 'Список постов', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'wp_get_media_without_alt', description: 'Изображения без alt', parameters: { type: 'object', properties: {} } } }
];

async function executeWpTool(toolName, toolInput) {
  const actionMap = {
    'wp_get_pages': 'get_pages',
    'wp_get_posts': 'get_posts',
    'wp_get_media_without_alt': 'get_media_without_alt',
    'wp_update_media_alt': 'update_media_alt'
  };
  const action = actionMap[toolName];
  if (!action) return { error: 'Unknown tool' };

  if (WRITE_ACTIONS.includes(action) && toolInput.confirmation !== CONFIRMATION_CODE) {
    return { requires_confirmation: true, message: `Напиши "${CONFIRMATION_CODE}" для подтверждения` };
  }

  return await callWordPressAPI(action, toolInput);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { message, agent, systemPrompt, history, youtubeData, image, sessionId } = JSON.parse(event.body);
    if (!message && !image) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Message required' }) };

    // Get memory context from Supabase
    const memories = await getMemory();
    const memoryContext = formatMemoryContext(memories);

    // Save user message
    if (sessionId && message) {
      saveMessage(sessionId, agent, 'user', message);
    }

    // If image is attached, use GPT-4o Vision to analyze it
    if (image) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const visionPrompt = systemPrompt + `

КРИТИЧЕСКИ ВАЖНО — АНАЛИЗ СКРИНШОТА:

1. ИЗВЛЕКИ ВСЕ ЦИФРЫ:
   - Просмотры, охват, вовлечённость
   - Подписчики vs неподписчики
   - Динамика (рост/падение в %)
   - Все метрики на экране

2. СРАВНИ С БЕНЧМАРКАМИ:
   - Reels reach: 20-40% от подписчиков — норма
   - 3-сек retention > 30% — хороший хук
   - ER психологов: 3-5%

3. ДИАГНОЗ С ЦИФРАМИ:
   Не "низкий охват", а "охват 8% при норме 20%"

4. ГОТОВЫЕ РЕШЕНИЯ:
   - План на неделю (день 1, день 2...)
   - Готовые тексты: заголовки, CTA, описания
   - Готовые сценарии хуков

ВАЖНО: Отмечай что ХОРОШО работает! Хвали сильные стороны перед критикой.
НЕ ДАВАЙ поверхностных советов. ГЕНЕРИРУЙ готовый контент.
Формат: простой текст без markdown.`;

      const messages = [
        { role: 'system', content: visionPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: message || 'Проанализируй эту статистику и дай рекомендации' },
            { type: 'image_url', image_url: { url: image, detail: 'high' } }
          ]
        }
      ];

      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages
      });

      return { statusCode: 200, headers, body: JSON.stringify({ response: response.choices[0].message.content, agent }) };
    }

    // Auto-fetch URL content if URLs found in message
    let enrichedMessage = message;
    const urls = extractUrls(message);
    if (urls.length > 0) {
      const urlContents = [];
      for (const url of urls.slice(0, 2)) { // Max 2 URLs
        const content = await fetchUrlContent(url);
        if (content) urlContents.push(content);
      }
      if (urlContents.length > 0) {
        enrichedMessage = message + '\n\n---\nАВТОМАТИЧЕСКИ ЗАГРУЖЕННЫЙ КОНТЕНТ:\n' + urlContents.join('\n\n');
      }
    }

    // Add YouTube analytics to context if available
    let ytContext = '';
    if (youtubeData && agent === 'youtube') {
      ytContext = `

РЕАЛЬНЫЕ ДАННЫЕ YOUTUBE КАНАЛА (за последние 28 дней):
Канал: ${youtubeData.channel?.title}
Подписчиков: ${youtubeData.channel?.subscribers?.toLocaleString()}
Всего просмотров: ${youtubeData.channel?.totalViews?.toLocaleString()}
Количество видео: ${youtubeData.channel?.videoCount}

Используй эти данные для анализа. Это реальная аналитика канала пользователя.
`;
    }

    // BRAINSTORM MODE - all agents discuss together
    if (agent === 'brainstorm') {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const brainstormPrompt = `Ты — координатор мозгоштурма команды экспертов Павла Казарьяна.

КОНТЕКСТ: Павел Казарьян — клинический психолог, НЛП-тренер, директор реабилитационных центров. Аудитория: 220K Facebook, 160K Instagram. Продукты: онлайн-программы, консультации, клуб подписки.

ТВОЯ ЗАДАЧА: Провести мозгоштурм по запросу пользователя, объединив экспертизу всех членов команды:

🎯 СТРАТЕГ (маркетинг и бизнес):
- Анализ рынка и позиционирования
- Воронки продаж и конверсии
- Коммерческая жизнеспособность

📱 SMM-ЭКСПЕРТ (соцсети):
- YouTube, Instagram, TikTok, Telegram стратегии
- Контент-форматы и тренды
- Охваты и вовлечение

🔍 SEO-СПЕЦИАЛИСТ:
- Поисковая оптимизация
- Ключевые слова и трафик
- Техническое SEO

📝 КОНТЕНТ-СТРАТЕГ:
- Тексты и копирайтинг
- Структура контента
- Tone of voice

ФОРМАТ ОТВЕТА:

1. КРАТКИЙ АНАЛИЗ СИТУАЦИИ
   Что мы имеем, ключевые факты

2. ИДЕИ ОТ КАЖДОГО ЭКСПЕРТА
   По 1-2 конкретных предложения от каждого направления

3. ОБЩИЙ ПЛАН ДЕЙСТВИЙ
   5-7 конкретных шагов с приоритетами

4. БЫСТРЫЕ ПОБЕДЫ
   2-3 действия, которые можно сделать сегодня

ПРАВИЛА:
- Конкретика, без воды
- Приоритизация по влиянию на бизнес
- Только русский язык
- Простой текст, без markdown`;

      const messages = [{ role: 'system', content: brainstormPrompt }];
      if (history?.length) {
        history.slice(-6).forEach(m => messages.push({ role: m.role, content: m.content }));
      }
      messages.push({ role: 'user', content: enrichedMessage });

      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages
      });

      return { statusCode: 200, headers, body: JSON.stringify({ response: response.choices[0].message.content, agent: 'brainstorm' }) };
    }

    // WordPress agent uses GPT with tools
    if (agent === 'wordpress') {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const messages = [{ role: 'system', content: systemPrompt }];
      if (history?.length) history.forEach(m => messages.push({ role: m.role, content: m.content }));
      messages.push({ role: 'user', content: enrichedMessage });

      let response = await client.chat.completions.create({
        model: 'gpt-4-turbo',
        max_tokens: 4096,
        messages,
        tools: wpTools,
        tool_choice: 'auto'
      });

      let iterations = 0;
      while (response.choices[0].finish_reason === 'tool_calls' && iterations < 5) {
        iterations++;
        const assistantMsg = response.choices[0].message;
        messages.push(assistantMsg);

        for (const tc of assistantMsg.tool_calls) {
          const result = await executeWpTool(tc.function.name, JSON.parse(tc.function.arguments));
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }

        response = await client.chat.completions.create({
          model: 'gpt-4-turbo',
          max_tokens: 4096,
          messages,
          tools: wpTools
        });
      }

      return { statusCode: 200, headers, body: JSON.stringify({ response: response.choices[0].message.content, agent }) };
    }

    // All other agents use Perplexity (search + reasoning)
    const enhancedPrompt = systemPrompt + ytContext + memoryContext + `

ПРАВИЛА ОБЩЕНИЯ:
- На приветствия отвечай дружелюбно и коротко, без поиска в интернете
- Веди диалог естественно, как опытный консультант
- Поиск в интернете используй ТОЛЬКО когда нужны реальные данные: статистика, аналитика, конкуренты
- Формат: простой текст без markdown (###, **, *)
- Ссылки: [текст](url)
- Только русский язык
- Будь жёстким но полезным консультантом
`;

    const perplexityResponse = await askPerplexity(enrichedMessage, enhancedPrompt, history);

    if (perplexityResponse) {
      // Save to memory
      if (sessionId) {
        saveMessage(sessionId, agent, 'assistant', perplexityResponse);
        const facts = extractFacts(perplexityResponse);
        for (const fact of facts.slice(0, 2)) {
          saveFact(agent, fact, message);
        }
      }
      return { statusCode: 200, headers, body: JSON.stringify({ response: perplexityResponse, agent }) };
    }

    // Fallback to GPT if Perplexity fails (use faster model with history)
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const messages = [{ role: 'system', content: enhancedPrompt }];
    if (history?.length) {
      history.slice(-6).forEach(m => messages.push({ role: m.role, content: m.content }));
    }
    messages.push({ role: 'user', content: enrichedMessage });

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 2048,
      messages
    });

    const gptResponse = response.choices[0].message.content;

    // Save to memory
    if (sessionId) {
      saveMessage(sessionId, agent, 'assistant', gptResponse);
      const facts = extractFacts(gptResponse);
      for (const fact of facts.slice(0, 2)) {
        saveFact(agent, fact, message);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ response: gptResponse, agent }) };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
