// api/analyze-face.js
import fetch from 'node-fetch';

// 缓存百度Token（避免重复请求）
let cachedToken = { value: null, expiresAt: 0 };

export default async function handler(req, res) {
  // 1. CORS配置
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 2. 处理预检请求
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持POST请求' });

  try {
    // 3. 解析前端上传的图片
    const imageBase64 = await parseFormData(req);
    if (!imageBase64) return res.status(400).json({ error: '请上传有效的图片文件' });

    // 4. 获取百度AI Token（带缓存）
    const accessToken = await getBaiduToken();
    if (!accessToken) return res.status(500).json({ error: 'AI服务认证失败' });

    // 5. 调用百度人脸检测
    const detectResult = await callBaiduAPI(accessToken, imageBase64);
    if (!detectResult.success) return res.status(400).json({ error: detectResult.error });

    // 6. 格式化结果并返回
    const result = formatResult(detectResult.data);
    res.status(200).json({ success: true, ...result });

  } catch (error) {
    console.error('分析失败:', error);
    res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  }
}

// 解析FormData（Vercel兼容版）
async function parseFormData(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const boundary = req.headers['content-type']?.split('boundary=')[1];
        if (!boundary) return resolve(null);

        // 提取图片Base64
        const parts = buffer.toString().split(`--${boundary}`);
        const imagePart = parts.find(p => p.includes('filename=') && p.includes('Content-Type: image/'));
        if (!imagePart) return resolve(null);

        const base64Start = imagePart.indexOf('\r\n\r\n') + 4;
        const base64End = imagePart.lastIndexOf('\r\n');
        let base64 = imagePart.substring(base64Start, base64End).replace(/\s/g, '');

        // 验证Base64格式
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return resolve(null);
        resolve(base64);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// 获取百度Token（缓存29天）
async function getBaiduToken() {
  const now = Date.now();
  if (cachedToken.value && cachedToken.expiresAt > now) return cachedToken.value;

  const BAIDU_API_KEY = process.env.BAIDU_API_KEY || 'sUTxkNaeHT3WjMaWDBWcsPr6';
  const BAIDU_SECRET_KEY = process.env.BAIDU_SECRET_KEY || '3bAamT8SPFzxfzfDtrv1aZHOuWHngQ8p';

  try {
    const res = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${BAIDU_API_KEY}&client_secret=${BAIDU_SECRET_KEY}`
    );
    const data = await res.json();
    if (!data.access_token) return null;

    cachedToken.value = data.access_token;
    cachedToken.expiresAt = now + 29 * 24 * 60 * 60 * 1000; // 29天
    return data.access_token;
  } catch (error) {
    console.error('获取Token失败:', error);
    return null;
  }
}

// 调用百度人脸检测API
async function callBaiduAPI(accessToken, imageBase64) {
  try {
    const res = await fetch(
      `https://aip.baidubce.com/rest/2.0/face/v3/detect?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageBase64,
          image_type: 'BASE64',
          face_field: 'age,gender,beauty,faceshape,emotion',
          max_face_num: 1
        })
      }
    );

    const data = await res.json();
    if (data.error_code !== 0) {
      return { success: false, error: `AI识别失败：${data.error_msg}` };
    }

    return { success: true, data: data.result };
  } catch (error) {
    console.error('百度API调用失败:', error);
    return { success: false, error: '调用AI服务失败' };
  }
}

// 格式化分析结果
function formatResult(baiduResult) {
  const face = baiduResult.face_list[0];
  const beautyScore = Math.round(
    (face.beauty.female_score * 0.6 + face.beauty.male_score * 0.4)
  );

  const features = {
    shape: face.faceshape.type || '未知',
    age: face.age || 0,
    beauty: beautyScore,
    gender: face.gender?.type || '未知',
    emotion: face.emotion?.type || '平静'
  };

  const advice = generateAdvice(features);
  return { features, advice };
}

// 生成个性化建议
function generateAdvice(features) {
  const tips = {
    square: '方脸适合柔和线条发型（如大波浪），中和棱角。',
    triangle: '三角脸建议增加额头蓬松度，平衡下巴宽度。',
    oval: '鹅蛋脸是万能脸型，几乎所有发型都能驾驭！',
    heart: '心形脸适合侧分长发，修饰较宽额头。',
    round: '圆脸适合高颅顶发型，拉长脸部比例。'
  };

  const ageTip = features.age < 25 
    ? '年轻肌肤胶原蛋白充足，适合清新自然妆容。'
    : features.age < 35 
    ? '注重保湿和抗初老，适当强调轮廓立体感。'
    : '选择滋润度高的底妆，注重遮瑕和提亮。';

  return `根据你的 ${tips[features.shape] || '独特脸型'} 和 ${features.age} 岁年龄特征：
1. ${ageTip}
2. 妆容重点突出五官立体感，使用修容加强下颌线。
3. 穿搭推荐低饱和度色系（如雾霾蓝、莫兰迪粉）。

✨ 自信的你最美啦！`;
}
