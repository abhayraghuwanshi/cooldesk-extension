// // worker.js — Ready to Deploy Cloudflare Worker
// // Categorizes a URL based on predefined domain lists

// //-----------------------------------------------------
// //  Category Mapping Data (Full Dataset)
// //-----------------------------------------------------
// // worker.js — Smart Categorization (Embeddings + Llama fallback)
// // Bindings required in wrangler.toml:
// // env.AI (Cloudflare AI), KV: WORKSPACES, KV: EMBEDDINGS

// const SIM_THRESHOLD = 0.75;     // similarity cutoff to accept category from embeddings
// const TOP_K = 3;               // number of nearest neighbors to inspect

// // Allowed categories (consistent with your mapping)
// const ALLOWED_CATEGORIES = [
//     "finance", "health", "education", "sports", "social", "travel", "reading",
//     "entertainment", "shopping", "food", "developer", "news", "tools", "unknown"
// ];

// // --- Utilities ---
// function jsonResponse(data, status = 200) {
//     return new Response(JSON.stringify(data, null, 2), {
//         status,
//         headers: { "Content-Type": "application/json" }
//     });
// }

// function nowISO() { return (new Date()).toISOString(); }

// function extractDomain(url) {
//     try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); }
//     catch { return url.replace(/^www\./, "").toLowerCase(); }
// }

// function cosine(a, b) {
//     // a and b are arrays of numbers
//     let dot = 0, na = 0, nb = 0;
//     for (let i = 0; i < a.length; i++) {
//         dot += a[i] * b[i];
//         na += a[i] * a[i];
//         nb += b[i] * b[i];
//     }
//     if (na === 0 || nb === 0) return 0;
//     return dot / (Math.sqrt(na) * Math.sqrt(nb));
// }

// function parseEmbeddingResponse(aiResp) {
//     if (!aiResp) return null;

//     // 1) CF bge models: { shape: [1, 768], data: [[...]] }
//     // data is an array containing the embedding array
//     if (aiResp.data && Array.isArray(aiResp.data) && Array.isArray(aiResp.data[0])) {
//         return aiResp.data[0]; // <-- This is the fix
//     }

//     // 2) OpenAI style: { data: [{ embedding: [...] }] }
//     if (aiResp.data && aiResp.data[0] && Array.isArray(aiResp.data[0].embedding)) {
//         return aiResp.data[0].embedding;
//     }

//     // 3) Generic { embedding: [...] }
//     if (Array.isArray(aiResp.embedding)) {
//         return aiResp.embedding;
//     }

//     // 4) resp.response_text might be JSON string
//     if (typeof aiResp.response_text === "string") {
//         try {
//             const parsed = JSON.parse(aiResp.response_text);
//             if (Array.isArray(parsed)) return parsed;
//             if (parsed.embedding && Array.isArray(parsed.embedding)) return parsed.embedding;
//         } catch { }
//     }

//     // 5) Last-ditch effort (skipping 'shape')
//     for (const k of Object.keys(aiResp)) {
//         if (k !== 'shape' && Array.isArray(aiResp[k]) && typeof aiResp[k][0] === 'number') {
//             return aiResp[k];
//         }
//     }

//     return null; // Failed to parse
// }

// // --- AI helpers (use env.AI wrapper) ---
// async function getEmbedding(env, text) {
//     // call embedding model
//     try {
//         const result = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: text });
//         console.log(result)
//         const embedding = parseEmbeddingResponse(result);

//         if (!embedding) throw new Error("Embedding parse failed");
//         return { embedding, raw: result };
//     } catch (err) {
//         // bubble up
//         throw new Error("Embedding error: " + (err?.message || err));
//     }
// }

// async function classifyWithLlama(env, url, extraContext = "") {
//     const prompt = `Classify the website "${url}" into exactly one of: ${ALLOWED_CATEGORIES.join(", ")}.
// Return ONLY a JSON object (no explanation), with keys:
// {
//   "category": "<one of the allowed categories>",
//   "description": "<one-sentence description of the site>",
//   "confidence": 0.0
// }
// Be concise. ${extraContext}
// `;
//     try {
//         const aiResp = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
//             messages: [
//                 { role: "system", content: "You are a strict website classifier. Respond only with JSON." },
//                 { role: "user", content: prompt }
//             ],
//             // you can pass temperature / max tokens if supported by your env
//         });

