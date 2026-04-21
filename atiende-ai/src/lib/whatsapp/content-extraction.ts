import { transcribeAudio } from '@/lib/voice/deepgram';
import * as mediaProcessor from '@/lib/whatsapp/media-processor';
import { MAX_USER_INPUT_CHARS } from '@/lib/config';

export function sanitizeInput(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim().slice(0, MAX_USER_INPUT_CHARS);
}

export interface WhatsAppMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string };
  voice?: { id: string; mime_type?: string };
  image?: { id?: string; caption?: string };
  document?: { id?: string; filename?: string; mime_type?: string; caption?: string };
  video?: { id?: string; caption?: string };
  location?: { latitude: number; longitude: number };
  interactive?: {
    type: string;
    button_reply?: { title: string };
    list_reply?: { title: string };
  };
  reaction?: { message_id: string; emoji: string };
  sticker?: { id: string };
  contacts?: Array<{ profile?: { name?: string } }>;
}

export interface ExtractedContent {
  content: string;
  messageType: string;
  mediaTranscription?: string;
  mediaDescription?: string;
}

export async function extractContent(msg: WhatsAppMessage): Promise<{ content: string; messageType: string }> {
  let content = '';
  let messageType = msg.type;

  switch (msg.type) {
    case 'text':
      content = msg.text?.body || '';
      break;
    case 'audio':
      content = msg.audio?.id ? await transcribeAudio(msg.audio.id) : '[Audio no disponible]';
      messageType = 'audio';
      break;
    case 'image':
      content = msg.image?.caption ? `[Imagen: ${msg.image.caption}]` : '[Imagen recibida]';
      break;
    case 'document':
      content = `[Documento: ${msg.document?.filename || 'archivo'}]`;
      break;
    case 'location':
      content = `[Ubicacion: ${msg.location?.latitude},${msg.location?.longitude}]`;
      break;
    case 'interactive':
      if (msg.interactive?.type === 'button_reply') {
        content = msg.interactive.button_reply?.title || '';
      } else if (msg.interactive?.type === 'list_reply') {
        content = msg.interactive.list_reply?.title || '';
      }
      break;
    case 'sticker':
      content = '[Sticker]';
      break;
    default:
      content = `[${msg.type} recibido]`;
  }

  return { content: sanitizeInput(content), messageType };
}

export async function extractContentAsync(
  msg: WhatsAppMessage,
  tenantId: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> {
  switch (msg.type) {
    case 'text':
      return { content: sanitizeInput(msg.text?.body || ''), messageType: 'text' };

    case 'audio':
    case 'voice': {
      const id = msg.audio?.id || msg.voice?.id;
      if (!id) return { content: '[Audio no disponible]', messageType: 'audio' };
      const r = await mediaProcessor.transcribeAudio(id, tenantId, signal);
      if (!r.ok || !r.text) {
        return { content: '[No pude entender el audio. ¿Puedes escribirlo?]', messageType: 'audio' };
      }
      return {
        content: sanitizeInput(r.text),
        messageType: 'audio',
        mediaTranscription: r.text,
      };
    }

    case 'image': {
      if (!msg.image?.id) {
        return {
          content: msg.image?.caption ? sanitizeInput(msg.image.caption) : '[Imagen]',
          messageType: 'image',
        };
      }
      const r = await mediaProcessor.describeImage(msg.image.id, tenantId, msg.image.caption, signal);
      if (!r.ok || !r.text) {
        return {
          content: msg.image?.caption ? sanitizeInput(msg.image.caption) : '[Imagen recibida — no pude analizarla]',
          messageType: 'image',
        };
      }
      const captionPart = msg.image.caption ? `${msg.image.caption}\n` : '';
      return {
        content: sanitizeInput(`${captionPart}[Imagen: ${r.text}]`),
        messageType: 'image',
        mediaDescription: r.text,
      };
    }

    case 'document': {
      if (!msg.document?.id) {
        return { content: `[Documento: ${msg.document?.filename || 'archivo'}]`, messageType: 'document' };
      }
      const isPdf = (msg.document.mime_type || '').includes('pdf')
        || (msg.document.filename || '').toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        return {
          content: `[Documento ${msg.document.filename || 'archivo'} — solo proceso PDFs por ahora]`,
          messageType: 'document',
        };
      }
      const r = await mediaProcessor.extractPdfText(msg.document.id, tenantId, msg.document.filename, signal);
      if (!r.ok || !r.text) {
        return {
          content: `[PDF ${msg.document.filename || ''} — no pude leerlo]`,
          messageType: 'document',
        };
      }
      return {
        content: sanitizeInput(r.text),
        messageType: 'document',
        mediaDescription: r.text,
      };
    }

    case 'location':
      return {
        content: `[Ubicación compartida: ${msg.location?.latitude},${msg.location?.longitude}]`,
        messageType: 'location',
      };

    case 'interactive': {
      let content = '';
      if (msg.interactive?.type === 'button_reply') {
        content = msg.interactive.button_reply?.title || '';
      } else if (msg.interactive?.type === 'list_reply') {
        content = msg.interactive.list_reply?.title || '';
      }
      return { content: sanitizeInput(content), messageType: 'interactive' };
    }

    case 'sticker':
      return { content: '[Sticker]', messageType: 'sticker' };

    case 'reaction':
      return {
        content: `[Reacción ${msg.reaction?.emoji || ''}]`,
        messageType: 'reaction',
      };

    case 'video':
      return {
        content: `[Video recibido${msg.video?.caption ? `: ${msg.video.caption}` : ''} — no proceso video aún]`,
        messageType: 'video',
      };

    default:
      return { content: `[${msg.type} recibido]`, messageType: msg.type };
  }
}
