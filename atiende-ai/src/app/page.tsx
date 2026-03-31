import Link from 'next/link';
import {
  MessageSquare, Phone, Zap, Clock, Shield, BarChart3,
  ChevronRight, Star, Check, ArrowRight, HelpCircle,
  Stethoscope, UtensilsCrossed, Building2, Scissors, Hotel, Brain
} from 'lucide-react';

const features = [
  { icon: MessageSquare, title: 'Chat WhatsApp AI', desc: 'Responde mensajes 24/7. Agenda citas, toma pedidos y contesta preguntas frecuentes en español mexicano natural.' },
  { icon: Phone, title: 'Voz AI', desc: 'Contesta llamadas telefónicas con voz natural. Transfiere a humano cuando es necesario.' },
  { icon: Zap, title: '15 Agentes Extra', desc: 'Cobrador, reseñas Google, NPS, reactivación de clientes inactivos. Activa con 1 click.' },
  { icon: Clock, title: 'Listo en 10 minutos', desc: 'Responde 15 preguntas, conecta tu WhatsApp, y tu asistente empieza a trabajar.' },
  { icon: Shield, title: 'Anti-alucinación', desc: 'NUNCA inventa precios ni da diagnósticos médicos. 4 capas de validación.' },
  { icon: BarChart3, title: 'Dashboard ROI', desc: 'Ve cuántos mensajes contestó, cuántas horas te ahorró y cuánto dinero te salvó.' },
];

const industries = [
  { icon: Stethoscope, name: 'Consultorios', desc: 'Agenda citas, reduce no-shows 70%, envía recordatorios automáticos.' },
  { icon: UtensilsCrossed, name: 'Restaurantes', desc: 'Toma pedidos por WhatsApp, maneja delivery, muestra menú digital.' },
  { icon: Building2, name: 'Inmobiliarias', desc: 'Califica leads BANT, agenda visitas, da info de propiedades 24/7.' },
  { icon: Scissors, name: 'Salones', desc: 'Agenda citas con el estilista correcto, sugiere servicios complementarios.' },
  { icon: Hotel, name: 'Hoteles', desc: 'Reservas directas (sin comisión OTA), concierge bilingüe, upselling.' },
  { icon: Brain, name: 'Psicólogos', desc: 'Protocolo de crisis integrado, agenda con máxima confidencialidad.' },
];

const plans = [
  { name: 'Básico', price: '$499', desc: 'Para empezar', features: ['Chat WhatsApp AI', '25 industrias soportadas', '500 mensajes/mes', 'Dashboard básico', 'Recordatorios automáticos'] },
  { name: 'Pro', price: '$999', desc: 'Más popular', pop: true, features: ['Todo de Básico', '2,000 mensajes/mes', 'ROI Calculator', 'Marketplace de agentes', 'Analytics avanzados', 'Soporte prioritario'] },
  { name: 'Premium', price: '$1,499', desc: 'Sin límites', features: ['Todo de Pro', 'Mensajes ilimitados', 'Voz AI incluida', '15 agentes marketplace', 'Integraciones premium', 'Soporte dedicado'] },
];

const faqs = [
  { q: '¿Funciona con mi número de WhatsApp actual?', a: 'Sí. Conectas tu número de WhatsApp Business a través de Meta Embedded Signup en 2 clicks. Tu número sigue siendo tuyo.' },
  { q: '¿Qué pasa si el bot no sabe algo?', a: 'Nunca inventa. Si no tiene la información, dice "Permítame verificar con el equipo" y puede transferir a un humano.' },
  { q: '¿Puedo probar gratis?', a: 'Sí, 14 días gratis sin tarjeta de crédito. Cancela cuando quieras.' },
  { q: '¿Cuánto tarda en configurarse?', a: '10 minutos. Respondes 15 preguntas sobre tu negocio, conectas WhatsApp, y listo.' },
  { q: '¿Funciona con audios de WhatsApp?', a: 'Sí. El 30-40% de mensajes en México son audio. Nuestro sistema transcribe con Deepgram y responde.' },
  { q: '¿Es seguro para consultorios médicos?', a: 'Sí. Tiene guardrails médicos: NUNCA diagnostica, NUNCA receta medicamentos. Protocolo de crisis con líneas de ayuda.' },
  { q: '¿Acepta pagos en OXXO?', a: 'Sí. Aceptamos tarjeta (Stripe), OXXO y SPEI (Conekta). El 35% del comercio en México es en efectivo.' },
  { q: '¿Puedo cancelar cuando quiera?', a: 'Sí, sin penalización. Cancela desde tu dashboard en cualquier momento.' },
];

