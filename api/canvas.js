import { BlobNotFoundError, get, put } from "@vercel/blob";

const PATH = "canvas.json";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const data = await readCanvas();
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ data });
      return;
    }
    if (req.method === "POST") {
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        res.status(400).json({ error: "Нужен объект канваса" });
        return;
      }
      const text = JSON.stringify(body);
      if (text.length > 200000) {
        res.status(413).json({ error: "Слишком большой канвас" });
        return;
      }
      await put(PATH, text, {
        access: "private",
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: "application/json",
      });
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ ok: true });
      return;
    }
    res.setHeader("Allow", "GET, POST");
    res.status(405).end();
  } catch (error) {
    res.status(500).json({ error: "Не удалось сохранить канвас" });
  }
}

async function readCanvas() {
  try {
    const result = await get(PATH, { access: "private" });
    if (!result) return null;
    const text = await new Response(result.stream).text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    if (error && (error.statusCode === 404 || error.name === "BlobNotFoundError")) return null;
    throw error;
  }
}
