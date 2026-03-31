import { NextRequest, NextResponse } from 'next/server';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
export async function POST(req: NextRequest) {
  const{message,businessType,businessInfo,answers}=await req.json();
  const ctx=Object.entries(answers).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n');
  const result=await generateResponse({model:MODELS.STANDARD,system:`Eres asistente de ${businessInfo.name||'Mi Negocio'}.\n${ctx}`,messages:[{role:'user',content:message}],maxTokens:300});
  return NextResponse.json({reply:result.text});
}
