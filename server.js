const WebSocket = require('ws');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 10000;
const server = new WebSocket.Server({ port: PORT });

server.on('connection', (ws, req) => {
  console.log('🔌 Twilio connected');

  let elevenWs;

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.event === 'start') {
        console.log('✅ Call started:', data.start.callSid);
        // Use agent_id from custom parameters if available, else fallback to env variable.
        const agentId = data.start?.customParameters?.agent_id || process.env.ELEVENLABS_AGENT_ID;
        const apiKey = process.env.ELEVENLABS_API_KEY;

        // Request the signed URL from ElevenLabs using the dynamic agent id
        const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, {
          headers: { 'xi-api-key': apiKey },
        });

        const json = await response.json();
        console.log('📦 ElevenLabs response:', json);
        const signed_url = json.signed_url;
        if (!signed_url) {
          console.error('No signed URL returned from ElevenLabs');
          return;
        }
        const name = data.start?.customParameters?.name || 'Guest';
        const phone = data.start?.customParameters?.phone || '';
        // Get prompt and first_message from the custom parameters (set in TwiML)
        const prompt = data.start?.customParameters?.prompt || 'Default prompt';
        const firstMessage = data.start?.customParameters?.first_message || 'Default first message';

        // Connect to ElevenLabs WebSocket with the signed URL
        elevenWs = new WebSocket(signed_url);

        elevenWs.on('open', () => {
          console.log('🎤 ElevenLabs WebSocket connected');

          // Send the conversation initiation payload including prompt & first_message
          const initConfig = {
            type: 'conversation_initiation_client_data',
            dynamic_variables: {
              user_name: name || 'Caller',
              phone: phone,
              system__called_number: phone,
              prompt: prompt,
              first_message: firstMessage
            }
          };

          console.log('➡️ Sending initiation payload:', initConfig);
          elevenWs.send(JSON.stringify(initConfig));
        });

        elevenWs.on('message', (message) => {
          console.log('🎧 ElevenLabs message:', message.toString());
          const res = JSON.parse(message);
          if (res.audio?.chunk || (res.audio_event && res.audio_event.audio_base_64)) {
            const payload = res.audio?.chunk || res.audio_event.audio_base_64;
            ws.send(JSON.stringify({
              event: 'media',
              streamSid: data.start.streamSid,
              media: { payload }
            }));
          }
        });

        elevenWs.on('error', (err) => {
          console.error('🚨 ElevenLabs WebSocket error:', err);
        });

        elevenWs.on('close', () => console.log('❌ ElevenLabs connection closed'));
      }

      if (data.event === 'media') {
        if (elevenWs?.readyState === WebSocket.OPEN) {
          // Forward user audio from Twilio to ElevenLabs
          elevenWs.send(JSON.stringify({
            user_audio_chunk: Buffer.from(data.media.payload, 'base64').toString('base64')
          }));
        }
      }

      if (data.event === 'stop') {
        console.log('🛑 Call stopped');
        if (elevenWs?.readyState === WebSocket.OPEN) elevenWs.close();
        ws.close();
      }

    } catch (err) {
      console.error('❌ Error:', err);
    }
  });

  ws.on('close', () => {
    console.log('❌ Twilio WebSocket disconnected');
    if (elevenWs?.readyState === WebSocket.OPEN) elevenWs.close();
  });
});

console.log(`WebSocket server listening on port ${PORT}`);