//         console.log("Response from ai", aiResp);

//         // try to safely parse response_text or message.content
//         const text = aiResp?.response || aiResp?.response_text || aiResp?.message?.content || "";
//         let parsed;
//         try { parsed = JSON.parse(text); }
//         catch {
//             // attempt to extract JSON substring
//             const m = text.match(/\{[\s\S]*\}/);
//             if (m) {
//                 try { parsed = JSON.parse(m[0]); }
//                 catch { parsed = null; }
//             }
//         }

//         if (!parsed || !ALLOWED_CATEGORIES.includes(parsed.category)) {
//             // fallback minimal
//             return { category: parsed?.category ?? "unknown", description: parsed?.description ?? "", confidence: parsed?.confidence ?? 0, raw: text };
//         }

//         // normalize confidence
//         parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
//         return { category: parsed.category, description: parsed.description || "", confidence: parsed.confidence, raw: text };
//     } catch (err) {
//         return { category: "unknown", description: "", confidence: 0, raw: String(err) };
//     }
// }

// // --- KV helpers (WORKSPACES, EMBEDDINGS) ---
// // Workspace document stored at WORKSPACES.put(id, JSON.stringify(obj))
// // Embedding stored at EMBEDDINGS.put(id, JSON.stringify({embedding, url, category, createdAt}))
// // We will use domain as id by default but you can use hashed url if more specific

// async function saveWorkspace(env, id, workspace) {
//     await env.WORKSPACES.put(id, JSON.stringify(workspace));
// }

// async function getWorkspace(env, id) {
//     const raw = await env.WORKSPACES.get(id);
//     return raw ? JSON.parse(raw) : null;
// }

// async function saveEmbeddingKV(env, id, embeddingObj) {
//     await env.EMBEDDINGS.put(id, JSON.stringify(embeddingObj));
// }

// async function getAllEmbeddings(env) {
//     // KV does not support listing all values conveniently in all accounts;
//     // you can use env.EMBEDDINGS.list() if available. We'll attempt to list.
//     try {
//         const list = await env.EMBEDDINGS.list({ limit: 1000 }); // caution: only up to 1000
//         const keys = list.keys || [];
//         const items = [];
//         for (const k of keys) {
//             const v = await env.EMBEDDINGS.get(k.name);
//             if (v) {
//                 try { items.push(JSON.parse(v)); } catch { }
//             }
//         }
//         return items;
//     } catch (err) {
//         // if not available or huge scale, you should use a proper vector DB
//         return [];
//     }
// }

// // compute nearest neighbors (simple linear scan)
// async function findNearest(env, emb) {
//     const items = await getAllEmbeddings(env);
//     if (!items.length) return [];
//     const scored = items.map(it => {
//         const sim = cosine(emb, it.embedding || []);
//         return { id: it.id || it.url || "", url: it.url, category: it.category, sim };
//     }).sort((a, b) => b.sim - a.sim);
//     return scored.slice(0, TOP_K);
// }


// async function categorizeUrl(env, body) {
//     const { url, title, text, description: bodyDesc } = body;

//     // 1. Compute embedding
//     const textForEmbedding = (title ? title + " " : "") + (text ? text + " " : "") + url;
//     const embResp = await getEmbedding(env, textForEmbedding);
//     const emb = embResp.embedding;

//     // 2. Find nearest neighbors
//     const neighbors = await findNearest(env, emb);

//     // 3. Determine category from neighbors
//     let category = "unknown";
//     let confidence = 0;
//     let detectedBy = "embeddings";
//     let description = bodyDesc || ""; // Use provided description if available

