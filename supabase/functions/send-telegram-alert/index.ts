import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { title, message, type, metadata, origin } = await req.json();

    const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || "8840844878:AAHpgUWLrLgZcEAKP7vqo4WtgjgEWTg2UK8";
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID") || "-4791701805";

    if (!token || !chatId) {
      return new Response(
        JSON.stringify({ error: "Telegram bot token or chat ID is missing." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let statusEmoji = "🔔";
    if (type?.includes("approved") || type?.includes("ready")) {
      statusEmoji = "✅";
    } else if (type?.includes("rejected")) {
      statusEmoji = "❌";
    } else if (type?.includes("submitted")) {
      statusEmoji = "📝";
    }

    const baseUrl = origin || "https://moodle-question-bank.vercel.app";
    let actionUrl = `${baseUrl}/auth`;

    if (metadata?.test_url) {
      actionUrl = metadata.test_url;
    } else if (type === "submitted_for_review") {
      actionUrl = `${baseUrl}/admin`;
    } else if (type === "submitted_for_teacher_review") {
      actionUrl = `${baseUrl}/teacher`;
    } else if (metadata?.question_id) {
      actionUrl = `${baseUrl}/teacher/edit-question/${metadata.question_id}`;
    } else if (type?.includes("approved") || type?.includes("rejected")) {
      actionUrl = `${baseUrl}/teacher`;
    }

    const htmlMessage =
      `${statusEmoji} <b>Moodle Question Bank Alert</b>\n\n` +
      `<b>Action:</b> ${title}\n` +
      `<b>Detail:</b> ${message}\n\n` +
      `🔗 <b>Link:</b> <a href="${actionUrl}">${actionUrl}</a>`;

    const telegramRes = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlMessage,
          parse_mode: "HTML",
        }),
      }
    );

    const result = await telegramRes.json();
    return new Response(JSON.stringify(result), {
      status: telegramRes.ok ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
