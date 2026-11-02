-- Columnas que se agregaron a public.tareas después de crearla (correr en Supabase → SQL Editor).
-- "Tus 3 de hoy": el día en que elegiste la tarea como prioridad.
alter table public.tareas add column if not exists foco date;
-- Checklist de cada tarea: [{ "id": "...", "texto": "...", "hecho": false }]
alter table public.tareas add column if not exists checklist jsonb not null default '[]'::jsonb;
