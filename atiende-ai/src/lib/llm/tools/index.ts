// ═════════════════════════════════════════════════════════════════════════════
// TOOLS BARREL — Phase 2 registration entry point
//
// Importar este archivo causa que cada módulo de tool se cargue y ejecute su
// `registerTool(...)` al tope. Esto poblá el registry global del proceso
// (ver `src/lib/llm/tool-executor.ts`).
//
// El processor lo importa una sola vez (en el boot del proceso vía side
// effect) y luego usa `getToolSchemas([...])` para pedir las tools que el
// agente activo necesita.
//
// Para agregar una tool nueva: crea el archivo en este directorio que llame
// `registerTool(...)`, y agrégalo a la lista de imports de abajo.
// ═════════════════════════════════════════════════════════════════════════════

import './get-business-info';
import './get-services';
import './book-appointment';
import './cancel-appointment';
import './escalate-to-human';

// Re-export del registry helper para conveniencia.
export { listRegisteredTools, getToolSchemas } from '@/lib/llm/tool-executor';
