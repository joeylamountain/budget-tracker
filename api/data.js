import { Redis } from "@upstash/redis";
 
const redis = Redis.fromEnv();
 
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
 
  if (req.method === "OPTIONS") return res.status(200).end();
 
  const { action, key, value } = req.method === "POST" ? req.body : req.query;
 
  try {
    if (action === "get") {
      const data = await redis.get(key);
      return res.status(200).json({ data });
    }
    if (action === "set") {
      await redis.set(key, value);
      return res.status(200).json({ ok: true });
    }
    if (action === "keys") {
      const keys = await redis.keys(`${key}*`);
      return res.status(200).json({ keys });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
