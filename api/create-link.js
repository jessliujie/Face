// api/analyze.js
export default async function handler(req, res) {
  const { imageBase64, token } = req.body;
  if (!token) return res.status(400).json({ error: '缺少访问凭证' });

  const REDIS = u => fetch(`${process.env.UPSTASH_URL}${u}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` }
  });

  // 1. Token 校验
  const tokenRes = await (await REDIS(`/get/${encodeURIComponent(`token:${token}`)}`)).json();
  if (!tokenRes.result || tokenRes.result === 'used') {
    return res.status(410).json({ error: '链接已失效或已使用' });
  }

  // 2. 限流
  const today = new Date().toISOString().split('T')[0];
  const limitKey = `limit:daily:${today}`;
  const countRes = await (await REDIS(`/get/${encodeURIComponent(limitKey)}`)).json();
  if (parseInt(countRes.result || '0') >= 200) {
    return res.status(429).json({ error: '今日服务已达上限' });
  }
  await REDIS(`/incr/${encodeURIComponent(limitKey)}`);
  await REDIS(`/expire/${encodeURIComponent(limitKey)}/86400`);

  // 3. 标记 Token 已用
  await REDIS(`/set/${encodeURIComponent(`token:${token}`)}/used`);

  // 4. 调用百度 AI
  try {
    const BAIDU_API_KEY = process.env.BAIDU_API_KEY;
    const BAIDU_SECRET_KEY = process.env.BAIDU_SECRET_KEY;
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

    // 获取百度 Token
    const baiDuTokenRes = await fetch(`https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${BAIDU_API_KEY}&client_secret=${BAIDU_SECRET_KEY}`);
    const baiDuToken = await baiDuTokenRes.json();

    // 人脸检测
    const detectRes = await fetch(`https://aip.baidubce.com/rest/2.0/face/v3/detect?access_token=${baiDuToken.access_token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, image_type: 'BASE64', face_field: 'age,gender,beauty,faceshape' })
    });
    const faceData = await detectRes.json();
    if (faceData.error_code !== 0) throw new Error(faceData.error_msg);

    const face = faceData.result.face_list[0];
    const features = {
      shape: face.faceshape.type,
      age: face.age,
      beauty: Math.round(face.beauty.female_score || face.beauty.male_score),
      gender: face.gender.type
    };

    // 调用 DeepSeek
    const deepseekRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是顶级造型师，语言亲切如闺蜜。' },
          { role: 'user', content: `根据数据给建议：${JSON.stringify(features)}` }
        ]
      })
    });
    const advice = (await deepseekRes.json()).choices[0].message.content;

    res.json({ success: true, features, advice });

  } catch (error) {
    await REDIS(`/set/${encodeURIComponent(`token:${token}`)}/unused`); // 失败时回滚
    res.status(500).json({ error: error.message || '分析失败' });
  }
}
