// WordPress REST API integration
const WORDPRESS_URL = 'https://ninarkotikam.com';

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
    const { action, params } = JSON.parse(event.body);

    // WordPress credentials from environment
    const wpUser = process.env.WP_USER || 'AI-Assistant';
    const wpPassword = process.env.WP_APP_PASSWORD;

    if (!wpPassword) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'WordPress credentials not configured' })
      };
    }

    const authHeader = 'Basic ' + Buffer.from(`${wpUser}:${wpPassword}`).toString('base64');

    // WordPress API request helper
    async function wpRequest(endpoint, method = 'GET', body = null) {
      const options = {
        method,
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      };
      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${WORDPRESS_URL}/wp-json/wp/v2/${endpoint}`, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`WordPress API error: ${response.status} - ${errorText}`);
      }

      return response.json();
    }

    let result;

    switch (action) {
      // === POSTS ===
      case 'get_posts':
        result = await wpRequest(`posts?per_page=${params?.per_page || 10}&page=${params?.page || 1}`);
        result = result.map(p => ({
          id: p.id,
          title: p.title.rendered,
          status: p.status,
          link: p.link,
          date: p.date,
          excerpt: p.excerpt.rendered.replace(/<[^>]*>/g, '').substring(0, 150)
        }));
        break;

      case 'get_post':
        result = await wpRequest(`posts/${params.id}`);
        result = {
          id: result.id,
          title: result.title.rendered,
          content: result.content.rendered,
          status: result.status,
          link: result.link,
          seo: result.rank_math_title ? {
            title: result.rank_math_title,
            description: result.rank_math_description,
            focus_keyword: result.rank_math_focus_keyword
          } : null
        };
        break;

      case 'update_post':
        result = await wpRequest(`posts/${params.id}`, 'POST', {
          title: params.title,
          content: params.content,
          status: params.status
        });
        break;

      case 'create_post':
        result = await wpRequest('posts', 'POST', {
          title: params.title,
          content: params.content,
          status: params.status || 'draft'
        });
        break;

      // === PAGES ===
      case 'get_pages':
        result = await wpRequest(`pages?per_page=${params?.per_page || 20}`);
        result = result.map(p => ({
          id: p.id,
          title: p.title.rendered,
          status: p.status,
          link: p.link
        }));
        break;

      case 'get_page':
        result = await wpRequest(`pages/${params.id}`);
        result = {
          id: result.id,
          title: result.title.rendered,
          content: result.content.rendered,
          status: result.status,
          link: result.link
        };
        break;

      case 'update_page':
        result = await wpRequest(`pages/${params.id}`, 'POST', {
          title: params.title,
          content: params.content
        });
        break;

      // === MEDIA ===
      case 'get_media':
        result = await wpRequest(`media?per_page=${params?.per_page || 20}&media_type=image`);
        result = result.map(m => ({
          id: m.id,
          title: m.title.rendered,
          alt_text: m.alt_text || '',
          caption: m.caption.rendered.replace(/<[^>]*>/g, ''),
          description: m.description.rendered.replace(/<[^>]*>/g, ''),
          source_url: m.source_url
        }));
        break;

      case 'get_media_without_alt':
        const allMedia = await wpRequest(`media?per_page=100&media_type=image`);
        result = allMedia
          .filter(m => !m.alt_text || m.alt_text.trim() === '')
          .map(m => ({
            id: m.id,
            title: m.title.rendered,
            source_url: m.source_url
          }));
        break;

      case 'update_media':
        result = await wpRequest(`media/${params.id}`, 'POST', {
          alt_text: params.alt_text,
          caption: params.caption,
          description: params.description
        });
        break;

      // === SEO (Rank Math) ===
      case 'update_seo':
        result = await wpRequest(`posts/${params.id}`, 'POST', {
          meta: {
            rank_math_title: params.seo_title,
            rank_math_description: params.seo_description,
            rank_math_focus_keyword: params.focus_keyword
          }
        });
        break;

      case 'update_page_seo':
        result = await wpRequest(`pages/${params.id}`, 'POST', {
          meta: {
            rank_math_title: params.seo_title,
            rank_math_description: params.seo_description,
            rank_math_focus_keyword: params.focus_keyword
          }
        });
        break;

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Unknown action: ${action}` })
        };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: result })
    };

  } catch (error) {
    console.error('WordPress API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
