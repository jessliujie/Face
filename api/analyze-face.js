// api/analyze-face.js
import fetch from 'node-fetch'; // 确保 Vercel 环境有 fetch

export default async function handler(req, res) {
  // 1. 设置 CORS 头，允许前端跨域访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed - 请用 POST' });
  }

  try {
    // 3. 从请求中获取图片文件（FormData）
    const formData = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // 简单解析 FormData (只取第一个文件)
        const match = buffer.toString().match(/filename="(.+?)"\r\nContent-Type: (.+?)\r\n\r\n([\s\S]*?)\r\n------/);
        if (match) {
          const base64 = buffer.toString('base64').split(match[0])[1];
          resolve(base64);
        } else {
          reject(new Error('未找到图片文件'));
        }
      });
      req.on('error', reject);
    });

    if (!formData) {
      return res.status(400).json({ error: '请上传图片文件' });
    }

    // 4. 获取百度 AI 的 Access Token
    const BAIDU_API_KEY = process.env.BAIDU_API_KEY;
    const BAIDU_SECRET_KEY = process.env.BAIDU_SECRET_KEY;

    if (!BAIDU_API_KEY || !BAIDU_SECRET_KEY) {
      console.error('❌ 环境变量缺失: BAIDU_API_KEY 或 BAIDU_SECRET_KEY');
      return res.status(500).json({ error: '服务器配置错误，请联系管理员' });
    }

    const tokenRes = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${BAIDU_API_KEY}&client_secret=${BAIDU_SECRET_KEY}`
    );
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error('❌ 获取百度 Token 失败:', tokenData);
      return res.status(500).json({ error: 'AI 服务认证失败' });
    }

    // 5. 调用百度人脸检测 API
    const detectRes = await fetch(
      `https://aip.baidubce.com/rest/2.0/face/v3/detect?access_token=${tokenData.access_token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: formData,
          image_type: 'BASE64',
          face_field: 'age,gender,beauty,faceshape'
        })
      }
    );

    const detectData = await detectRes.json();

    // 6. 检查百度 API 返回的错误
    if (detectData.error_code !== 0) {
      console.error('❌ 百度 API 报错:', detectData.error_msg);
      return res.status(400).json({ error: `AI 识别失败: ${detectData.error_msg}` });
    }

    // 7. 提取数据
    const face = detectData.result.face_list[0];
    const features = {
      shape: face.faceshape.type,
      age: face.age,
      beauty: Math.round(face.beauty.female_score || face.beauty.male_score),
      gender: face.gender.type
    };

    // 8. 生成建议（这里可以接 DeepSeek，为了简化先用固定文案）
    const advice = `根据你的 ${features.shape} 脸型和 ${features.age} 岁的年龄特征：
1. 脸型轮廓流畅，建议尝试法式空气刘海修饰额头。
2. 妆容方面，重点突出五官立体感，使用修容加强下颌线。
3. 穿搭推荐低饱和度色系，如雾霾蓝或莫兰迪粉，能衬托你的气质。

✨ 自信的你最美啦！`;

    // 9. 返回给前端
    return res.status(200).json({
      success: true,
      features: features,
      advice: advice
    });

  } catch (error) {
    console.error('💥 服务器内部错误:', error);
    return res.status(500).json({ error: '服务器内部错误: ' + error.message });
  }
}
