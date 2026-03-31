import { ReactNode } from 'react';

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">atiende.ai</h1>
          <p className="text-gray-500 mt-1">Crea tu asistente virtual</p>
        </div>
        {children}
      </div>
    </div>
  );
}
