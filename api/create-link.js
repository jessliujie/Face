// api/create-link.js
export default async function handler(req, res) {
  // 1. 鉴权：只有你知道 ADMIN_KEY，防止别人乱刷链接
  const ADMIN_KEY = process.env.ADMIN_KEY;
  const { key } = req.query;

  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 2. 连接 Upstash Redis
  const REDIS = u => fetch(`${process.env.UPSTASH_URL}${u}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` }
  });

  // 3. 生成随机 Token（16位大写字母数字）
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();

  // 4. 存入 Redis，状态为 unused，并设置 7 天过期（604800秒）
  try {
    // 设置值
    await REDIS(`/set/${encodeURIComponent(`token:${token}`)}/unused`);
    // 设置过期时间
    await REDIS(`/expire/${encodeURIComponent(`token:${token}`)}/604800`);

    // 5. 返回给小红书自动发货的链接
    const link = `${req.headers.origin || process.env.VERCEL_URL}/?t=${token}`;
    
    // 如果是通过浏览器访问，直接显示；如果是API调用，返回JSON
    if (req.headers.accept?.includes('text/html')) {
      res.send(`<h1>Link Generated</h1><p><a href="${link}" target="_blank">${link}</a></p>`);
    } else {
      res.status(200).json({ link });
    }

  } catch (error) {
    console.error('Create Link Error:', error);
    res.status(500).json({ error: '生成链接失败' });
  }
}
