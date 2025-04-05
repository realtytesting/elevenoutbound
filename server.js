const WebSocket = require('ws');
const fetch = require('node-fetch');
require('dotenv').config(); // ✅ Make sure this line exists and .env is setup

const PORT = process.env.PORT || 10000;
const server = new WebSocket.Server({ port: PORT });

console.log(`🟢 WebSocket server started on port ${PORT}`);

server.on('connection', (twilioWs) => {
  console.log('🔌 Twilio WebSocket connected');

  let elevenWs = null;

  twilioWs.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);

      // 📞 Start event from Twilio
      if (data.event === 'start') {
        console.log('✅ Call started:', data.start.callSid);

        const agentId = data.start?.customParameters?.agent_id || process.env.ELEVENLABS_AGENT_ID;
        const apiKey = process.env.ELEVENLABS_API_KEY;

        // ✅ Fetch signed URL from ElevenLabs
        const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, {
          headers: { 'xi-api-key': apiKey }
        });

        const result = await response.json();
        const signedUrl = result?.signed_url;

        if (!signedUrl) {
          console.error('❌ Could not fetch signed ElevenLabs URL:', result);
          twilioWs.close();
          return;
        }

        // 🔗 Connect to ElevenLabs WebSocket
        elevenWs = new WebSocket(signedUrl);

        elevenWs.on('open', () => {
          console.log('🟢 Connected to ElevenLabs');

          const initData = {
            type: 'conversation_initiation_client_data',
            dynamic_variables: {
              user_name: data.start?.customParameters?.name || 'Caller',
              user_id: data.start.callSid,
              phone: data.start?.customParameters?.phone || '',
              system__called_number: data.start?.customParameters?.phone || ''
            }
          };

          elevenWs.send(JSON.stringify(initData));

          // Optional: keep Twilio stream alive with dummy payload
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
            const audio = parsed.audio?.chunk || parsed.audio_event?.audio_base_64;
            if (audio) {
              twilioWs.send(JSON.stringify({
                event: 'media',
                streamSid: data.start.streamSid,
                media: { payload: audio }
              }));
            }
          } catch (err) {
            console.error('❌ Error parsing ElevenLabs message:', err);
          }
        });

        elevenWs.on('close', () => {
          console.log('🔌 ElevenLabs WebSocket closed');
        });

        elevenWs.on('error', (err) => {
          console.error('🔥 ElevenLabs WebSocket error:', err);
        });
      }

      // 🎤 Media from Twilio → send to ElevenLabs
      if (data.event === 'media' && elevenWs?.readyState === WebSocket.OPEN) {
        elevenWs.send(JSON.stringify({
          user_audio_chunk: Buffer.from(data.media.payload, 'base64').toString('base64')
        }));
      }

      // 🛑 Call stopped
      if (data.event === 'stop') {
        console.log('🛑 Twilio call ended');
        if (elevenWs?.readyState === WebSocket.OPEN) elevenWs.close();
        twilioWs.close();
      }

    } catch (err) {
      console.error('❌ Error handling Twilio message:', err);
    }
  });

  // Clean up on Twilio disconnect
  twilioWs.on('close', () => {
    console.log('❌ Twilio WebSocket disconnected');
    if (elevenWs?.readyState === WebSocket.OPEN) elevenWs.close();
  });
});
