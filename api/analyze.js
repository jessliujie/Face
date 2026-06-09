// api/analyze.js
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { imageBase64, token } = req.body;

  // 1. 校验 Token
  if (!token) return res.status(400).json({ error: '缺少访问凭证' });
  
  const tokenStatus = await kv.get(`token:${token}`);
  
  if (!tokenStatus) {
    return res.status(410).json({ error: '链接不存在或已过期' });
  }
  if (tokenStatus === 'used') {
    return res.status(410).json({ error: '链接已使用，不可重复测评' });
  }

  // 2. 标记 Token 为已使用（核心：点击一次即失效）
  await kv.set(`token:${token}`, 'used');

  // --- 以下为百度AI + GPT 原逻辑（保持不变）---
  const BAIDU_API_KEY = process.env.BAIDU_API_KEY;
  const BAIDU_SECRET_KEY = process.env.BAIDU_SECRET_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  try {
    // 获取百度 Token
    const tokenRes = await fetch(`https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${BAIDU_API_KEY}&client_secret=${BAIDU_SECRET_KEY}`);
    const tokenData = await tokenRes.json();

    // 调用百度人脸检测
    const detectRes = await fetch(`https://aip.baidubce.com/rest/2.0/face/v3/detect?access_token=${tokenData.access_token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, image_type: 'BASE64', face_field: 'age,gender,beauty,faceshape,landmark150' })
    });
    const faceData = await detectRes.json();
    const face = faceData.result.face_list[0];

    // 计算特征（简化版，直接用之前的算法）
    const lm = face.landmark150;
    const getPt = (name) => lm.find(p => p.name === name);
    const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
    
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
      // ... 其他特征
    };

    // 调用 GPT
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{role:'system',content:'你是顶级造型师，语言亲切像闺蜜。'},{role:'user',content:`根据数据给建议：${JSON.stringify(features)}`}],
        temperature: 0.7
      })
    });
    const gptData = await gptRes.json();

    res.json({ success: true, features, advice: gptData.choices[0].message.content });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '分析失败' });
  }
}
