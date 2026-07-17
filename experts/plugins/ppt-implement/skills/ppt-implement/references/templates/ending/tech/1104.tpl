<div class="w-[1440px] h-[810px] bg-[radial-gradient(ellipse_at_center,#1a1a3e_0%,#0a0a1a_100%)] relative overflow-hidden">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- 粒子流背景 -->
    <div style="position: absolute; width: 100%; height: 100%;">
      <div style="position: absolute; top: 8%; left: 4%; width: 3px; height: 3px; background: #00ffff; border-radius: 50%; box-shadow: 0 0 8px #00ffff; animation: particle-flow-1 5s linear infinite;"></div>
      <div style="position: absolute; top: 22%; left: 10%; width: 4px; height: 4px; background: #ff00ff; border-radius: 50%; box-shadow: 0 0 10px #ff00ff; animation: particle-flow-2 6s linear infinite 0.5s;"></div>
      <div style="position: absolute; top: 35%; left: 6%; width: 2px; height: 2px; background: #ffff00; border-radius: 50%; box-shadow: 0 0 6px #ffff00; animation: particle-flow-3 5.5s linear infinite 1s;"></div>
      <div style="position: absolute; top: 50%; left: 13%; width: 3px; height: 3px; background: #00ff00; border-radius: 50%; box-shadow: 0 0 8px #00ff00; animation: particle-flow-1 6.5s linear infinite 1.5s;"></div>
      <div style="position: absolute; top: 65%; left: 8%; width: 4px; height: 4px; background: #ff6600; border-radius: 50%; box-shadow: 0 0 10px #ff6600; animation: particle-flow-2 5.8s linear infinite 2s;"></div>
      <div style="position: absolute; top: 80%; left: 5%; width: 3px; height: 3px; background: #00ccff; border-radius: 50%; box-shadow: 0 0 8px #00ccff; animation: particle-flow-3 6.2s linear infinite 2.5s;"></div>
      
      <div style="position: absolute; top: 12%; left: 18%; width: 2px; height: 2px; background: #ff3399; border-radius: 50%; box-shadow: 0 0 6px #ff3399; animation: particle-flow-2 5.3s linear infinite 0.8s;"></div>
      <div style="position: absolute; top: 45%; left: 22%; width: 4px; height: 4px; background: #00ffaa; border-radius: 50%; box-shadow: 0 0 10px #00ffaa; animation: particle-flow-1 6.8s linear infinite 1.3s;"></div>
      <div style="position: absolute; top: 75%; left: 20%; width: 3px; height: 3px; background: #ffaa00; border-radius: 50%; box-shadow: 0 0 8px #ffaa00; animation: particle-flow-3 5.7s linear infinite 1.8s;"></div>
    </div>

    <!-- 流动光线 -->
    <svg style="position: absolute; width: 100%; height: 100%; opacity: 0.3;">
      <line x1="0%" y1="25%" x2="100%" y2="25%" stroke="url(#flow-gradient-1)" stroke-width="2">
        <animate attributeName="x1" values="-100%;100%" dur="3s" repeatCount="indefinite"/>
        <animate attributeName="x2" values="0%;200%" dur="3s" repeatCount="indefinite"/>
      </line>
      <line x1="0%" y1="50%" x2="100%" y2="50%" stroke="url(#flow-gradient-2)" stroke-width="2">
        <animate attributeName="x1" values="-100%;100%" dur="4s" repeatCount="indefinite"/>
        <animate attributeName="x2" values="0%;200%" dur="4s" repeatCount="indefinite"/>
      </line>
      <line x1="0%" y1="75%" x2="100%" y2="75%" stroke="url(#flow-gradient-3)" stroke-width="2">
        <animate attributeName="x1" values="-100%;100%" dur="3.5s" repeatCount="indefinite"/>
        <animate attributeName="x2" values="0%;200%" dur="3.5s" repeatCount="indefinite"/>
      </line>
      <defs>
        <linearGradient id="flow-gradient-1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#00ffff;stop-opacity:0"/>
          <stop offset="50%" style="stop-color:#00ffff;stop-opacity:1"/>
          <stop offset="100%" style="stop-color:#00ffff;stop-opacity:0"/>
        </linearGradient>
        <linearGradient id="flow-gradient-2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#ff00ff;stop-opacity:0"/>
          <stop offset="50%" style="stop-color:#ff00ff;stop-opacity:1"/>
          <stop offset="100%" style="stop-color:#ff00ff;stop-opacity:0"/>
        </linearGradient>
        <linearGradient id="flow-gradient-3" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#ffff00;stop-opacity:0"/>
          <stop offset="50%" style="stop-color:#ffff00;stop-opacity:1"/>
          <stop offset="100%" style="stop-color:#ffff00;stop-opacity:0"/>
        </linearGradient>
      </defs>
    </svg>

    <!-- 内容区 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
      <div style="position: relative; padding: 65px 105px; background: rgba(26, 26, 62, 0.85); backdrop-filter: blur(15px); border: 2px solid rgba(0, 255, 255, 0.5); box-shadow: 0 0 60px rgba(0, 255, 255, 0.4), inset 0 0 40px rgba(0, 255, 255, 0.1);">
        
        <!-- 角落粒子装饰 -->
        <div style="position: absolute; top: -5px; left: -5px;">
          <div style="width: 8px; height: 8px; background: #00ffff; border-radius: 50%; box-shadow: 0 0 15px #00ffff; animation: corner-pulse 2s ease-in-out infinite;"></div>
          <div style="position: absolute; top: 12px; left: 0; width: 6px; height: 6px; background: #ff00ff; border-radius: 50%; box-shadow: 0 0 12px #ff00ff; animation: corner-pulse 2s ease-in-out infinite 0.3s;"></div>
          <div style="position: absolute; top: 0; left: 12px; width: 6px; height: 6px; background: #ffff00; border-radius: 50%; box-shadow: 0 0 12px #ffff00; animation: corner-pulse 2s ease-in-out infinite 0.6s;"></div>
        </div>
        <div style="position: absolute; top: -5px; right: -5px;">
          <div style="width: 8px; height: 8px; background: #ff00ff; border-radius: 50%; box-shadow: 0 0 15px #ff00ff; animation: corner-pulse 2s ease-in-out infinite 0.2s;"></div>
          <div style="position: absolute; top: 12px; right: 0; width: 6px; height: 6px; background: #00ffff; border-radius: 50%; box-shadow: 0 0 12px #00ffff; animation: corner-pulse 2s ease-in-out infinite 0.5s;"></div>
          <div style="position: absolute; top: 0; right: 12px; width: 6px; height: 6px; background: #00ff00; border-radius: 50%; box-shadow: 0 0 12px #00ff00; animation: corner-pulse 2s ease-in-out infinite 0.8s;"></div>
        </div>
        <div style="position: absolute; bottom: -5px; left: -5px;">
          <div style="width: 8px; height: 8px; background: #ffff00; border-radius: 50%; box-shadow: 0 0 15px #ffff00; animation: corner-pulse 2s ease-in-out infinite 0.4s;"></div>
          <div style="position: absolute; bottom: 12px; left: 0; width: 6px; height: 6px; background: #00ffff; border-radius: 50%; box-shadow: 0 0 12px #00ffff; animation: corner-pulse 2s ease-in-out infinite 0.7s;"></div>
          <div style="position: absolute; bottom: 0; left: 12px; width: 6px; height: 6px; background: #ff00ff; border-radius: 50%; box-shadow: 0 0 12px #ff00ff; animation: corner-pulse 2s ease-in-out infinite 1s;"></div>
        </div>
        <div style="position: absolute; bottom: -5px; right: -5px;">
          <div style="width: 8px; height: 8px; background: #00ff00; border-radius: 50%; box-shadow: 0 0 15px #00ff00; animation: corner-pulse 2s ease-in-out infinite 0.6s;"></div>
          <div style="position: absolute; bottom: 12px; right: 0; width: 6px; height: 6px; background: #ffff00; border-radius: 50%; box-shadow: 0 0 12px #ffff00; animation: corner-pulse 2s ease-in-out infinite 0.9s;"></div>
          <div style="position: absolute; bottom: 0; right: 12px; width: 6px; height: 6px; background: #00ffff; border-radius: 50%; box-shadow: 0 0 12px #00ffff; animation: corner-pulse 2s ease-in-out infinite 1.2s;"></div>
        </div>

        <div class="text-[56px] font-bold mb-10 text-center" style="background: linear-gradient(135deg, #00ffff 0%, #ff00ff 50%, #ffff00 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; letter-spacing: 5px; filter: drop-shadow(0 0 25px rgba(0, 255, 255, 0.6));">
          感谢
        </div>
        <div class="text-[28px] text-[#00ffff] text-center" style="letter-spacing: 3px; font-family: 'Arial', sans-serif; text-shadow: 0 0 15px rgba(0, 255, 255, 0.6);">
          感谢您的聆听与关注
        </div>
      </div>
    </div>
  </div>

  <style>
    @keyframes particle-flow-1 {
      0% { transform: translate(0, 0); opacity: 1; }
      100% { transform: translate(1150px, -90px); opacity: 0; }
    }
    @keyframes particle-flow-2 {
      0% { transform: translate(0, 0); opacity: 1; }
      100% { transform: translate(1150px, 90px); opacity: 0; }
    }
    @keyframes particle-flow-3 {
      0% { transform: translate(0, 0); opacity: 1; }
      100% { transform: translate(1150px, 0); opacity: 0; }
    }
    @keyframes corner-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.5); opacity: 0.6; }
    }
  </style>
</div>
