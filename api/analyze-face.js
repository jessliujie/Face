// api/analyze-face.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
  // 1. 设置CORS头，允许前端跨域访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. 只允许POST请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed - 请用 POST' });
  }

  try {
    // 3. 解析前端传来的FormData图片
    const formData = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // 简单解析FormData获取图片Base64
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

    // 4. 使用你提供的百度云密钥（已替换）
    const BAIDU_API_KEY = 'sUTxkNaeHT3WjMaWDBWcsPr6';
    const BAIDU_SECRET_KEY = '3bAamT8SPFzxfzfDtrv1aZHOuWHngQ8p';

    // 5. 获取百度AI访问令牌
    const tokenRes = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${BAIDU_API_KEY}&client_secret=${BAIDU_SECRET_KEY}`
    );
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error('❌ 获取百度 Token 失败:', tokenData);
      return res.status(500).json({ error: 'AI 服务认证失败' });
    }

    // 6. 调用百度人脸检测API
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

    // 7. 处理百度API返回的错误
    if (detectData.error_code !== 0) {
      console.error('❌ 百度 API 报错:', detectData.error_msg);
      return res.status(400).json({ error: `AI 识别失败: ${detectData.error_msg}` });
    }

    // 8. 提取人脸特征数据
    const face = detectData.result.face_list[0];
    const features = {
      shape: face.faceshape.type,
      age: face.age,
      beauty: Math.round(face.beauty.female_score || face.beauty.male_score),
      gender: face.gender.type
    };

    // 9. 生成变美建议（可后续替换为DeepSeek生成）
    const advice = `根据你的 ${features.shape} 脸型和 ${features.age} 岁的年龄特征：
1. 脸型轮廓流畅，建议尝试法式空气刘海修饰额头。
2. 妆容方面，重点突出五官立体感，使用修容加强下颌线。
3. 穿搭推荐低饱和度色系，如雾霾蓝或莫兰迪粉，能衬托你的气质。

✨ 自信的你最美啦！`;

    // 10. 返回结果给前端
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
