const MAX_BODY_BYTES = 24_000;

const FORMAT_LABELS = {
  "": "Пока не определён",
  compare: "Хочу сравнить варианты",
  studio: "Работа в студии",
  remote: "Удалённый формат",
  phone: "Работа с телефона"
};

const EQUIPMENT_LABELS = {
  "": "Не указано",
  unknown: "Пока не знает",
  computer: "Компьютер и интернет",
  phone: "Только телефон",
  none: "Нет оборудования"
};

const SOURCE_LABELS = {
  homepage_quick_form: "Быстрая форма",
  homepage_final_form: "Основная форма",
  consultation_popup: "Всплывающая форма"
};

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function readField(formData, name, maxLength, multiline = false) {
  const value = String(formData.get(name) || "").trim().slice(0, maxLength);
  return multiline ? value.replace(/\r\n?/g, "\n") : value.replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isConfirmed(value) {
  return ["yes", "on", "1", "true"].includes(String(value || "").toLowerCase());
}

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!origin || !host) return true;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function addLine(lines, label, value) {
  if (value) lines.push(`<b>${label}:</b> ${escapeHtml(value)}`);
}

export async function POST(request) {
  if (!isSameOrigin(request)) {
    return json({ ok: false, message: "Запрос отклонён." }, 403);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, message: "Форма содержит слишком много данных." }, 413);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, message: "Не удалось прочитать данные формы." }, 400);
  }

  if (readField(formData, "website", 200)) {
    return json({ ok: true, message: "Заявка отправлена." });
  }

  const name = readField(formData, "name", 80);
  const contact = readField(formData, "contact", 120);
  const city = readField(formData, "city", 100);
  const workFormat = readField(formData, "work_format", 40);
  const equipment = readField(formData, "equipment", 40);
  const contactTime = readField(formData, "contact_time", 80);
  const comment = readField(formData, "comment", 1000, true);
  const source = readField(formData, "source", 80);
  const ageConfirmed = isConfirmed(formData.get("age_confirmed"));
  const privacyConsent = isConfirmed(formData.get("privacy_consent"));

  if (!name || !contact) {
    return json({ ok: false, message: "Укажите имя и способ связи." }, 422);
  }

  if (!ageConfirmed || !privacyConsent) {
    return json({ ok: false, message: "Необходимо подтвердить возраст и согласие на обработку данных." }, 422);
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.error("Telegram environment variables are not configured");
    return json({ ok: false, message: "Сервис отправки временно не настроен." }, 500);
  }

  const submittedAt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date());

  const pageUrl = request.headers.get("referer") || "";
  const lines = ["<b>🟡 Новая заявка с сайта Studio Luxe</b>", ""];

  addLine(lines, "Форма", SOURCE_LABELS[source] || source || "Не определена");
  addLine(lines, "Имя", name);
  addLine(lines, "Контакт", contact);
  addLine(lines, "Город / страна", city);
  addLine(lines, "Формат", FORMAT_LABELS[workFormat] || workFormat);
  addLine(lines, "Оборудование", EQUIPMENT_LABELS[equipment] || equipment);
  addLine(lines, "Удобное время", contactTime);
  addLine(lines, "Комментарий", comment);
  lines.push("", "<b>18+:</b> подтверждено", "<b>Согласие:</b> получено");
  addLine(lines, "Страница", pageUrl);
  addLine(lines, "Время", `${submittedAt} МСК`);

  let telegramResponse;
  try {
    telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join("\n"),
        parse_mode: "HTML",
        protect_content: true,
        link_preview_options: { is_disabled: true }
      }),
      signal: AbortSignal.timeout(8_000)
    });
  } catch (error) {
    console.error("Telegram request failed", error?.name || "unknown_error");
    return json({ ok: false, message: "Не удалось отправить заявку. Попробуйте ещё раз немного позже." }, 502);
  }

  const telegramResult = await telegramResponse.json().catch(() => ({}));
  if (!telegramResponse.ok || telegramResult.ok !== true) {
    console.error("Telegram API rejected the request", telegramResponse.status, telegramResult.description || "unknown_error");
    return json({ ok: false, message: "Не удалось отправить заявку. Попробуйте ещё раз немного позже." }, 502);
  }

  return json({
    ok: true,
    message: "Заявка отправлена. Агент свяжется с вами указанным способом."
  });
}

export function GET() {
  return json(
    { ok: false, message: "Используйте форму на сайте." },
    405,
    { Allow: "POST" }
  );
}
