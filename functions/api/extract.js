// POST /api/extract
// body: { text: string }                          -> un fragmento de texto (ya extraído del PDF en el navegador), o
// body: { imageBase64: string, mimeType: string }  -> una foto/imagen de una lista de precios
// devuelve: { items: [{d, p}] }  o  { error: "..." }
//
// La clave de Gemini vive SOLO acá (variable de entorno en Cloudflare Pages),
// nunca se manda al navegador.

const PROMPT_HEADER = `Sos un extractor de datos para listas de precios de distribuidores (kiosco / almacen / mayorista).
Te paso un fragmento de una lista de precios (texto extraido de un PDF, o una foto/imagen de una lista). Identifica cada articulo/producto individual con su precio de venta final.

Reglas:
- El precio que interesa es SIEMPRE el precio de COSTO que paga quien compra (el comerciante), no un precio sugerido de reventa al publico ni un margen agregado. Si una columna dice "sugerido", "PVP", "precio de venta sugerido", "margen" o similar, IGNORALA por completo: no es el precio a extraer.
- Si hay precio por pack/caja y precio por unidad, usa el precio UNITARIO (por unidad individual), salvo que el producto solo se venda por pack entero sin desglose unitario, en cuyo caso usa el precio del pack.
- Si la fila tiene columnas de neto, IVA y precio final, usa el PRECIO FINAL (el que ya incluye impuestos), nunca el neto.
- Ignora encabezados de tabla, nombres de categorias o rubros sueltos, subtotales, totales, numeros de pagina y cualquier linea que no sea un producto con precio.
- No inventes productos que no esten en el texto. Si un precio no esta claro o no sabes cual columna es el costo real, no incluyas ese producto.
- Los precios pueden venir en distintos formatos: argentino (punto de miles, coma decimal: "4.400,00") o angloamericano (coma de miles, punto decimal: "4,400.00"). Fijate cual se usa en el texto y convertilos siempre a numero plano con punto decimal (ejemplo: "4.400,00" o "4,400.00" -> 4400).
- En la descripcion del producto incluí marca, nombre y presentacion/tamano si estan (ej: "Chocolate Sugus Plegado Surt. x 700 Grs.").

Devolve SOLO un array JSON con objetos {"producto": string, "precio": number}. Si no hay ningun producto valido, devolve [].`;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // base64 de una sola imagen; de sobra para una foto de celular

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  if (!env.GEMINI_API_KEY) {
    return json({ error: "server_not_configured" }, 500);
  }

  let userPart;
  if (body?.imageBase64) {
    const imageBase64 = String(body.imageBase64);
    const mimeType = String(body.mimeType || "image/jpeg");
    if (!imageBase64) return json({ items: [] });
    if (imageBase64.length > MAX_IMAGE_BYTES) return json({ error: "image_too_large" }, 400);
    if (!/^image\//.test(mimeType)) return json({ error: "bad_request" }, 400);
    userPart = [
      { text: PROMPT_HEADER + "\n\nEsto es una foto/imagen de una lista de precios:" },
      { inlineData: { mimeType, data: imageBase64 } }
    ];
  } else {
    const text = String(body?.text || "").slice(0, 20000);
    if (!text.trim()) return json({ items: [] });
    userPart = [{ text: PROMPT_HEADER + "\n\nTexto:\n<<<\n" + text + "\n>>>" }];
  }

  const model = "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: userPart }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                producto: { type: "STRING" },
                precio: { type: "NUMBER" }
              },
              required: ["producto", "precio"]
            }
          }
        }
      })
    });
  } catch (e) {
    return json({ error: "upstream_unreachable" }, 502);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    return json({ error: "upstream_error", detail: errText.slice(0, 300) }, 502);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    return json({ error: "bad_upstream_json" }, 502);
  }

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) return json({ items: [] });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json", raw: raw.slice(0, 300) }, 502);
  }
  if (!Array.isArray(parsed)) return json({ items: [] });

  const items = parsed
    .map(o => ({ d: String(o?.producto || "").trim(), p: Number(o?.precio) }))
    .filter(o => o.d && Number.isFinite(o.p) && o.p > 0);

  return json({ items });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
