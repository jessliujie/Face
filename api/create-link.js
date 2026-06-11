const { v4: uuidv4 } = require('uuid');
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const key = req.query.key || (req.body && req.body.key);
  if (!key || key !== process.env.WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Unauthorized: 密钥校验失败' });
  }

  try {
    const token = uuidv4();
    const redisKey = `vibe_link:${token}`;
    
    await redis.set(redisKey, 'unused', { ex: 604800 });

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    
    const baseUrl = host.includes('localhost') 
      ? 'http://localhost:3000' 
      : `${protocol}://${host}`;
      
    const finalUrl = `${baseUrl}/?token=${token}`;

    res.status(200).json({ 
      success: true, 
      url: finalUrl,
      msg: '链接生成成功，有效期7天，使用后立即失效。'
    });
  } catch (error) {
    console.error('生成链接失败:', error);
    res.status(500).json({ error: 'Redis 服务异常，请稍后重试' });
  }
};