// Fetch and parse URL content for AI analysis
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { url } = JSON.parse(event.body);
    if (!url) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL required' }) };
    }

    let result = { url, type: 'webpage', content: '' };

    // YouTube video
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoId = extractYouTubeId(url);
      if (videoId) {
        result.type = 'youtube';
        result.videoId = videoId;

        // Get video info via oembed
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const oembedRes = await fetch(oembedUrl);
        if (oembedRes.ok) {
          const oembed = await oembedRes.json();
          result.title = oembed.title;
          result.author = oembed.author_name;
          result.thumbnail = oembed.thumbnail_url;
          result.content = `YouTube видео: "${oembed.title}" от ${oembed.author_name}`;
        }
      }
    }
    // Instagram post
    else if (url.includes('instagram.com')) {
      result.type = 'instagram';
      result.content = `Instagram пост: ${url}. Для анализа скопируйте текст поста и вставьте сюда.`;
    }
    // Facebook post
    else if (url.includes('facebook.com')) {
      result.type = 'facebook';
      result.content = `Facebook пост: ${url}. Для анализа скопируйте текст поста и вставьте сюда.`;
    }
    // TikTok video
    else if (url.includes('tiktok.com')) {
      result.type = 'tiktok';
      result.content = `TikTok видео: ${url}. Опишите содержание видео для анализа.`;
    }
    // Regular webpage - fetch and extract text
    else {
      try {
        const pageRes = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIBot/1.0)' }
        });

        if (pageRes.ok) {
          const html = await pageRes.text();

          // Extract title
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          result.title = titleMatch ? titleMatch[1].trim() : '';

          // Extract meta description
          const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
          result.description = descMatch ? descMatch[1] : '';

          // Extract text content (simplified)
          let text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          // Limit text
          result.content = text.substring(0, 3000);

          if (result.title) {
            result.content = `Заголовок: ${result.title}\n\n${result.description ? 'Описание: ' + result.description + '\n\n' : ''}Контент:\n${result.content}`;
          }
        }
      } catch (fetchError) {
        result.content = `Не удалось загрузить страницу: ${url}. Ошибка: ${fetchError.message}`;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Fetch URL error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
