'use client';
import React, { useState } from 'react';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';

export interface Testimonial {
  avatarSrc: string;
  name: string;
  handle: string;
  text: string;
}

interface SignInPageProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  heroImageSrc?: string;
  heroVideoSrc?: string;
  testimonials?: Testimonial[];
  onSignIn?: (event: React.FormEvent<HTMLFormElement>) => void;
  onGoogleSignIn?: () => void;
  onResetPassword?: () => void;
  onCreateAccount?: () => void;
}

const GlassInputWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-2xl border border-zinc-200 bg-white transition-colors focus-within:border-[hsl(235,84%,55%)] focus-within:ring-2 focus-within:ring-[hsl(235,84%,55%,0.1)]">
    {children}
  </div>
);

const TestimonialCard = ({ testimonial, delay }: { testimonial: Testimonial; delay: string }) => (
  <div className={`animate-testimonial ${delay} flex items-start gap-3 rounded-3xl bg-white/80 backdrop-blur-xl border border-white/40 p-5 w-64 shadow-lg`}>
    <img src={testimonial.avatarSrc} className="h-10 w-10 object-cover rounded-2xl" alt="avatar" />
    <div className="text-sm leading-snug">
      <p className="flex items-center gap-1 font-medium text-zinc-900">{testimonial.name}</p>
      <p className="text-zinc-500">{testimonial.handle}</p>
      <p className="mt-1 text-zinc-700">{testimonial.text}</p>
    </div>
  </div>
);

export const SignInPage: React.FC<SignInPageProps> = ({
  title = <span className="font-light tracking-tighter">Bienvenido</span>,
  description = 'Accede a tu cuenta y automatiza tu negocio con AI',
  heroImageSrc,
  heroVideoSrc,
  testimonials = [],
  onSignIn,
  onGoogleSignIn,
  onResetPassword,
  onCreateAccount,
}) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row w-[100dvw] bg-zinc-50">
      {/* Left: form */}
      <section className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="flex flex-col gap-6">
            <Image
              src="/logo.png"
              alt="atiende.ai"
              width={472}
              height={200}
              priority
              style={{ height: '56px', width: 'auto' }}
              className="animate-element animate-delay-50 mb-2"
            />
            <h1 className="animate-element animate-delay-100 text-4xl md:text-5xl font-semibold leading-tight text-zinc-900">{title}</h1>
            <p className="animate-element animate-delay-200 text-zinc-500">{description}</p>

            <form className="space-y-5" onSubmit={onSignIn}>
              <div className="animate-element animate-delay-300">
                <label className="text-sm font-medium text-zinc-600">Correo electrónico</label>
                <GlassInputWrapper>
                  <input name="email" type="email" placeholder="tu@email.com" className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none text-zinc-900 placeholder:text-zinc-400" required />
                </GlassInputWrapper>
              </div>

              <div className="animate-element animate-delay-400">
                <label className="text-sm font-medium text-zinc-600">Contraseña</label>
                <GlassInputWrapper>
                  <div className="relative">
                    <input name="password" type={showPassword ? 'text' : 'password'} placeholder="Tu contraseña" className="w-full bg-transparent text-sm p-4 pr-12 rounded-2xl focus:outline-none text-zinc-900 placeholder:text-zinc-400" required minLength={8} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-3 flex items-center">
                      {showPassword ? <EyeOff className="w-5 h-5 text-zinc-400 hover:text-zinc-700 transition-colors" /> : <Eye className="w-5 h-5 text-zinc-400 hover:text-zinc-700 transition-colors" />}
                    </button>
                  </div>
                </GlassInputWrapper>
              </div>

              <div className="animate-element animate-delay-500 flex items-center justify-between text-sm">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" name="rememberMe" className="custom-checkbox" />
                  <span className="text-zinc-700">Mantener sesión</span>
                </label>
                <a href="#" onClick={(e) => { e.preventDefault(); onResetPassword?.(); }} className="hover:underline transition-colors" style={{color: 'hsl(235 84% 55%)'}}>¿Olvidaste tu contraseña?</a>
              </div>

              <button type="submit" className="animate-element animate-delay-600 w-full rounded-2xl py-4 font-medium text-white hover:opacity-90 transition-colors" style={{background: 'hsl(235 84% 55%)'}}>
                Iniciar sesión
              </button>
            </form>

            <div className="animate-element animate-delay-700 relative flex items-center justify-center">
              <span className="w-full border-t border-zinc-200" />
              <span className="px-4 text-sm text-zinc-400 bg-zinc-50 absolute">O continúa con</span>
            </div>

            <button onClick={onGoogleSignIn} className="animate-element animate-delay-800 w-full flex items-center justify-center gap-3 border border-zinc-200 rounded-2xl py-4 bg-white text-zinc-700 hover:bg-zinc-100 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-2.641-.21-5.236-.611-7.743z" />
                <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
                <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-2.641-.21-5.236-.611-7.743z" />
              </svg>
              Continuar con Google
            </button>

            <p className="animate-element animate-delay-900 text-center text-sm text-zinc-500">
              ¿No tienes cuenta?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); onCreateAccount?.(); }} className="font-medium hover:underline transition-colors" style={{color: 'hsl(235 84% 55%)'}}>Crear cuenta gratis</a>
            </p>
          </div>
        </div>
      </section>

      {/* Right: hero image/video + testimonials */}
      {(heroImageSrc || heroVideoSrc) && (
        <section className="hidden md:block flex-1 relative p-4">
          <div className="animate-slide-right animate-delay-300 absolute inset-4 rounded-3xl overflow-hidden">
            {heroVideoSrc ? (
              <video
                src={heroVideoSrc}
                poster={heroImageSrc}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-cover bg-center" style={{ backgroundImage: `url(${heroImageSrc})` }} />
            )}
          </div>
          {testimonials.length > 0 && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-4 px-8 w-full justify-center">
              <TestimonialCard testimonial={testimonials[0]} delay="animate-delay-1000" />
              {testimonials[1] && <div className="hidden xl:flex"><TestimonialCard testimonial={testimonials[1]} delay="animate-delay-1200" /></div>}
              {testimonials[2] && <div className="hidden 2xl:flex"><TestimonialCard testimonial={testimonials[2]} delay="animate-delay-1400" /></div>}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
