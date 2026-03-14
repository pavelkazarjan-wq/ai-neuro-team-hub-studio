// YouTube OAuth - Handle callback and store tokens
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'https://aineuro-team-hub.netlify.app/.netlify/functions/youtube-callback';

exports.handler = async (event) => {
  const code = event.queryStringParameters?.code;

  if (!code) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<h1>Ошибка: нет кода авторизации</h1>'
    };
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: `<h1>Ошибка OAuth</h1>
          <p><strong>Error:</strong> ${tokens.error}</p>
          <p><strong>Description:</strong> ${tokens.error_description || 'No description'}</p>
          <p><strong>Client ID:</strong> ${GOOGLE_CLIENT_ID ? GOOGLE_CLIENT_ID.substring(0, 20) + '...' : 'NOT SET'}</p>
          <p><strong>Client Secret:</strong> ${GOOGLE_CLIENT_SECRET ? 'SET (' + GOOGLE_CLIENT_SECRET.length + ' chars)' : 'NOT SET'}</p>
          <p><strong>Redirect URI:</strong> ${REDIRECT_URI}</p>`
      };
    }

    // Show tokens to user so they can add to Netlify env vars
    const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>YouTube подключён!</title>
  <style>
    body { font-family: sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
    h1 { color: #28a745; }
    .token-box { background: #f5f5f5; padding: 1rem; border-radius: 8px; margin: 1rem 0; word-break: break-all; }
    .label { font-weight: bold; color: #333; }
    .warning { background: #fff3cd; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
    button { background: #213555; color: white; padding: 0.75rem 1.5rem; border: none; border-radius: 8px; cursor: pointer; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>YouTube успешно подключён!</h1>

  <div class="warning">
    <strong>Важно!</strong> Скопируй REFRESH_TOKEN ниже и добавь его в Netlify как переменную окружения YOUTUBE_REFRESH_TOKEN
  </div>

  <p class="label">YOUTUBE_REFRESH_TOKEN:</p>
  <div class="token-box">${tokens.refresh_token}</div>

  <p>После добавления токена в Netlify, нажми кнопку ниже:</p>
  <button onclick="window.location.href='/?youtube=connected'">Готово, перейти в приложение</button>
</body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': `yt_connected=true; Path=/; Max-Age=31536000; SameSite=Lax`
      },
      body: html
    };

  } catch (error) {
    console.error('OAuth error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: `<h1>Ошибка</h1><p>${error.message}</p>`
    };
  }
};
