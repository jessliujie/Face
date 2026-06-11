const { Redis } = require('@upstash/redis');
const { callBaiduVisionAPI, analyzeSocialDistance, callDeepSeekWithTimeout } = require('./utils');

const redis = new Redis({ 
    url: process.env.UPSTASH_REDIS_REST_URL, 
    token: process.env.UPSTASH_REDIS_REST_TOKEN 
});

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    
    const { token, imageBase64 } = req.body;
    if (!token || !imageBase64) return res.status(400).json({ success: false, error: '参数缺失' });

    const redisKey = `vibe_link:${token}`;

    try {
        const status = await redis.get(redisKey);
        if (status !== 'unused') {
            return res.status(200).json({ success: false, error: '链接已失效或已使用' });
        }
        await redis.set(redisKey, 'processing', { ex: 300 }); 

        let face;
        try {
            face = await callBaiduVisionAPI(imageBase64);
        } catch (err) {
            const msg = err.message;
            if (msg === 'NO_FACE') return rollback(res, redisKey, '📸 没找到您的正脸哦，请确保光线充足，正面直视镜头。');
            if (msg === 'IMAGE_SIZE') return rollback(res, redisKey, '🖼️ 图片体积过大或格式不支持，请尝试上传较小的 JPG 图片。');
            if (msg === 'IMAGE_BLUR') return rollback(res, redisKey, '🌫️ 面部纹理丢失严重（疑似重度磨皮或失焦），请关闭美颜在自然光下重拍。');
            if (msg === 'FACE_TYPE_FAKE') return rollback(res, redisKey, '🛡️ AI 发现照片疑似卡通、非真人或严重遮挡，请使用原相机真人拍摄。');
            if (msg.startsWith('BAIDU_ERR:')) return rollback(res, redisKey, '🔍 视觉引擎开小差了，请检查网络后重新上传。');
            return rollback(res, redisKey, '⚠️ 照片解析失败，请换一张清晰的正面照重试。');
        }

        if (face.spoofing !== undefined && face.spoofing < 0.8) {
            return rollback(res, redisKey, '🛡️ AI 发现照片疑似翻拍屏幕或网图，请使用原相机现场拍摄真人。');
        }

        const vibeData = analyzeSocialDistance(face);

        const baseData = `年龄${face.age}岁，性别${face.gender.type}，脸型${face.face_shape?.type || '未知'}。距离感指数：${vibeData.score}/100。性格原型：${vibeData.archetype}。特征：${vibeData.traits.join('、')}。`;
        
        const [rawAnalysis, rawAdvice] = await Promise.all([
            callDeepSeekWithTimeout([{ role: 'user', content: `${baseData}\n请深度剖析【社交面具与真实内核的反差】及【职场/情场的人际磁场优势与隐患】。限150字。` }]),
            callDeepSeekWithTimeout([{ role: 'user', content: `${baseData}\n请给出专属“破局”建议：如何通过微调表情、发型或配饰，自由切换亲和力与气场？限100字。` }])
        ]);

        await redis.set(redisKey, 'used');
        
        res.status(200).json({
            success: true,
            data: {
                radar: {
                    affinity: 100 - vibeData.score, 
                    intellect: vibeData.score > 60 ? 85 : 40, 
                    aura: vibeData.traits.includes('骨骼感强') ? 90 : 30, 
                    innocence: vibeData.traits.includes('轮廓柔和') ? 80 : 20, 
                    mystery: vibeData.score > 70 ? 85 : 30 
                },
                archetype: vibeData.archetype,
                analysisText: rawAnalysis, 
                adviceText: rawAdvice
            }
        });

    } catch (error) {
        console.error('系统异常:', error);
        await redis.set(redisKey, 'unused', { ex: 604800 }); 
        res.status(500).json({ success: false, error: 'AI 美学引擎繁忙，请稍后重试。' });
    }
};

async function rollback(res, redisKey, msg) {
    await redis.set(redisKey, 'unused', { ex: 604800 });
    return res.status(200).json({ success: false, error: msg });
}