//     if (neighbors.length) {
//         const top = neighbors[0];
//         if (top.sim >= SIM_THRESHOLD) {
//             category = top.category || "unknown";
//             confidence = top.sim;
//         } else {
//             // Weighted vote by sim
//             const grouped = {};
//             for (const n of neighbors) {
//                 grouped[n.category] = Math.max(grouped[n.category] || 0, n.sim);
//             }
//             const sortedCats = Object.keys(grouped).sort((a, b) => grouped[b] - grouped[a]);
//             if (sortedCats.length && grouped[sortedCats[0]] >= SIM_THRESHOLD * 0.8) {
//                 category = sortedCats[0];
//                 confidence = grouped[sortedCats[0]];
//             } else {
//                 category = "unknown";
//             }
//         }
//     }

//     // 4. If unknown or low confidence -> call Llama
//     if (category === "unknown" || confidence < SIM_THRESHOLD) {
//         detectedBy = "llama";
//         const ai = await classifyWithLlama(env, url, text ? `Context: ${text}` : "");
//         category = ALLOWED_CATEGORIES.includes(ai.category) ? ai.category : "unknown";
//         confidence = Math.max(confidence, ai.confidence || 0); // Keep higher confidence
//         description = description || ai.description || ""; // Use Llama's desc if we don't have one
//     }

//     // 5. Prepare data objects
//     const createdAt = nowISO();
//     const domain = extractDomain(url);
//     const id = domain; // Use domain as the unique ID

//     const embeddingObj = { id, url, category, embedding: emb, createdAt };
//     const workspace = {
//         id,
//         url,
//         title: title || null,
//         category,
//         description,
//         confidence,
//         detectedBy,
//         createdAt
//     };

//     return { workspace, embeddingObj, neighbors };
// }
// // --- HTTP Handlers ---

// export default {
//     async fetch(request, env) {
//         const url = new URL(request.url);
//         try {
//             if (request.method === "OPTIONS") return new Response(null, { status: 204 });

//             if (request.method === "POST" && url.pathname === "/ingest") {
//                 // ingest and persist workspace
//                 const body = await request.json().catch(() => null);
//                 if (!body?.url) return jsonResponse({ error: "Missing url" }, 422);

//                 const domain = extractDomain(body.url);
//                 const id = domain; // you can change to hashed url if you need multiple per domain

//                 // 1) skip if already present (optional)
//                 const existing = await getWorkspace(env, id);
//                 if (existing) {
//                     return jsonResponse({ message: "already exists", workspace: existing }, 200);
//                 }

//                 // 2) compute embedding for domain + optional title/description
//                 const textForEmbedding = (body.title ? body.title + " " : "") + (body.text ? body.text + " " : "") + body.url;
//                 const embResp = await getEmbedding(env, textForEmbedding);
//                 const emb = embResp.embedding;

//                 // 3) find nearest neighbors
//                 const neighbors = await findNearest(env, emb);

//                 // determine category from neighbors
//                 let category = "unknown";
//                 let confidence = 0;
//                 if (neighbors.length) {
//                     // weighted vote by sim
//                     const top = neighbors[0];
//                     if (top.sim >= SIM_THRESHOLD) {
//                         category = top.category || "unknown";
//                         confidence = top.sim;
//                     } else {
//                         // compute average sim for a category in neighbors
//                         const grouped = {};
//                         for (const n of neighbors) {
//                             grouped[n.category] = Math.max(grouped[n.category] || 0, n.sim);
//                         }
//                         // choose top category by max sim
//                         const sortedCats = Object.keys(grouped).sort((a, b) => grouped[b] - grouped[a]);
//                         if (sortedCats.length && grouped[sortedCats[0]] >= SIM_THRESHOLD * 0.8) {
//                             category = sortedCats[0];
//                             confidence = grouped[sortedCats[0]];
//                         } else {
//                             category = "unknown";
//                         }
//                     }
//                 }

//                 // 4) if unknown or low confidence -> call Llama
//                 let detectedBy = "embeddings";
//                 let description = body.description || "";
//                 if (category === "unknown" || confidence < SIM_THRESHOLD) {
//                     detectedBy = "llama";
//                     const ai = await classifyWithLlama(env, body.url, body.text ? `Context: ${body.text}` : "");
//                     category = ALLOWED_CATEGORIES.includes(ai.category) ? ai.category : "unknown";
//                     confidence = Math.max(confidence, ai.confidence || 0);
//                     description = description || ai.description || "";
//                 }

