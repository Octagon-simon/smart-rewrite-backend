import { generateText } from "ai"
import { xai } from "@ai-sdk/xai"

async function rewriteTextWithAI(text) {
  try {
    const result = await generateText({
      model: xai("grok-4", {
        apiKey: process.env.XAI_API_KEY, // Automatically available from Vercel Grok integration
      }),
      prompt: text,
      system: `You are a professional writing assistant. Rewrite the given text to make it more professional, polished, and appropriate for business communication while maintaining the original meaning and intent. 

Guidelines:
- Use formal language and proper grammar
- Replace casual expressions with professional alternatives
- Maintain the original tone and message
- Keep the same length approximately
- Do not add extra content or change the core message
- Return only the rewritten text without explanations`,
    })

    return result.text
  } catch (error) {
    console.error("Error with AI rewriting:", error)
    // Fallback to basic rewriting if AI fails
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") {
    res.status(200).end()
    return
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" })
  }

  try {
    const { content } = req.body

    if (!content) {
      return res.status(400).json({
        success: false,
        error: "No content provided",
      })
    }

    console.log("Received rewrite request for:", content.substring(0, 50) + "...")

    const rewrittenText = await rewriteTextWithAI(content)

    console.log("Rewritten text:", rewrittenText.substring(0, 50) + "...")

    res.json({
      success: true,
      data: {
        response: rewrittenText,
      },
    })
  } catch (error) {
    console.error("Error in rewrite endpoint:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
    })
  }
}
