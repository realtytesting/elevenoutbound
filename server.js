const WebSocket = require('ws');
const fetch = require('node-fetch');
require('dotenv').config();

const PORT = process.env.PORT || 10000;
const server = new WebSocket.Server({ port: PORT });

console.log(`🟢 WebSocket server started on port ${PORT}`);

server.on('connection', (twilioWs) => {
  console.log('🔌 Twilio WebSocket connected');

  let elevenWs = null;

  twilioWs.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);

      // 📞 Call Start
      if (data.event === 'start') {
        console.log('✅ Call started:', data.start.callSid);

        const agentId = data.start?.customParameters?.agent_id || process.env.ELEVENLABS_AGENT_ID;
        const apiKey = process.env.ELEVENLABS_API_KEY;

        const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, {
          headers: { 'xi-api-key': apiKey }
        });

        const result = await response.json();
        const signedUrl = result?.signed_url;

        if (!signedUrl) {
          console.error('❌ Failed to get signed URL:', result);
          twilioWs.close();
          return;
        }

        elevenWs = new WebSocket(signedUrl);

        elevenWs.on('open', () => {
          console.log('🟢 Connected to ElevenLabs');

          const init = {
              type: 'conversation_initiation_client_data',
              dynamic_variables: {
                user_name: 'Caller',
                user_id: data.start.callSid,
                phone: data.start?.customParameters?.phone || '',
                override_agent_prompt: data.start?.customParameters?.prompt || '',
                first_message: data.start?.customParameters?.first_message || ''
              }
            };


          elevenWs.send(JSON.stringify(init));

          // ✅ Dummy audio to keep connection alive
          twilioWs.send(JSON.stringify({
            event: 'media',
            streamSid: data.start.streamSid,
            media: {
              payload: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA='
            }
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
            } else {
              console.log('ℹ️ ElevenLabs non-audio message:', parsed);
            }
          } catch (err) {
            console.error('❌ Parse error:', err);
          }
        });

        elevenWs.on('close', () => console.log('🔌 ElevenLabs closed'));
        elevenWs.on('error', (err) => console.error('🔥 ElevenLabs error:', err));
      }

      // 🎤 Audio from Twilio
      if (data.event === 'media') {
        if (data.media?.payload && elevenWs?.readyState === WebSocket.OPEN) {
          elevenWs.send(JSON.stringify({
            user_audio_chunk: Buffer.from(data.media.payload, 'base64').toString('base64')
          }));
        }
      }

      // 🛑 Stop call
      if (data.event === 'stop') {
        console.log('🛑 Call ended');
        if (elevenWs?.readyState === WebSocket.OPEN) elevenWs.close();
        twilioWs.close();
      }
    } catch (err) {
      console.error('❌ WebSocket Error:', err);
    }
  });

  twilioWs.on('close', () => {
    console.log('❌ Twilio disconnected');
    if (elevenWs?.readyState === WebSocket.OPEN) elevenWs.close();
  });
});