//                 // 5) save embedding and workspace
//                 const createdAt = nowISO();
//                 const embeddingObj = { id, url: body.url, category, embedding: emb, createdAt };
//                 await saveEmbeddingKV(env, id, embeddingObj);
//                 const workspace = {
//                     id,
//                     url: body.url,
//                     title: body.title || null,
//                     category,
//                     description,
//                     confidence,
//                     detectedBy,
//                     createdAt
//                 };
//                 await saveWorkspace(env, id, workspace);

//                 return jsonResponse({ workspace, neighbors });
//             }

//             if (request.method === "POST" && url.pathname === "/classify") {
//                 // classify but do not persist
//                 const body = await request.json().catch(() => null);
//                 if (!body?.url) return jsonResponse({ error: "Missing url" }, 422);

//                 const textForEmbedding = (body.title ? body.title + " " : "") + (body.text ? body.text + " " : "") + body.url;
//                 const embResp = await getEmbedding(env, textForEmbedding);
//                 const emb = embResp.embedding;
//                 const neighbors = await findNearest(env, emb);

//                 let category = "unknown";
//                 let confidence = 0;
//                 if (neighbors.length && neighbors[0].sim >= SIM_THRESHOLD) {
//                     category = neighbors[0].category;
//                     confidence = neighbors[0].sim;
//                 }

//                 let detectedBy = "embeddings";
//                 let description = "";

//                 if (category === "unknown" || confidence < SIM_THRESHOLD) {
//                     detectedBy = "llama";
//                     const ai = await classifyWithLlama(env, body.url, body.text ? `Context: ${body.text}` : "");
//                     category = ALLOWED_CATEGORIES.includes(ai.category) ? ai.category : "unknown";
//                     confidence = ai.confidence || confidence;
//                     description = ai.description || "";
//                 }

//                 return jsonResponse({
//                     url: body.url,
//                     category,
//                     confidence,
//                     detectedBy,
//                     neighbors,
//                     description
//                 });
//             }
//             if (request.method === "POST" && url.pathname === "/api/categorize") {
//                 const body = await request.json().catch(() => null);
//                 if (!body?.url) return jsonResponse({ error: "Missing url" }, 422);

//                 const shouldSave = url.searchParams.get("save") === 'true';
//                 const domain = extractDomain(body.url);
//                 const id = domain;

//                 // 1. Check if it already exists
//                 const existing = await getWorkspace(env, id);
//                 if (existing) {
//                     // It's cached. Just return it.
//                     // This prevents re-running AI on every visit.
//                     return jsonResponse({
//                         message: "retrieved from cache",
//                         workspace: existing,
//                         source: "cache"
//                     }, 200);
//                 }

//                 // 2. Not in cache, so we must run the full categorization
//                 const { workspace, embeddingObj, neighbors } = await categorizeUrl(env, body);

//                 // 3. Now, decide whether to save the new result
//                 if (shouldSave) {
//                     // Save both the embedding vector and the workspace metadata
//                     await saveEmbeddingKV(env, workspace.id, embeddingObj);
//                     await saveWorkspace(env, workspace.id, workspace);

//                     return jsonResponse({
//                         message: "classified and saved",
//                         workspace,
//                         neighbors
//                     }, 201); // 201 Created
//                 } else {
//                     // Just return the classification without saving
//                     return jsonResponse({
//                         message: "classified (not saved)",
//                         workspace,
//                         neighbors
//                     }, 200);
//                 }
//             }
//             if (request.method === "GET" && url.pathname === "/workspace") {
//                 const id = url.searchParams.get("id");
//                 if (!id) return jsonResponse({ error: "Missing id param" }, 422);
//                 const ws = await getWorkspace(env, id);
//                 if (!ws) return jsonResponse({ error: "not found" }, 404);
//                 return jsonResponse({ workspace: ws });
//             }
//             if (request.method === "POST" && url.pathname === "/api/register-key") {
//                 try {
//                     // 1. Verify authentication
//                     const authHeader = request.headers.get('Authorization');
//                     if (!authHeader?.startsWith('Bearer ')) {
//                         return jsonResponse({ error: "Missing or invalid authorization" }, 401);
//                     }
//                     const idToken = authHeader.split(' ')[1];

