// api/analyze.js
export default async function handler(req, res) {
    // 只允许 POST 请求
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { image } = req.body;

        // 1. 基础校验
        if (!image) {
            return res.status(400).json({ error: '缺少 image 参数' });
        }

        // 2. 鉴权信息（请务必确认 Vercel 环境变量已设置！）
        const ACCESS_TOKEN = process.env.BAIDU_ACCESS_TOKEN;
        
        if (!ACCESS_TOKEN) {
            console.error('❌ 服务器错误：未配置 BAIDU_ACCESS_TOKEN 环境变量');
            return res.status(500).json({ error: '服务器配置错误，请联系管理员' });
        }

        // 3. 调用百度人脸检测 API
        // 文档：https://ai.baidu.com/tech/face/detect
        const baiduUrl = `https://aip.baidubce.com/rest/2.0/face/v3/detect?access_token=${ACCESS_TOKEN}`;
        
        // 请求参数
        const params = new URLSearchParams();
        params.append('image', image.split(',')[1]); // 去掉 base64 前缀
        params.append('image_type', 'BASE64');
        params.append('face_field', 'faceshape,facetype,age,beauty,gender,expression'); // 请求更多字段

        // 使用 fetch 发送请求，并设置 8 秒超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时

        try {
            const response = await fetch(baiduUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params,
                signal: controller.signal // 绑定超时信号
            });
            
            clearTimeout(timeoutId); // 清除超时计时器

            const data = await response.json();

            // 4. 检查百度 API 返回的错误码
            if (data.error_code) {
                console.error('❌ 百度API报错：', data.error_msg);
                // 如果是鉴权过期或 QPS 超限，返回具体原因
                return res.status(502).json({ error: `AI服务异常: ${data.error_msg}` });
            }

            // 5. 检查是否检测到人脸
            if (!data.result || data.result.face_num === 0) {
                return res.status(404).json({ error: '未检测到人脸，请上传正脸清晰照片' });
            }

            // 6. 成功：提取数据并简化返回给前端
            const face = data.result.face_list[0];
            const features = {
                shape: face.face_shape?.type || '未知',
                type: face.face_type?.type || '未知',
                age: face.age,
                beauty: face.beauty.toFixed(1),
                gender: face.gender === 'male' ? '男' : '女',
                expression: face.expression?.type || '无'
            };

            // 模拟生成的建议（这里可以根据 features 做更复杂的逻辑）
            const advice = generateAdvice(features);

            res.status(200).json({
                features: features,
                advice: advice
            });

        } catch (fetchError) {
            clearTimeout(timeoutId);
            // 捕获超时或其他网络错误
            console.error('❌ 请求百度API失败：', fetchError.message);
            res.status(504).json({ error: 'AI服务器响应超时，请稍后再试' });
        }

    } catch (error) {
        console.error('❌ 服务器内部错误：', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
}

// 辅助函数：生成建议（保持原有逻辑）
function generateAdvice(f) {
    let text = '';
    if (f.shape === 'oval') text += '· 鹅蛋脸线条流畅，适合大多数发型，保持自信就是最美的。\n';
    else if (f.shape === 'round') text += '· 圆脸显得亲和力强，建议尝试侧分长发修饰脸型。\n';
    else if (f.shape === 'square') text += '· 方脸下颌线分明，适合柔和的波浪卷发。\n';
    else text += '· 独特的脸型非常有辨识度，建议突出五官优势。\n';
    
    text += `\n预计年龄：${f.age}岁\n`;
    text += `颜值评分：${f.beauty}分 (满分100)\n\n`;
    
    text += '💄 美妆建议：\n';
    text += '1. 底妆清透，突出皮肤质感。\n';
    text += '2. 眼妆自然放大，提升神采。\n';
    text += '3. 唇色选择显气质的豆沙色或正红色。\n';
    
    return text;
}
