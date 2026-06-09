// api/create-link.js
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // 1. 鉴权：只有知道 ADMIN_KEY 的人才能生成链接
  const ADMIN_KEY = process.env.ADMIN_KEY;
  const { key } = req.query;

  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: '非法访问' });
  }

  // 2. 生成随机 Token (16位)
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
  
  // 3. 存入 Vercel KV 数据库，有效期 7 天 (604800 秒)
  // Key 格式: token:ABC123, Value: unused
  await kv.set(`token:${token}`, 'unused', { ex: 604800 });

  // 4. 返回给用户的链接
  const link = `${req.headers.origin || process.env.VERCEL_URL}/?t=${token}`;
  
  res.status(200).json({ link });
}
