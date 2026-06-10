// api/analyze-face.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
  // 1. CORS 配置
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST 请求' });

  try {
    // 2. 解析 FormData 中的图片（修复 Vercel 兼容性问题）
    const imageBase64 = await parseFormData(req);
    if (!imageBase64) {
      return res.status(400).json({ error: '请上传有效的图片文件（JPG/PNG）' });
    }

    // 3. 获取百度 Token
    const accessToken = await getBaiduToken();
    if (!accessToken) {
      return res.status(500).json({ error: 'AI 服务认证失败，请检查密钥' });
    }

    // 4. 调用百度人脸检测
    const detectResult = await callBaiduAPI(accessToken, imageBase64);
    if (!detectResult.success) {
      return res.status(400).json({ error: detectResult.error });
    }

    // 5. 格式化并返回结果
    const result = formatResult(detectResult.data);
    res.status(200).json({ success: true, ...result });

  } catch (error) {
    console.error('💥 服务器内部错误:', error);
    res.status(500).json({ error: '服务器开小差了，请稍后再试' });
  }
}

// 解析 FormData（核心修复：兼容 Vercel 无 multer 环境）
async function parseFormData(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const boundary = req.headers['content-type']?.split('boundary=')[1];
        if (!boundary) return resolve(null);

        // 提取图片二进制数据
        const parts = buffer.toString().split(`--${boundary}`);
        const imagePart = parts.find(p => p.includes('filename=') && p.includes('Content-Type: image/'));
        if (!imagePart) return resolve(null);

        const base64Start = imagePart.indexOf('\r\n\r\n') + 4;
        const base64End = imagePart.lastIndexOf('\r\n');
        let base64 = imagePart.substring(base64Start, base64End).replace(/\s/g, '');

        // 验证 Base64 格式
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return resolve(null);
        resolve(base64);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// 缓存百度 Token（减少请求次数）
let cachedToken = { value: null, expiresAt: 0 };
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
    cachedToken.expiresAt = now + 29 * 24 * 60 * 60 * 1000; // 缓存 29 天
    return data.access_token;
  } catch (error) {
    console.error('获取 Token 失败:', error);
    return null;
  }
}

// 调用百度 API
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
      return { success: false, error: `AI 识别失败：${data.error_msg}` };
    }
    return { success: true, data: data.result };
  } catch (error) {
    console.error('百度 API 调用失败:', error);
    return { success: false, error: '调用 AI 服务超时' };
  }
}

// 格式化结果
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

// 生成建议
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
