// YouTube Analytics API
const GOOGLE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;

// Simple token storage (in production use database like Supabase/Firebase)
let accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
let refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

async function refreshAccessToken() {
  if (!refreshToken) return null;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const data = await response.json();
  if (data.access_token) {
    accessToken = data.access_token;
    return accessToken;
  }
  return null;
}

async function fetchYouTubeAPI(endpoint, token) {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.json();
}

async function fetchAnalyticsAPI(endpoint, token) {
  const response = await fetch(`https://youtubeanalytics.googleapis.com/v2/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.json();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Get or refresh token
    let token = accessToken;
    if (!token) {
      token = await refreshAccessToken();
    }

    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: 'YouTube not connected',
          authUrl: '/.netlify/functions/youtube-auth'
        })
      };
    }

    const { action } = JSON.parse(event.body || '{}');

    // Get channel info
    const channelData = await fetchYouTubeAPI('channels?part=snippet,statistics&mine=true', token);

    if (channelData.error) {
      // Token expired, try refresh
      token = await refreshAccessToken();
      if (!token) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Session expired', authUrl: '/.netlify/functions/youtube-auth' })
        };
      }
    }

    const channel = channelData.items?.[0];
    if (!channel) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Channel not found' }) };
    }

    const channelId = channel.id;

    // Get date range (last 28 days)
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Fetch analytics
    const analyticsQuery = `reports?` +
      `ids=channel==${channelId}` +
      `&startDate=${startDate}` +
      `&endDate=${endDate}` +
      `&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares` +
      `&dimensions=day` +
      `&sort=day`;

    const analytics = await fetchAnalyticsAPI(analyticsQuery, token);

    // Get top videos
    const topVideosQuery = `reports?` +
      `ids=channel==${channelId}` +
      `&startDate=${startDate}` +
      `&endDate=${endDate}` +
      `&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments` +
      `&dimensions=video` +
      `&sort=-views` +
      `&maxResults=10`;

    const topVideos = await fetchAnalyticsAPI(topVideosQuery, token);

    // Get traffic sources
    const trafficQuery = `reports?` +
      `ids=channel==${channelId}` +
      `&startDate=${startDate}` +
      `&endDate=${endDate}` +
      `&metrics=views` +
      `&dimensions=insightTrafficSourceType` +
      `&sort=-views`;

    const trafficSources = await fetchAnalyticsAPI(trafficQuery, token);

    // Get demographics
    const demoQuery = `reports?` +
      `ids=channel==${channelId}` +
      `&startDate=${startDate}` +
      `&endDate=${endDate}` +
      `&metrics=viewerPercentage` +
      `&dimensions=ageGroup,gender`;

    const demographics = await fetchAnalyticsAPI(demoQuery, token);

    // Compile response
    const result = {
      channel: {
        title: channel.snippet.title,
        subscribers: parseInt(channel.statistics.subscriberCount),
        totalViews: parseInt(channel.statistics.viewCount),
        videoCount: parseInt(channel.statistics.videoCount)
      },
      period: { startDate, endDate },
      dailyStats: analytics.rows || [],
      topVideos: topVideos.rows || [],
      trafficSources: trafficSources.rows || [],
      demographics: demographics.rows || [],
      columnHeaders: {
        daily: analytics.columnHeaders?.map(h => h.name) || [],
        videos: topVideos.columnHeaders?.map(h => h.name) || [],
        traffic: trafficSources.columnHeaders?.map(h => h.name) || [],
        demo: demographics.columnHeaders?.map(h => h.name) || []
      }
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('YouTube Analytics error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
