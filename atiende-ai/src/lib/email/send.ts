import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}) {
  if (!resend) {
    console.warn('Email not configured: RESEND_API_KEY missing');
    return null;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: params.from || 'useatiende.ai <no-reply@useatiende.ai>',
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (error) {
      console.error('Email send error:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Email failed:', err);
    return null;
  }
}
