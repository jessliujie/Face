// api/analyze.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { imageBase64, token } = req.body;

  // ==========================================================
  // 🛡️ 第一道防线：Token 校验（一链一用）
  // ==========================================================
  if (!token) return res.status(400).json({ error: '缺少访问凭证' });

  const REDIS = u => fetch(`${process.env.UPSTASH_URL}${u}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` }
  });

  // 检查 Token 是否存在及状态
  const tokenRes = await (await REDIS(`/get/${encodeURIComponent(`token:${token}`)}`)).json();
  const tokenVal = tokenRes.result;

  if (!tokenVal) return res.status(410).json({ error: '链接不存在或已过期' });
  if (tokenVal === 'used') return res.status(410).json({ error: '链接已使用，不可重复访问' });

  // ==========================================================
  // 🛡️ 第二道防线：每日限流（防刷量）
  // ==========================================================
  const today = new Date().toISOString().split('T')[0];
  const limitKey = `limit:daily:${today}`;
  const DAILY_MAX = 200; // 🔥 已改为 200 次

  try {
    const countRes = await (await REDIS(`/get/${encodeURIComponent(limitKey)}`)).json();
    const currentCount = parseInt(countRes.result || '0');

    if (currentCount >= DAILY_MAX) {
      return res.status(429).json({ error: `今日服务已达上限（${DAILY_MAX}次），请明天再来～` });
    }

    // 计数 +1
    await REDIS(`/incr/${encodeURIComponent(limitKey)}`);
    // 设置24小时过期
    await REDIS(`/expire/${encodeURIComponent(limitKey)}/86400`);

  } catch (limitErr) {
    console.error("限流检查失败:", limitErr);
    // Redis 异常时放行，避免阻断业务
  }

  // ==========================================================
  // 🔒 第三道防线：标记 Token 为已使用（原子操作）
  // ==========================================================
  await REDIS(`/set/${encodeURIComponent(`token:${token}`)}/used`);

  // ==========================================================
  // 🤖 第四道防线：AI 分析（带重试机制）
  // ==========================================================
  const BAIDU_API_KEY = process.env.BAIDU_API_KEY;
  const BAIDU_SECRET_KEY = process.env.BAIDU_SECRET_KEY;
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

  try {
    // 1. 百度人脸检测
    const tokenRes = await fetch(`https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${BAIDU_API_KEY}&client_secret=${BAIDU_SECRET_KEY}`);
    const tokenData = await tokenRes.json();

    const detectRes = await fetch(`https://aip.baidubce.com/rest/2.0/face/v3/detect?access_token=${tokenData.access_token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, image_type: 'BASE64', face_field: 'age,gender,beauty,faceshape,landmark150' })
    });
    const faceData = await detectRes.json();
    const face = faceData.result.face_list[0];

    // 2. 特征计算
    const lm = face.landmark150;
    const getPt = (name) => lm.find(p => p.name === name);
    const top = getPt('contour_top').y;
    const chin = getPt('contour_chin').y;
    const browL = getPt('left_eyebrow_center').y;
    const nose = getPt('nose_tip').y;
    const faceH = chin - top;

    const features = {
      shape: face.faceshape[0].type,
      age: face.age,
      beauty: Math.round(face.beauty.female_score || face.beauty.male_score),
      upperRatio: ((browL - top) / faceH).toFixed(2),
      lowerRatio: ((chin - nose) / faceH).toFixed(2),
    };

    // 3. 带重试的 DeepSeek 调用
    async function callDeepSeekWithRetry(messages, retries = 3) {
      for (let i = 0; i < retries; i++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 25000);

          const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
              model: 'deepseek-chat',
              messages: messages,
              temperature: 0.7
            }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            if (response.status === 429 || response.status >= 500) {
              throw new Error(`Server busy: ${response.status}`);
            }
            throw new Error(`Fatal API Error: ${await response.text()}`);
          }
          return await response.json();
        } catch (error) {
          console.error(`DeepSeek attempt ${i + 1} failed:`, error.message);
          if (i === retries - 1) {
            throw new Error('AI 服务暂时不可用，请稍后再试');
          }
          const delay = Math.pow(2, i) * 1000;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    const messages = [
      { role: 'system', content: '你是一位顶级的明星造型师，擅长根据面部特征给出具体的美妆和发型建议。语言要亲切、像闺蜜聊天一样，避免生硬的术语堆砌。' },
      { role: 'user', content: `请根据以下面部数据分析结果，生成一份详细的美妆建议报告（包含修容、眉形、腮红、唇妆、发型）：\n数据：${JSON.stringify(features, null, 2)}` }
    ];

    const gptData = await callDeepSeekWithRetry(messages);
    const advice = gptData.choices[0].message.content;

    res.json({ success: true, features, advice });

  } catch (error) {
    console.error('Fatal Error:', error);
    // 🔥 关键：AI 失败时回滚 Token，让用户能重试用
    await REDIS(`/set/${encodeURIComponent(`token:${token}`)}/unused`);
    res.status(500).json({ error: error.message || '分析失败，请稍后重试' });
  }
}