const testimonials = [
  { name: 'Dra. María González', biz: 'Consultorio Dental, Mérida', text: 'Redujimos los no-shows en 70%. El bot agenda citas a las 11pm cuando antes perdíamos esos pacientes.' },
  { name: 'Roberto Sánchez', biz: 'Taquería El Fogón, Cancún', text: '10 pedidos extra por noche que antes perdíamos por no contestar. Se pagó solo en la primera semana.' },
  { name: 'Ana Martínez', biz: 'Inmobiliaria Costa, Playa del Carmen', text: 'Cerramos 3 ventas en el primer mes que habríamos perdido. El bot califica leads mientras dormimos.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-zinc-100">
        <div className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">atiende.ai</h1>
          <div className="hidden md:flex items-center gap-6 text-sm text-zinc-600">
            <a href="#funciones" className="hover:text-zinc-900 transition-colors">Funciones</a>
            <a href="#industrias" className="hover:text-zinc-900 transition-colors">Industrias</a>
            <a href="#precios" className="hover:text-zinc-900 transition-colors">Precios</a>
            <a href="#faq" className="hover:text-zinc-900 transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-zinc-600 text-sm hover:text-zinc-900 transition-colors">Iniciar sesión</Link>
            <Link href="/register" className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-all hover:shadow-lg hover:shadow-emerald-200">Prueba gratis</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 via-white to-teal-50" />
        <div className="relative text-center px-6 py-24 md:py-32 max-w-4xl mx-auto">
          <div className="inline-block bg-emerald-100 text-emerald-700 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
            Tu asistente AI en WhatsApp y teléfono
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-zinc-900 leading-tight tracking-tight">
            Tu negocio contesta clientes<br />
            <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">24/7, sin contratar a nadie</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-zinc-600 max-w-2xl mx-auto leading-relaxed">
            Responde WhatsApp, agenda citas y toma pedidos automáticamente. En español mexicano natural. Listo en 10 minutos.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10">
            <Link href="/register" className="bg-emerald-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-emerald-700 transition-all hover:shadow-xl hover:shadow-emerald-200 hover:-translate-y-0.5 flex items-center justify-center gap-2">
              Empezar gratis <ArrowRight className="w-5 h-5" />
            </Link>
            <a href="#funciones" className="border-2 border-zinc-200 text-zinc-700 px-8 py-4 rounded-xl font-bold text-lg hover:border-zinc-300 hover:bg-zinc-50 transition-all flex items-center justify-center gap-2">
              Ver funciones
            </a>
          </div>
          <div className="flex flex-wrap gap-6 justify-center mt-8 text-sm text-zinc-500">
            <span className="flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> 14 días gratis</span>
            <span className="flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> Sin tarjeta</span>
            <span className="flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> Cancela cuando quieras</span>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="px-6 py-20 bg-zinc-900 text-white">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-12">¿Tu negocio pierde clientes por no contestar?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { stat: '30-50', unit: 'msgs/día', desc: 'sin contestar mientras atiendes clientes' },
              { stat: '20-35%', unit: 'no-shows', desc: 'de citas perdidas por falta de recordatorios' },
              { stat: '60-70%', unit: 'repetitivas', desc: 'de preguntas son las mismas: horarios, precios, ubicación' },
            ].map(p => (
              <div key={p.stat} className="p-6">
                <p className="text-4xl md:text-5xl font-bold text-emerald-400">{p.stat}</p>
                <p className="text-lg font-medium mt-2">{p.unit}</p>
                <p className="text-zinc-400 text-sm mt-1">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="px-6 py-20">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-zinc-900 mb-4">Funciona en 3 pasos</h2>
          <p className="text-zinc-600 mb-12">Sin conocimiento técnico. Sin programar.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { num: '1', title: 'Responde 15 preguntas', desc: 'Sobre tu negocio: servicios, precios, horarios. Nuestro AI genera el asistente perfecto.' },
              { num: '2', title: 'Conecta tu WhatsApp', desc: 'En 2 clicks con Meta Embedded Signup. Sin cambiar tu número.' },
              { num: '3', title: 'Tu asistente trabaja', desc: 'Empieza a contestar clientes, agendar citas y tomar pedidos inmediatamente.' },
            ].map(s => (
              <div key={s.num} className="relative p-8 rounded-2xl border border-zinc-200 hover:border-emerald-200 hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-bold text-xl mx-auto mb-4">{s.num}</div>
                <h3 className="text-xl font-bold text-zinc-900 mb-2">{s.title}</h3>
                <p className="text-zinc-600 text-sm">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="funciones" className="px-6 py-20 bg-zinc-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-zinc-900 mb-12">Todo lo que necesitas</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {features.map(f => (
              <div key={f.title} className="bg-white p-6 rounded-xl border border-zinc-200 hover:shadow-lg hover:border-emerald-200 transition-all group">
                <f.icon className="w-10 h-10 text-emerald-600 mb-4 group-hover:scale-110 transition-transform" />
                <h3 className="font-bold text-lg text-zinc-900 mb-2">{f.title}</h3>
                <p className="text-sm text-zinc-600 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Industries */}
      <section id="industrias" className="px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-zinc-900 mb-4">25 industrias, un solo software</h2>
          <p className="text-zinc-600 text-center mb-12">Cada industria tiene su propio template, guardrails y dashboard</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {industries.map(ind => (
              <div key={ind.name} className="p-6 rounded-xl border border-zinc-200 hover:shadow-lg hover:border-emerald-200 transition-all">
                <ind.icon className="w-8 h-8 text-emerald-600 mb-3" />
                <h3 className="font-bold text-zinc-900 mb-1">{ind.name}</h3>
                <p className="text-sm text-zinc-600">{ind.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-zinc-400 text-sm mt-8">+ 19 industrias más: veterinaria, farmacia, escuela, gimnasio, óptica, floristería...</p>
        </div>
      </section>

      {/* Testimonials */}
      <section className="px-6 py-20 bg-zinc-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-zinc-900 mb-12">Lo que dicen nuestros clientes</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map(t => (
              <div key={t.name} className="bg-white p-6 rounded-xl border border-zinc-200 hover:shadow-lg transition-all">
                <div className="flex gap-1 mb-4">{[1,2,3,4,5].map(i => <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />)}</div>
                <p className="text-zinc-700 text-sm leading-relaxed mb-4">&ldquo;{t.text}&rdquo;</p>
                <div>
                  <p className="font-bold text-zinc-900 text-sm">{t.name}</p>
                  <p className="text-zinc-500 text-xs">{t.biz}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="precios" className="px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-zinc-900 mb-4">Planes simples, sin sorpresas</h2>
          <p className="text-zinc-600 text-center mb-12">Todos incluyen 14 días gratis. Sin tarjeta de crédito.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {plans.map(p => (
              <div key={p.name} className={`rounded-2xl border p-8 transition-all hover:shadow-xl ${p.pop ? 'border-emerald-500 ring-2 ring-emerald-500 bg-emerald-50 scale-105' : 'border-zinc-200 hover:border-emerald-200'}`}>
                {p.pop && <span className="bg-emerald-600 text-white text-xs font-bold px-3 py-1 rounded-full">Más popular</span>}
                <h3 className="text-xl font-bold mt-3 text-zinc-900">{p.name}</h3>
                <p className="text-zinc-500 text-sm">{p.desc}</p>
                <p className="mt-4"><span className="text-4xl font-bold text-zinc-900">{p.price}</span><span className="text-zinc-500"> MXN/mes</span></p>
                <ul className="mt-6 space-y-3">
                  {p.features.map(f => <li key={f} className="flex items-center gap-2 text-sm text-zinc-700"><Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />{f}</li>)}
                </ul>
                <Link href="/register" className={`block text-center mt-8 py-3 rounded-xl font-medium transition-all ${p.pop ? 'bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-lg' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}>
                  Empezar gratis
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center text-zinc-400 text-sm mt-8">Precios + IVA. Voz AI disponible como add-on desde $3,000 MXN/mes.</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-6 py-20 bg-zinc-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-zinc-900 mb-12">Preguntas frecuentes</h2>
          <div className="space-y-4">
            {faqs.map(faq => (
              <details key={faq.q} className="group bg-white rounded-xl border border-zinc-200 hover:border-emerald-200 transition-colors">
                <summary className="flex items-center justify-between p-6 cursor-pointer">
                  <span className="font-medium text-zinc-900 text-sm md:text-base">{faq.q}</span>
                  <HelpCircle className="w-5 h-5 text-zinc-400 group-open:text-emerald-600 transition-colors flex-shrink-0 ml-4" />
                </summary>
                <div className="px-6 pb-6 text-sm text-zinc-600 leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-6 py-24 bg-gradient-to-br from-emerald-600 to-teal-700 text-white text-center">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Empieza tu prueba gratis hoy</h2>
          <p className="text-emerald-100 text-lg mb-8">14 días gratis. Sin tarjeta. Tu asistente AI listo en 10 minutos.</p>
          <Link href="/register" className="inline-flex items-center gap-2 bg-white text-emerald-700 px-8 py-4 rounded-xl font-bold text-lg hover:bg-emerald-50 transition-all hover:shadow-xl hover:-translate-y-0.5">
            Crear mi asistente AI <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-zinc-900 text-zinc-400 px-6 py-12">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between gap-8">
            <div>
              <h3 className="text-white font-bold text-lg">atiende.ai</h3>
              <p className="text-sm mt-1">Asistentes AI para negocios mexicanos</p>
            </div>
            <div className="flex gap-12 text-sm">
              <div className="space-y-2">
                <p className="text-white font-medium">Producto</p>
                <a href="#funciones" className="block hover:text-white transition-colors">Funciones</a>
                <a href="#precios" className="block hover:text-white transition-colors">Precios</a>
                <a href="#faq" className="block hover:text-white transition-colors">FAQ</a>
              </div>
              <div className="space-y-2">
                <p className="text-white font-medium">Empresa</p>
                <p>Mérida, Yucatán, México</p>
                <p>contacto@atiende.ai</p>
              </div>
            </div>
          </div>
          <div className="border-t border-zinc-800 mt-8 pt-8 text-xs text-center">
            © 2026 atiende.ai. Todos los derechos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}
