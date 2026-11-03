const { app, BrowserWindow } = require('electron')
const { mkdtempSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
// Uses only a synthetic canvas in a hidden test renderer. No screen, camera, microphone or user profile.
app.setPath('userData', mkdtempSync(join(tmpdir(), 'kun-desktop-peer-')))
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } })
  try {
    await window.loadURL('data:text/html,<meta charset="utf-8"><title>Kun synthetic desktop peer smoke</title>')
    const result = await window.webContents.executeJavaScript(`(async () => {
      const host = new RTCPeerConnection({iceServers:[]}), phone = new RTCPeerConnection({iceServers:[]});
      const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=200;
      const context=canvas.getContext('2d'), stream=canvas.captureStream(10), track=stream.getVideoTracks()[0];
      const paint=setInterval(()=>{context.fillStyle='rgb('+Math.floor(Math.random()*255)+',40,70)';context.fillRect(0,0,320,200)},100);
      const video=document.createElement('video');video.muted=true;video.autoplay=true;document.body.appendChild(video);
      let frames=0, hello=false, streamsFallback=false, ready=false;
      function count(){frames++;video.requestVideoFrameCallback(count)}video.requestVideoFrameCallback(count);
      phone.ontrack=event=>{streamsFallback=event.streams.length===0;video.srcObject=event.streams[0]||new MediaStream([event.track]);void video.play()};
      const hs=[],ps=[];
      host.onicecandidate=e=>{if(e.candidate){if(phone.remoteDescription)void phone.addIceCandidate(e.candidate);else ps.push(e.candidate)}};
      phone.onicecandidate=e=>{if(e.candidate){if(host.remoteDescription)void host.addIceCandidate(e.candidate);else hs.push(e.candidate)}};
      const transceiver=host.addTransceiver('video',{direction:'sendonly'});
      const codecs=RTCRtpSender.getCapabilities('video').codecs;
      transceiver.setCodecPreferences([...codecs.filter(x=>x.mimeType.toLowerCase()==='video/h264'),...codecs.filter(x=>x.mimeType.toLowerCase()!=='video/h264')]);
      const channels=['kun.desktop.control.v1','kun.desktop.input.v1','kun.desktop.pointer.v1'].map(label=>host.createDataChannel(label,label.endsWith('pointer.v1')?{ordered:false,maxRetransmits:0}:{ordered:true}));
      phone.ondatachannel=event=>{const channel=event.channel;if(channel.label==='kun.desktop.control.v1'){channel.onopen=()=>channel.send(JSON.stringify({type:'hello'}));channel.onmessage=e=>{ready=JSON.parse(e.data).type==='ready'}}};
      channels[0].onmessage=async event=>{if(JSON.parse(event.data).type==='hello'){hello=true;await transceiver.sender.replaceTrack(track);channels[0].send(JSON.stringify({type:'ready'}))}};
      const offer=await host.createOffer();await host.setLocalDescription(offer);await phone.setRemoteDescription(offer);
      const answer=await phone.createAnswer();await phone.setLocalDescription(answer);await host.setRemoteDescription(answer);
      for(const x of hs)await host.addIceCandidate(x);for(const x of ps)await phone.addIceCandidate(x);
      const until=performance.now()+10000;while(!(hello&&ready&&frames>=3)){if(performance.now()>until)throw Error('handshake/frame timeout');await new Promise(r=>setTimeout(r,50))}
      const stats=await phone.getStats();let codec='';for(const value of stats.values())if(value.type==='inbound-rtp'&&value.kind==='video')codec=stats.get(value.codecId)?.mimeType||'';
      const senderStats=async()=>{const values=await transceiver.sender.getStats();return [...values.values()].find(x=>x.type==='outbound-rtp'&&x.kind==='video')};
      const first=await senderStats();await new Promise(r=>setTimeout(r,600));const fresh=await senderStats();
      if(!first||!fresh||fresh.id!==first.id||fresh.timestamp<=first.timestamp||!Number.isSafeInteger(fresh.framesEncoded)||fresh.framesEncoded<1||!Number.isSafeInteger(fresh.framesSent)||fresh.framesSent<1)throw Error('real sender health stats unavailable');
      clearInterval(paint);track.stop();for(const c of channels)c.close();host.close();phone.close();video.srcObject=null;
      const endedFrames=frames;await new Promise(r=>setTimeout(r,500));
      if(track.readyState!=='ended'||host.signalingState!=='closed'||phone.signalingState!=='closed'||channels.some(c=>c.readyState!=='closed')||frames!==endedFrames)throw Error('cleanup incomplete');
      return {hello,ready,frames,streamsFallback,codec,hostHealth:{framesEncoded:fresh.framesEncoded,framesSent:fresh.framesSent,timestampAdvanced:true},trackEnded:track.readyState==='ended',peersClosed:true,channelsClosed:true};
    })()`)
    console.log(JSON.stringify(result)); window.destroy(); app.exit(0)
  } catch (error) { console.error(error.message); window.destroy(); app.exit(1) }
})
