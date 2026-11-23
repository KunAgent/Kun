import type { BrowserWindow } from 'electron'

/** Exercise the actual signed-bundle viewer menu, including a fresh SDP offer in each direction. */
export async function exerciseViewerGameSwitch(window: BrowserWindow) {
  await window.webContents.executeJavaScript(`(async()=>{
    const video=document.getElementById('video'), quality=document.getElementById('quality')
    const until=async (stage,check)=>{
      const deadline=performance.now()+15000
      while(!check()){
        if(performance.now()>deadline) throw Error([stage,quality.value,document.getElementById('mode').textContent,video.videoWidth,document.getElementById('overlay').textContent,document.getElementById('error').textContent].join(' | '))
        await new Promise(resolve=>setTimeout(resolve,25))
      }
    }
    await until('initial',()=>!quality.disabled && video.videoWidth>0)
    if(video.srcObject.getAudioTracks().length) throw Error('Unexpected office audio')
    for(const choice of ['game60','balanced']){
      const previous=video.srcObject
      quality.value=choice; quality.dispatchEvent(new Event('change'))
      await until(choice,()=>!quality.disabled && video.srcObject && video.srcObject!==previous && video.videoWidth>0)
      const audio=video.srcObject.getAudioTracks().filter(track=>track.readyState==='live')
      if(audio.length!==(choice==='game60'?1:0)) throw Error('Unexpected negotiated audio tracks')
      if(previous.getTracks().some(track=>track.readyState!=='ended')) throw Error('Old capture track still live')
    }
  })()`)
}
