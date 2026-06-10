// api/analyze-face.js
export default async function handler(req, res) {
  // 允许 CORS（以防万一）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed — 请用 POST' });
  }

  try {
    const body = req.body || {};
    console.log('收到请求 body.keys:', Object.keys(body));

    // 假装分析成功，返回一个假数据验证管道
    return res.status(200).json({
      features: {
        shape: '测试圆脸',
        age: 24,
        gender: '女',
        beauty: 88,
        type: 'round'
      },
      advice: '✅ 后端管道已打通！如果你看到这条说明 /api/analyze-face 正常工作了，接下来再把真正的百度AI逻辑放回来。'
    });
  } catch (err) {
    console.error('analyze-face crash:', err);
    return res.status(500).json({ error: 'crash', detail: String(err) });
  }
}
