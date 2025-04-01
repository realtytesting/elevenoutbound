const WebSocket = require('ws');
const fetch = require('node-fetch');

const server = new WebSocket.Server({ port: process.env.PORT || 10000 });

server.on('connection', (ws, req) => {
  console.log('🔌 Twilio connected');

  let elevenWs;

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.event === 'start') {
        console.log('✅ Call started:', data.start.callSid);
        const agentId = process.env.ELEVENLABS_AGENT_ID;
        const apiKey = process.env.ELEVENLABS_API_KEY;

        // Get signed URL from ElevenLabs
        const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, {
          headers: { 'xi-api-key': apiKey },
        });

        const { signed_url } = await response.json();
        const name = data.start?.customParameters?.name || 'Guest';
        const phone = data.start?.customParameters?.phone || '';


        elevenWs = new WebSocket(signed_url);

        elevenWs.on('open', () => {
          const initConfig = {
            type: 'conversation_initiation_client_data',
            dynamic_variables: {
              user_name: 'Caller',
              user_id: data.start.callSid,
              name: name,
              phone: phone,
              system__called_number: phone,
            }
          };
          elevenWs.send(JSON.stringify(initConfig));
        });

        elevenWs.on('message', (message) => {
          const res = JSON.parse(message);
          if (res.audio?.chunk || res.audio_event?.audio_base_64) {
            const payload = res.audio?.chunk || res.audio_event.audio_base_64;
            ws.send(JSON.stringify({
              event: 'media',
              streamSid: data.start.streamSid,
              media: { payload }
            }));
          }
        });

        elevenWs.on('close', () => console.log('❌ ElevenLabs connection closed'));
      }

      if (data.event === 'media') {
        if (elevenWs?.readyState === WebSocket.OPEN) {
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
