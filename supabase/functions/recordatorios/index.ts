// Recordatorios de Mi Semana por notificación push, aunque la app esté cerrada.
// La llaman los horarios de pg_cron (con el encabezado x-cron-secret) y la app,
// al activar las notificaciones, para mandar una de prueba (con tu sesión).
//
// Secretos necesarios en Supabase (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:tu-correo), CRON_SECRET
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Igual que la app: el día cambia a las 4 a. m., hora del centro de México.
function hoyLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Date.now() - 4 * 3600_000));
}
const weekday = (k: string) => (new Date(`${k}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = lunes
const addDays = (k: string, n: number) => {
  const d = new Date(`${k}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Msg = { title: string; body: string; tag: string };
const HABITOS: Record<string, string> = { Ejercicio: "hacer ejercicio", Cuidado: "desmaquillarte" };

// Hábitos de hoy sin marcar (incluye el que se arrastra de ayer si hoy también toca).
async function mensajeNoche(userId: string, hoy: string, segundo: boolean): Promise<Msg | null> {
  const { data } = await db.from("tareas").select("sub, dia, repite")
    .eq("user_id", userId).eq("area", "casa").in("sub", Object.keys(HABITOS)).eq("hecho", false).lte("dia", hoy);
  const faltan = (data ?? []).filter((t) => t.dia === hoy || (t.repite ?? []).includes(weekday(hoy)));
  if (!faltan.length) return null;
  const lista = [...new Set(faltan.map((t) => HABITOS[t.sub]))];
  const texto = lista.join(" y ");
  return segundo
    ? { title: "Antes de dormir 😴", body: `Todavía te falta ${texto}. Versión mínima: 1 minuto y a la cama.`, tag: "noche" }
    : { title: "Rutina de noche 🌙", body: `Te falta ${texto}. Aunque sea poquito, cuenta.`, tag: "noche" };
}

// Obligatorios de hoy (y atrasados) y de mañana.
async function mensajeManana(userId: string, hoy: string): Promise<Msg | null> {
  const manana = addDays(hoy, 1);
  const { data } = await db.from("tareas").select("titulo, dia")
    .eq("user_id", userId).eq("obligatorio", true).eq("hecho", false).lte("dia", manana);
  const items = data ?? [];
  if (!items.length) return null;
  const partes = [];
  const deHoy = items.filter((t) => t.dia <= hoy).map((t) => t.titulo);
  const deManana = items.filter((t) => t.dia === manana).map((t) => t.titulo);
  if (deHoy.length) partes.push(`Hoy: ${deHoy.join(", ")}`);
  if (deManana.length) partes.push(`Mañana: ${deManana.join(", ")}`);
  return { title: "⚑ Obligatorios", body: partes.join(" · "), tag: "manana" };
}

async function enviar(userId: string, msg: Msg): Promise<number> {
  const { data: subs } = await db.from("push_subs").select("endpoint, p256dh, auth").eq("user_id", userId);
  let enviados = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg));
      enviados++;
    } catch (e) {
      // 404/410: ese dispositivo ya no tiene la suscripción; se borra.
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint);
      else console.error("push", code, (e as Error).message);
    }
  }
  return enviados;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const { tipo = "noche", segundo = false } = await req.json().catch(() => ({}));

  if (tipo === "prueba") {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const { data } = await db.auth.getUser(jwt);
    if (!data.user) return json({ error: "Inicia sesión" }, 401);
    const enviados = await enviar(data.user.id, { title: "¡Listo! 🐾", body: "Así se verán tus recordatorios de Mi Semana.", tag: "prueba" });
    return json({ enviados });
  }

  if (req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "No autorizado" }, 401);
  const hoy = hoyLocal();
  const { data: subs } = await db.from("push_subs").select("user_id");
  let enviados = 0;
  for (const userId of new Set((subs ?? []).map((s) => s.user_id as string))) {
    const msg = tipo === "manana" ? await mensajeManana(userId, hoy) : await mensajeNoche(userId, hoy, segundo);
    if (msg) enviados += await enviar(userId, msg);
  }
  return json({ tipo, hoy, enviados });
});
