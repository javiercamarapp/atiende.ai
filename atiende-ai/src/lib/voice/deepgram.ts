import axios from 'axios';

// Transcribir mensajes de audio de WhatsApp
// 30-40% de los mensajes en Mexico son audio
export async function transcribeAudio(
  mediaId: string
): Promise<string> {
  try {
    // 1. Obtener URL del media en Meta
    const mediaRes = await axios.get(
      `https://graph.facebook.com/v21.0/${mediaId}`,
      { headers: {
        Authorization: `Bearer ${process.env.WA_SYSTEM_TOKEN}`
      }}
    );

    // 2. Descargar el archivo de audio
    const audioRes = await axios.get(mediaRes.data.url, {
      headers: {
        Authorization: `Bearer ${process.env.WA_SYSTEM_TOKEN}`
      },
      responseType: 'arraybuffer',
    });

    // 3. Transcribir con Deepgram Nova-3
    // language=multi para code-switching es↔en (comun en MX)
    const dgRes = await axios.post(
      'https://api.deepgram.com/v1/listen?' +
      'model=nova-3&language=multi&smart_format=true&' +
      'punctuate=true&diarize=false',
      audioRes.data,
      {
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/ogg',
        },
      }
    );

    const transcript =
      dgRes.data.results?.channels?.[0]?.alternatives?.[0]?.transcript;

    return transcript || '[Audio no reconocido]';
  } catch (error) {
    console.error('Error transcribiendo audio:', error);
    return '[Error al procesar audio]';
  }
}
