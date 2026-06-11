const axios = require('axios');
const { OpenAI } = require('openai');

const openai = new OpenAI({ 
    apiKey: process.env.DEEPSEEK_API_KEY, 
    baseURL: 'https://api.deepseek.com/v1' 
});

let cachedToken = null, tokenExpireTime = 0;

async function getBaiduToken() {
    if (cachedToken && Date.now() < tokenExpireTime) return cachedToken;
    const res = await axios.post(
        `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${process.env.BAIDU_API_KEY}&client_secret=${process.env.BAIDU_SECRET_KEY}`
    );
    cachedToken = res.data.access_token;
    tokenExpireTime = Date.now() + 2592000000; 
    return cachedToken;
}

async function callBaiduVisionAPI(imageBase64) {
    const token = await getBaiduToken();
    
    const params = new URLSearchParams();
    params.append('image', imageBase64.split(',')[1] || imageBase64); 
    params.append('image_type', 'BASE64');
    params.append('face_field', 'age,gender,face_shape,quality,spoofing,expression,face_type');

    try {
        const res = await axios.post(
            `https://aip.baidubce.com/rest/2.0/face/v3/detect?access_token=${token}`,
            params,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 }
        );

        if (res.data.error_code !== 0) {
            const code = res.data.error_code;
            if (code === 222202) throw new Error('NO_FACE'); 
            if (code === 222207) throw new Error('IMAGE_SIZE'); 
            throw new Error(`BAIDU_ERR:${code}`);
        }

        if (!res.data.result?.face_list?.length) throw new Error('NO_FACE');

        const face = res.data.result.face_list[0];

        if (face.face_type?.type !== 'human') throw new Error('FACE_TYPE_FAKE');
        if (face.quality?.blur > 0.7) throw new Error('IMAGE_BLUR');

        return face;

    } catch (err) {
        throw err;
    }
}

function analyzeSocialDistance(face) {
    let score = 50;
    const traits = [];

    if (face.expression?.type === 'smile' && face.expression.probability > 0.6) { 
        score -= 25; 
        traits.push('笑意盈盈'); 
    } else { 
        score += 15; 
        traits.push('清冷克制'); 
    }

    const shape = face.face_shape?.type;
    if (['square', 'diamond', 'triangle'].includes(shape)) { 
        score += 20; 
        traits.push('骨骼感强'); 
    } else { 
        score -= 15; 
        traits.push('轮廓柔和'); 
    }

    score = Math.max(0, Math.min(100, score));
    
    let archetype = '';
    if (score >= 75) archetype = '高智清冷型 (The Intellectual)';
    else if (score >= 55) archetype = '独立御姐型 (The Independent)';
    else if (score >= 35) archetype = '温婉知性型 (The Empath)';
    else archetype = '幼态甜心型 (The Sweetheart)';

    return { score, archetype, traits };
}

const SENSITIVE_REGEX = /绝绝子|天花板|闭眼入|王炸|YYDS|家人们|第一|最有效|100%|彻底根除|速看|震惊|秘籍|宝典|神器|必看|赶紧|立即|点击|下载|免费|赠品|中奖|恭喜|活动|优惠|折扣|限时|独家|秘方|神药|根治|无效退款|稳赚|投资/gi;

function sanitizeOutput(text) {
    if (!text) return '';
    let clean = text.replace(SENSITIVE_REGEX, '');
    clean = clean.replace(/\s+/g, ' ').trim();
    if (clean.length < 5) clean = '暂无详细分析';
    return clean;
}

async function callDeepSeekWithTimeout(messages, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { 
                    role: 'system', 
                    content: `你是资深心理与面相美学专家。语气客观、专业。
                    ⚠️合规禁令：
                    1. 禁止使用夸张营销词、极限词。
                    2. 若检测到公众人物特征，禁止提及真名，必须转化为“美学风格原型”进行去身份化拆解。` 
                },
                ...messages
            ],
            temperature: 0.7, 
            max_tokens: 500
        }, { signal: controller.signal });

        clearTimeout(timeoutId);
        const content = res.choices[0].message.content;
        return sanitizeOutput(content);

    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            return '【AI 思考超时】系统正在努力解析您的气质维度，请稍后重试。';
        }
        console.error('DeepSeek 调用错误:', err);
        return '【分析中断】AI 服务暂时不可用，请稍后再试。';
    }
}

module.exports = { 
    callBaiduVisionAPI, 
    analyzeSocialDistance, 
    sanitizeOutput, 
    callDeepSeekWithTimeout 
};