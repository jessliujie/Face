const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ valid: false, msg: '请求方法不允许' });
  }

  const { token } = req.query;
  if (!token) {
    return res.status(200).json({ valid: false, msg: '缺少访问凭证' });
  }

  try {
    const status = await redis.get(`vibe_link:${token}`);
    
    if (status === 'unused') {
      return res.status(200).json({ valid: true });
    } else {
      const msg = status === 'used' 
        ? '该链接已使用，请重新购买' 
        : '链接已过期或无效';
      return res.status(200).json({ valid: false, msg });
    }
  } catch (error) {
    console.error('Redis 验证异常:', error);
    return res.status(200).json({ valid: false, msg: '系统繁忙，请刷新重试' });
  }
};