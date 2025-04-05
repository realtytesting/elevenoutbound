const WebSocket = require('ws');
const fetch = require('node-fetch');
require('dotenv').config();

const PORT = process.env.PORT || 10000;
const server = new WebSocket.Server({ port: PORT });

console.log(`🟢 WebSocket server running on port ${PORT}`);

server.on('connection', (twilioWs) => {
  console.log('🔌 Twilio WebSocket connected');

  let elevenWs;

  twilioWs.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.event === 'start') {
        const agentId = data.start?.customParameters?.agent_id || process.env.ELEVENLABS_AGENT_ID;
        const apiKey  = process.env.ELEVENLABS_API_KEY;

        const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, {
          headers: { 'xi-api-key': apiKey }
        });

        const json = await response.json();
        const signedUrl = json?.signed_url;

        if (!signedUrl) {
          console.error('❌ Failed to get ElevenLabs signed URL');
          twilioWs.close();
          return;
        }

        elevenWs = new WebSocket(signedUrl);

        elevenWs.on('open', () => {
          console.log('🟢 Connected to ElevenLabs');

          const initPayload = {
            type: 'conversation_initiation_client_data',
            dynamic_variables: {
              user_name: 'Caller',
              phone: data.start?.customParameters?.phone || '',
              user_id: data.start.callSid
            }
          };

          elevenWs.send(JSON.stringify(initPayload));

          // Optional: Keep Twilio alive with dummy audio
          twilioWs.send(JSON.stringify({
            event: 'media',
            streamSid: data.start.streamSid,
            media: { payload: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=' }
          }));
        });

        elevenWs.on('message', (msg) => {
          try {
            const parsed = JSON.parse(msg);
            const payload = parsed.audio?.chunk || parsed.audio_event?.audio_base_64;

            if (payload) {
              twilioWs.send(JSON.stringify({
                event: 'media',
                streamSid: data.start.streamSid,
                media: { payload }
              }));
            }
          } catch (err) {
            console.error('🔴 ElevenLabs message parse error:', err);
          }
        });

        elevenWs.on('close', () => {
          console.log('🔌 ElevenLabs disconnected');
        });
      }

      if (data.event === 'media' && elevenWs?.readyState === WebSocket.OPEN) {
        elevenWs.send(JSON.stringify({
          user_audio_chunk: Buffer.from(data.media.payload, 'base64').toString('base64')
        }));
      }

      if (data.event === 'stop') {
        console.log('🛑 Twilio call stopped');
        if (elevenWs?.readyState === WebSocket.OPEN) elevenWs.close();
        twilioWs.close();
      }

    } catch (err) {
      console.error('❌ Error handling message:', err);
    }
  });

  twilioWs.on('close', () => {
    console.log('❌ Twilio WebSocket closed');
    if (elevenWs?.readyState === WebSocket.OPEN) elevenWs.close();
  });
});
