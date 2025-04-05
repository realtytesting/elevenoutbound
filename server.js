const WebSocket = require('ws');
const fetch = require('node-fetch');
require('dotenv').config();

const server = new WebSocket.Server({ port: process.env.PORT || 10000 });

server.on('connection', (ws) => {
  console.log('🔌 Twilio WebSocket connected');

  let elevenWs;

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);

      // Start event
      if (data.event === 'start') {
        console.log('✅ Call started:', data.start.callSid);

        const agentId = data.start?.customParameters?.agent_id || process.env.ELEVENLABS_AGENT_ID;
        const apiKey = process.env.ELEVENLABS_API_KEY;

        // Step 1: Get signed URL from ElevenLabs
        const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, {
          headers: { 'xi-api-key': apiKey }
        });

        const json = await response.json();
        const signed_url = json?.signed_url;

        if (!signed_url) {
          console.error('❌ Failed to get ElevenLabs signed URL');
          ws.close();
          return;
        }

        elevenWs = new WebSocket(signed_url);

        elevenWs.on('open', () => {
          console.log('🟢 ElevenLabs connected');

          const name = data.start?.customParameters?.name || 'Caller';
          const phone = data.start?.customParameters?.phone || '';

          const initMessage = {
            type: 'conversation_initiation_client_data',
            dynamic_variables: {
              user_name: name,
              user_id: data.start.callSid,
              phone: phone
            }
          };

          elevenWs.send(JSON.stringify(initMessage));

          // Optional: dummy payload to keep Twilio stream alive
          ws.send(JSON.stringify({
            event: 'media',
            streamSid: data.start.streamSid,
            media: {
              payload: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA='
            }
          }));
        });

        elevenWs.on('message', (message) => {
          const parsed = JSON.parse(message);
          const payload = parsed.audio?.chunk || parsed.audio_event?.audio_base_64;

          if (payload) {
            ws.send(JSON.stringify({
              event: 'media',
              streamSid: data.start.streamSid,
              media: { payload }
            }));
          }
        });

        elevenWs.on('error', (err) => {
          console.error('🔥 ElevenLabs error:', err);
        });

        elevenWs.on('close', () => {
          console.log('🔌 ElevenLabs closed');
        });
      }

      // Media event
      if (data.event === 'media') {
        const payload = data.media?.payload;
        if (payload && elevenWs?.readyState === WebSocket.OPEN) {
          elevenWs.send(JSON.stringify({
            user_audio_chunk: Buffer.from(payload, 'base64').toString('base64')
          }));
        }
      }

      // Stop event
      if (data.event === 'stop') {
        console.log('🛑 Call ended');
        if (elevenWs?.readyState === WebSocket.OPEN) elevenWs.close();
        ws.close();
      }

    } catch (err) {
      console.error('❌ Error in WS message:', err);
    }
  });

  ws.on('close', () => {
    console.log('❌ Twilio WebSocket closed');
    if (elevenWs?.readyState === WebSocket.OPEN) elevenWs.close();
  });
});
