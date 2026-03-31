# Prompt para Claude Code — copiar y pegar EXACTO

## Paso 1: Instalar Claude Code (si no lo tienes)

Abre tu terminal (Mac: Terminal, Windows: PowerShell) y ejecuta:

```bash
npm install -g @anthropic-ai/claude-code
```

Necesitas Node.js 18+. Si no lo tienes: https://nodejs.org

## Paso 2: Crear carpeta y poner el CLAUDE.md

```bash
mkdir atiende-ai
cd atiende-ai
```

Copia el archivo CLAUDE.md que te di dentro de esta carpeta.

## Paso 3: Abrir Claude Code

```bash
claude
```

Se abre Claude Code en tu terminal. Ahora pega ESTE PROMPT exacto:

---

## EL PROMPT (copiar TODO desde aquí):

```
Lee el archivo CLAUDE.md en este directorio. Es la guía completa para construir un SaaS de agentes AI para WhatsApp y voz para negocios mexicanos.

INSTRUCCIONES:
1. Lee CLAUDE.md completo primero — NO empieces a crear archivos sin leerlo
2. Ejecuta las fases EN ORDEN (0 → 10)
3. Cada archivo tiene su path exacto y código completo — copiar tal cual
4. Después de cada fase, corre `npm run build` para verificar que compila
5. Si hay un error de compilación, arréglalo ANTES de pasar a la siguiente fase

IMPORTANTE:
- NO inventes código que no está en el CLAUDE.md
- NO cambies los modelos LLM (están elegidos por precio/calidad)
- NO saltes el SQL schema — se ejecuta manualmente en Supabase
- El archivo .env.local lo creo yo con mis API keys — tú crea el archivo vacío con los nombres de las variables

EMPIEZA con la Fase 0: ejecuta el npx create-next-app, instala dependencias, y crea la estructura de carpetas. Luego avísame antes de pasar a la Fase 1.
```

---

## Paso 4: Después de que Claude Code termine cada fase

Claude Code te va a ir preguntando. Responde así:

- Después de Fase 0: "Continúa con Fase 1 — crea el .env.local template"
- Después de Fase 1: "El SQL lo ejecuto yo en Supabase. Continúa con Fase 2"
- Después de Fase 2: "Continúa con Fase 3"
- Después de Fase 3: "Continúa con Fase 4"
- Después de Fase 4: "Continúa con Fase 5"
- Después de Fase 5: "Continúa con Fase 6"
- Después de Fase 6: "Continúa con Fase 7 — ejecuta el SQL seed del marketplace"
- Después de Fase 7: "Continúa con Fase 8 — pero NO hagas deploy todavía, solo prepara"
- Después de Fase 8: "Corre npm run build y muéstrame si hay errores"

## Paso 5: Arreglar errores (si los hay)

Si npm run build falla, dile a Claude Code:

```
Hay estos errores en el build: [pega los errores]. Arregla cada uno sin cambiar la lógica del CLAUDE.md.
```

## Paso 6: Llenar .env.local con tus API keys

Abre el archivo .env.local y llena cada variable con las keys que creaste:

```
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENROUTER_API_KEY=sk-or-v1-...
OPENAI_API_KEY=sk-...
UPSTASH_REDIS_URL=https://...upstash.io
UPSTASH_REDIS_TOKEN=AX...
STRIPE_SECRET_KEY=sk_live_...
```

## Paso 7: Deploy a Vercel

Dile a Claude Code:

```
Haz deploy a Vercel. Crea el repo en GitHub como privado y conecta con Vercel. El proyecto se llama "atiende-ai".
```

## Paso 8: Subir env vars a Vercel

Después del deploy, ve a:
- vercel.com → tu proyecto → Settings → Environment Variables
- Copia TODAS las variables de .env.local ahí
- Haz redeploy

## LISTO — tu SaaS está live.

