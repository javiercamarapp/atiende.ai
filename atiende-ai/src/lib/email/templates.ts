export function welcomeEmail(businessName: string, ownerName: string): { subject: string; html: string } {
  return {
    subject: `Bienvenido a atiende.ai, ${businessName}!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #10B981, #0D9488); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0;">atiende.ai</h1>
          <p style="color: #D1FAE5; margin: 5px 0 0;">Tu asistente AI esta listo</p>
        </div>
        <div style="padding: 30px; background: white; border: 1px solid #E5E7EB; border-radius: 0 0 12px 12px;">
          <h2 style="color: #18181B;">Hola ${ownerName || 'emprendedor'}!</h2>
          <p style="color: #52525B; line-height: 1.6;">Tu agente AI para <strong>${businessName}</strong> ya esta activo y listo para contestar clientes 24/7.</p>
          <div style="background: #F0FDF4; border-left: 4px solid #10B981; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <p style="margin: 0; color: #166534;"><strong>Proximos pasos:</strong></p>
            <ol style="color: #166534; padding-left: 20px;">
              <li>Revisa tu dashboard</li>
              <li>Envia un mensaje de prueba</li>
              <li>Comparte tu numero con clientes</li>
            </ol>
          </div>
          <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.atiende.ai'}/home" style="display: inline-block; background: #10B981; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Ir a mi Dashboard</a>
          <p style="color: #A1A1AA; font-size: 12px; margin-top: 30px;">Si tienes preguntas, responde a este correo. Estamos en Merida, Yucatan.</p>
        </div>
      </div>
    `,
  };
}

export function weeklyReportEmail(businessName: string, stats: {
  messages: number; appointments: number; savings: number; roi: number;
}): { subject: string; html: string } {
  return {
    subject: `Reporte semanal de ${businessName} - atiende.ai`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #18181B; padding: 20px 30px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 18px;">Reporte Semanal</h1>
          <p style="color: #A1A1AA; margin: 5px 0 0;">${businessName}</p>
        </div>
        <div style="padding: 30px; background: white; border: 1px solid #E5E7EB;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
            <tr>
              <td width="50%" style="padding: 10px;">
                <div style="background: #F9FAFB; padding: 15px; border-radius: 8px; text-align: center;">
                  <p style="color: #6B7280; font-size: 12px; margin: 0;">Mensajes</p>
                  <p style="font-size: 28px; font-weight: bold; margin: 5px 0; color: #18181B;">${stats.messages}</p>
                </div>
              </td>
              <td width="50%" style="padding: 10px;">
                <div style="background: #F9FAFB; padding: 15px; border-radius: 8px; text-align: center;">
                  <p style="color: #6B7280; font-size: 12px; margin: 0;">Citas</p>
                  <p style="font-size: 28px; font-weight: bold; margin: 5px 0; color: #18181B;">${stats.appointments}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td width="50%" style="padding: 10px;">
                <div style="background: #F0FDF4; padding: 15px; border-radius: 8px; text-align: center;">
                  <p style="color: #166534; font-size: 12px; margin: 0;">Ahorro</p>
                  <p style="font-size: 28px; font-weight: bold; margin: 5px 0; color: #166534;">$${stats.savings.toLocaleString()}</p>
                </div>
              </td>
              <td width="50%" style="padding: 10px;">
                <div style="background: #F0FDF4; padding: 15px; border-radius: 8px; text-align: center;">
                  <p style="color: #166534; font-size: 12px; margin: 0;">ROI</p>
                  <p style="font-size: 28px; font-weight: bold; margin: 5px 0; color: #166534;">${stats.roi}%</p>
                </div>
              </td>
            </tr>
          </table>
        </div>
        <div style="padding: 20px 30px; background: #F9FAFB; border: 1px solid #E5E7EB; border-top: 0; border-radius: 0 0 12px 12px; text-align: center;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.atiende.ai'}/analytics" style="color: #10B981; text-decoration: none; font-weight: bold;">Ver analytics completos</a>
        </div>
      </div>
    `,
  };
}

export function trialEndingEmail(businessName: string, daysLeft: number): { subject: string; html: string } {
  return {
    subject: `Tu prueba gratis termina en ${daysLeft} dias - ${businessName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #FEF3C7; padding: 20px 30px; border-radius: 12px 12px 0 0;">
          <h1 style="color: #92400E; margin: 0; font-size: 18px;">Tu prueba gratis termina pronto</h1>
        </div>
        <div style="padding: 30px; background: white; border: 1px solid #E5E7EB; border-radius: 0 0 12px 12px;">
          <p style="color: #52525B; line-height: 1.6;">Tu periodo de prueba de <strong>${businessName}</strong> en atiende.ai termina en <strong>${daysLeft} dias</strong>.</p>
          <p style="color: #52525B;">Para seguir contestando clientes 24/7, elige un plan:</p>
          <div style="margin: 20px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.atiende.ai'}/settings/billing" style="display: inline-block; background: #10B981; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Elegir mi plan</a>
          </div>
          <p style="color: #A1A1AA; font-size: 12px;">Planes desde $499 MXN/mes. Sin compromiso.</p>
        </div>
      </div>
    `,
  };
}
