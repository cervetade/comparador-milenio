# Comparador Milenio

Página web para subir listas de precios (PDF) de distribuidores y comparar cuál da el precio más bajo por producto. Pensada para abrirse desde el celu, sin cuenta de Claude.

## Cómo está armado

- **`public/`** — el frontend (una sola página HTML). Para PDFs, extrae el texto en el propio navegador (con pdf.js); las fotos/imágenes se mandan directo a la IA. Se pueden subir varios archivos (PDFs y/o fotos) para un mismo distribuidor.
- **`functions/api/`** — el backend, corre como Cloudflare Pages Functions (sin servidor propio que mantener):
  - `extract.js`: recibe un fragmento de texto O una imagen, le pide a Gemini que identifique productos y su precio de costo (nunca precios "sugeridos" de reventa), devuelve JSON.
  - `distributors.js`: guarda/lee/borra los distribuidores en Supabase.
- Las claves (Gemini, Supabase) viven como variables de entorno en Cloudflare, nunca en el código ni en el navegador.

## Puesta en marcha (una sola vez)

### 1. Base de datos (Supabase — gratis, no pide tarjeta)

1. Creá una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo.
2. En el editor SQL del proyecto, corré esto:

```sql
create table distributors (
  slug text primary key,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  item_count int not null default 0,
  updated_at timestamptz not null default now()
);

alter table distributors enable row level security;
-- sin políticas públicas: solo la service role key (que usa el backend) puede leer/escribir.
```

3. Andá a **Project Settings → API** y copiá:
   - `Project URL` → esto va a ser `SUPABASE_URL`
   - `service_role` key (la secreta, no la `anon`) → esto va a ser `SUPABASE_SERVICE_KEY`

### 2. IA (Gemini — tier gratis para arrancar)

1. Andá a [aistudio.google.com/apikey](https://aistudio.google.com/apikey) y generá una API key.
2. Guardala — va a ser `GEMINI_API_KEY`.
3. Ojo: en el tier gratis, Google puede usar lo que se manda para mejorar sus productos. Para datos sensibles de verdad, más adelante conviene pasar a un tier pago (ver su doc de billing).

### 3. Hosting (Cloudflare Pages — gratis, sin sleep)

**Opción A — conectado a GitHub (recomendado, se actualiza solo con cada cambio):**

1. Subí esta carpeta a un repo de GitHub.
2. En [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Pages → Connect to Git**, elegí el repo.
3. Build settings: no hace falta build command, el directorio de salida es `public`.
4. En **Settings → Environment variables**, agregá las 3 variables de arriba (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`) como *secret*.
5. Deploy. Cloudflare te da una URL tipo `comparador-milenio.pages.dev` — esa es la que abre tu jefe desde el celu.

**Opción B — subida directa (sin GitHub), con Wrangler CLI:**

```bash
npm install -g wrangler
wrangler login
wrangler pages deploy public --project-name comparador-milenio
wrangler pages secret put SUPABASE_URL --project-name comparador-milenio
wrangler pages secret put SUPABASE_SERVICE_KEY --project-name comparador-milenio
wrangler pages secret put GEMINI_API_KEY --project-name comparador-milenio
```

## Límites conocidos (para cuando esto crezca)

- **Todos ven todo**: hoy es una sola tabla compartida entre quien sea que abra la página. Si más adelante distintos negocios necesitan ver solo sus propios distribuidores, hay que sumar login (Supabase Auth ya viene con esto listo) y una columna que identifique al dueño de cada distribuidor.
- **Supabase free**: se "pausa" si pasa una semana entera sin actividad (no se pierden datos, se reactiva en un click).
- **Gemini free**: límites de uso bajos y variables — si esto se usa mucho, va a hacer falta pasar a un tier pago.
- **Cloudflare Functions free**: 100.000 pedidos gratis por día — de sobra para uso personal/de equipo chico.
