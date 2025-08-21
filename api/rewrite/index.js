import { generateText } from "ai"
import { xai } from "@ai-sdk/xai"
import crypto from "crypto"
import Redis from "ioredis"

const redis = new Redis(process.env.REDIS_URL)

async function rewriteTextWithAI(text, translateToFrench = false) {
  try {
    const prompt = translateToFrench
      ? `Please rewrite the following text professionally and then translate it to French: "${text}"`
      : `Please rewrite the following text professionally: "${text}"`

    const result = await generateText({
      model: xai("grok-4", {
        apiKey: process.env.XAI_API_KEY,
      }),
      prompt: prompt,
      system: `You are a professional writing assistant. Rewrite the given text to make it more professional, polished, and appropriate for business communication while maintaining the original meaning and intent.

Guidelines:
- Use formal language and proper grammar
- Replace casual expressions with professional alternatives
- Maintain the original tone and message
- Keep the same length approximately
- Do not add extra content or change the core message
- If asked to translate to French, first rewrite professionally in English, then provide an accurate French translation with proper grammar and natural language
- Return only the final rewritten text (in French if translation was requested) without explanations`,
    })

    return result.text
  } catch (error) {
    console.error("Error with AI rewriting:", error)
    return basicRewrite(text)
  }
}

function basicRewrite(text) {
  return text
    .replace(/can't/gi, "cannot")
    .replace(/won't/gi, "will not")
    .replace(/don't/gi, "do not")
    .replace(/\bhey\b/gi, "Hello")
    .replace(/\bhi\b/gi, "Hello")
    .replace(/\bthanks\b/gi, "Thank you")
    .replace(/\byeah\b/gi, "yes")
    .replace(/\bgonna\b/gi, "going to")
    .replace(/(^|\. )([a-z])/g, (match, p1, p2) => p1 + p2.toUpperCase())
}

// ---- Security Helpers ----
async function getDeviceSecret(deviceId) {
  return await redis.get(`device:${deviceId}:secret`)
}

async function saveDeviceSecret(deviceId, secret) {
  await redis.set(`device:${deviceId}:secret`, secret, "EX", 60 * 60 * 24 * 365) // 1 year
}

async function isReplay(deviceId, nonce) {
  const key = `device:${deviceId}:nonce:${nonce}`
  const exists = await redis.exists(key)
  if (exists) return true
  await redis.set(key, "1", "EX", 60) //nonces valid for 60s only
  return false
}

async function verifyRequest(req, res) {
  const {
    "x-device-id": deviceId,
    "x-timestamp": timestamp,
    "x-nonce": nonce,
    "x-signature": signature,
    // "x-extension-id": extensionId,//will use on prod
    "x-device-secret": maybeSecret, //used on first registration
  } = req.headers

  if (!deviceId || !timestamp || !nonce || !signature) {
    return { ok: false, error: "Missing auth headers" }
  }

  // timestamp drift
  const drift = 60 * 1000 // 60s tolerance
  if (Math.abs(Date.now() - parseInt(timestamp, 10)) > drift) {
    return { ok: false, error: "Timestamp drift too large" }
  }

  // replay attack prevention
  if (await isReplay(deviceId, nonce)) {
    return { ok: false, error: "Replay detected" }
  }

  // get or register device secret
  let deviceSecret = await getDeviceSecret(deviceId)
  if (!deviceSecret && maybeSecret) {
    await saveDeviceSecret(deviceId, maybeSecret)
    deviceSecret = maybeSecret
  }
  if (!deviceSecret) {
    return { ok: false, error: "Unknown device" }
  }

  // recompute signature
  const payload = `${req.method}|${req.url}|${timestamp}|${nonce}|${deviceId}`;
  console.log(`${req.method}|${req.url}|${timestamp}|${nonce}|${deviceId}`);
  const expected = crypto.createHash("sha256").update(payload + deviceSecret).digest("hex")

  if (expected !== signature) {
    return { ok: false, error: "Invalid signature" }
  }

  return { ok: true, deviceId }
}

// ---- Main Handler ----
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-id, x-timestamp, x-nonce, x-signature, x-extension-id, x-device-secret")

  if (req.method === "OPTIONS") {
    res.status(200).end()
    return
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" })
  }

  const verification = await verifyRequest(req, res)
  if (!verification.ok) {
    return res.status(401).json({ success: false, error: verification.error })
  }

  try {
    const { content, translateToFrench } = req.body
    if (!content) {
      return res.status(400).json({ success: false, error: "No content provided" })
    }

    console.log(`[${verification.deviceId}] Rewrite request:`, content.substring(0, 50) + "...")
    const rewrittenText = await rewriteTextWithAI(content, translateToFrench)
    console.log(`[${verification.deviceId}] Rewritten:`, rewrittenText.substring(0, 50) + "...")

    res.json({ success: true, data: { response: rewrittenText } })
  } catch (error) {
    console.error("Error in rewrite endpoint:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}