//                     // 2. Verify Google ID token
//                     const user = await verifyGoogleToken(idToken);
//                     if (!user) {
//                         return jsonResponse({ error: "Invalid or expired token" }, 401);
//                     }

//                     // 3. Parse request body
//                     const body = await request.json();
//                     if (!body.keyId || !body.publicKey) {
//                         return jsonResponse({ error: "Missing required fields" }, 400);
//                     }

//                     // 4. Store the key in KV storage
//                     const key = `key:${user.uid}:${body.keyId}`;
//                     await env.KEYS.put(key, JSON.stringify({
//                         userId: user.uid,
//                         keyId: body.keyId,
//                         publicKey: body.publicKey,
//                         email: user.email,
//                         createdAt: new Date().toISOString(),
//                         lastUsed: null
//                     }));

//                     return jsonResponse({
//                         success: true,
//                         keyId: body.keyId,
//                         userId: user.uid
//                     });

//                 } catch (error) {
//                     console.error("Key registration error:", error);
//                     return jsonResponse({ error: "Internal server error" }, 500);
//                 }
//             }

//             return jsonResponse({ message: "OK. Use POST /ingest or POST /classify or GET /workspace?id=..." });
//         } catch (err) {
//             return jsonResponse({ error: err.message || String(err) }, 500);
//         }
//     }
// };


// // import { OAuth2Client } from 'google-auth-library';

// // Initialize the Google OAuth2 client
// const GOOGLE_CLIENT_ID = '256165123494-q5n57e6750sik1f723vj5rb8i28fmmue'; // Same as in your extension's manifest
// async function verifyGoogleToken(idToken) {
//     try {
//         // Get Google's public keys
//         const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
//         const jwks = await response.json();

//         // Decode the token header to get the key ID
//         const tokenParts = idToken.split('.');
//         if (tokenParts.length !== 3) {
//             throw new Error('Invalid token format');
//         }

//         const header = JSON.parse(atob(tokenParts[0].replace(/-/g, '+').replace(/_/g, '/')));
//         const payload = JSON.parse(atob(tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')));

//         // Check if token is expired
//         const now = Math.floor(Date.now() / 1000);
//         if (payload.exp < now) {
//             console.log('Token expired');
//             return null;
//         }

//         // Find the right key
//         const key = jwks.keys.find(k => k.kid === header.kid);
//         if (!key) {
//             throw new Error('No matching key found');
//         }

//         // Import the key
//         const cryptoKey = await crypto.subtle.importKey(
//             'jwk',
//             key,
//             {
//                 name: 'RSASSA-PKCS1-v1_5',
//                 hash: 'SHA-256'
//             },
//             false,
//             ['verify']
//         );

//         // Prepare the data for verification
//         const data = new TextEncoder().encode(`${tokenParts[0]}.${tokenParts[1]}`);
//         const signature = new Uint8Array(
//             Array.from(tokenParts[2].replace(/-/g, '+').replace(/_/g, '/'))
//                 .map(c => c.charCodeAt(0))
//         );

//         // Verify the signature
//         const isValid = await crypto.subtle.verify(
//             'RSASSA-PKCS1-v1_5',
//             cryptoKey,
//             signature,
//             data
//         );

//         if (!isValid) {
//             throw new Error('Invalid signature');
//         }

//         // Verify the token claims
//         if (payload.aud !== '256165123494-q5n57e6750sik1f723vj5rb8i28fmmue.apps.googleusercontent.com') {
//             throw new Error('Invalid audience');
//         }

//         if (payload.iss !== 'https://accounts.google.com' &&
//             payload.iss !== 'accounts.google.com') {
//             throw new Error('Invalid issuer');
//         }

//         // Return the user info
//         return {
//             uid: payload.sub,
//             email: payload.email,
//             emailVerified: payload.email_verified,
//             name: payload.name,
//             picture: payload.picture
//         };

//     } catch (error) {
//         console.error('Error verifying Google token:', error);
//         return null;
//     }
// }