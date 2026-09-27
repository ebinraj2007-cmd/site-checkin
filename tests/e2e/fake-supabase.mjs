// A stand-in for Supabase Storage's REST API (bucket create, upload, signed URLs),
// so the e2e suite can run the Supabase storage path without a Supabase project.
import http from "node:http";

const PORT = Number(process.env.FAKE_SUPABASE_PORT || 3299);
const KEY = process.env.FAKE_SUPABASE_KEY || "eyJfake.service.role";
const files = new Map();
const buckets = new Set();

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://fake");
    if (url.pathname === "/__stats") return send(res, 200, { files: files.size, buckets: [...buckets] });

    // Signed download: no key needed, the token is the permission.
    let m = url.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);
    if (m && req.method === "GET") {
      const file = files.get(`${m[1]}/${m[2]}`);
      if (!file || url.searchParams.get("token") !== `tok-${m[2]}`) return send(res, 400, { error: "InvalidJWT" });
      return send(res, 200, file.data, file.type);
    }

    const auth = req.headers.authorization === `Bearer ${KEY}` && req.headers.apikey === KEY;
    if (!auth) return send(res, 403, { statusCode: "403", error: "Unauthorized", message: "bad key" });

    if (req.method === "POST" && url.pathname === "/storage/v1/bucket") {
      const { id, public: isPublic } = JSON.parse(body.toString());
      if (isPublic !== false) return send(res, 400, { error: "bucket must be private" });
      if (buckets.has(id)) return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      buckets.add(id);
      return send(res, 200, { name: id });
    }
    if (m && req.method === "POST") {
      if (!files.has(`${m[1]}/${m[2]}`)) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      const { expiresIn } = JSON.parse(body.toString());
      if (!(expiresIn > 0)) return send(res, 400, { error: "expiresIn required" });
      return send(res, 200, { signedURL: `/object/sign/${m[1]}/${m[2]}?token=tok-${m[2]}` });
    }
    m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (m && req.method === "POST") {
      if (!buckets.has(m[1])) return send(res, 400, { statusCode: "404", error: "Bucket not found" });
      if (files.has(`${m[1]}/${m[2]}`)) return send(res, 400, { statusCode: "409", error: "Duplicate" });
      files.set(`${m[1]}/${m[2]}`, { data: body, type: req.headers["content-type"] });
      return send(res, 200, { Key: `${m[1]}/${m[2]}` });
    }
    send(res, 404, { error: "unknown route" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`fake supabase storage on ${PORT}`));
