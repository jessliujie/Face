// api/create-link.js
import crypto from 'crypto';

export default async function handler(req, res) {
  // 1. 鉴权（防止恶意刷链接）
  const ADMIN_KEY = "Face2026";
  const { key } = req.query;
  
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden: 密钥错误' });
  }

  // 2. 检查环境变量
  if (!process.env.UPSTASH_URL || !process.env.UPSTASH_TOKEN) {
    return res.status(500).json({ error: '服务器配置缺失' });
  }

  // 3. 生成16位随机Token
  const token = crypto.randomBytes(8).toString('hex').toUpperCase();
  const redisKey = `token:${token}`;

  try {
    // 4. 存入Upstash Redis（设置值和7天过期）
    const setRes = await fetch(`${process.env.UPSTASH_URL}/set/${encodeURIComponent(redisKey)}/unused`, {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` }
    });
    if (!setRes.ok) throw new Error('Redis存储失败');

    const expireRes = await fetch(`${process.env.UPSTASH_URL}/expire/${encodeURIComponent(redisKey)}/604800`, {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` }
    });
    if (!expireRes.ok) throw new Error('Redis过期设置失败');

    // 5. 返回生成的访问链接
    const link = `https://face-jessii.vercel.app/?t=${token}`;
    res.status(200).json({ 
      success: true, 
      link, 
      token,
      expiresIn: '7天'
    });

  } catch (error) {
    console.error('生成链接失败:', error);
    res.status(500).json({ error: '生成链接失败，请重试' });
  }
}
