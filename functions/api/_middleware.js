// Puerta de acceso simple con clave compartida para TODOS los endpoints /api/*.
// - Si env.APP_ACCESS_KEY NO está configurada, la puerta queda ABIERTA (no rompe nada
//   antes de configurarla en Cloudflare / .dev.vars).
// - Si está configurada, cada request debe traer el header "x-app-key" con ese valor.
// La clave vive solo en el servidor; el navegador la guarda en localStorage y la manda por header.
export async function onRequest(context) {
  const { request, env, next } = context;
  const required = env.APP_ACCESS_KEY;
  if (required) {
    const provided = request.headers.get("x-app-key") || "";
    if (provided !== required) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }
  }
  return next();
}
