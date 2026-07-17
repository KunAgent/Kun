<div class="w-[1440px] h-[810px] bg-gradient-to-br from-[#0f0c29] via-[#302b63] to-[#24243e] relative overflow-hidden">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- 全息网格背景 -->
    <svg style="position: absolute; width: 100%; height: 100%; opacity: 0.3;">
      <defs>
        <linearGradient id="holo-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#00d4ff; stop-opacity:0.8"/>
          <stop offset="100%" style="stop-color:#00d4ff; stop-opacity:0.2"/>
        </linearGradient>
      </defs>
      <g transform="perspective(800px) rotateX(60deg)">
        <line x1="8%" y1="47%" x2="87%" y2="47%" stroke="url(#holo-gradient)" stroke-width="1"/>
        <line x1="8%" y1="52%" x2="87%" y2="52%" stroke="url(#holo-gradient)" stroke-width="1"/>
        <line x1="8%" y1="57%" x2="87%" y2="57%" stroke="url(#holo-gradient)" stroke-width="1"/>
        <line x1="8%" y1="62%" x2="87%" y2="62%" stroke="url(#holo-gradient)" stroke-width="1"/>
        <line x1="8%" y1="67%" x2="87%" y2="67%" stroke="url(#holo-gradient)" stroke-width="1"/>
        <line x1="28%" y1="37%" x2="28%" y2="77%" stroke="url(#holo-gradient)" stroke-width="1"/>
        <line x1="38%" y1="37%" x2="38%" y2="77%" stroke="url(#holo-gradient)" stroke-width="1"/>
        <line x1="48%" y1="37%" x2="48%" y2="77%" stroke="url(#holo-gradient)" stroke-width="1"/>
        <line x1="58%" y1="37%" x2="58%" y2="77%" stroke="url(#holo-gradient)" stroke-width="1"/>
        <line x1="68%" y1="37%" x2="68%" y2="77%" stroke="url(#holo-gradient)" stroke-width="1"/>
      </g>
    </svg>

    <!-- 全息圆环装饰 -->
    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 540px; height: 540px; border: 2px solid rgba(0, 212, 255, 0.3); border-radius: 50%; animation: rotate-ring 20s linear infinite;"></div>
    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 450px; height: 450px; border: 2px solid rgba(0, 212, 255, 0.25); border-radius: 50%; animation: rotate-ring 15s linear infinite reverse;"></div>
    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 360px; height: 360px; border: 2px solid rgba(0, 212, 255, 0.2); border-radius: 50%; animation: rotate-ring 10s linear infinite;"></div>

    <!-- 光点装饰 -->
    <div style="position: absolute; top: 17%; left: 12%; width: 6px; height: 6px; background: #00d4ff; border-radius: 50%; box-shadow: 0 0 15px #00d4ff; animation: pulse-light 2s ease-in-out infinite;"></div>
    <div style="position: absolute; top: 32%; right: 17%; width: 8px; height: 8px; background: #00ffff; border-radius: 50%; box-shadow: 0 0 15px #00ffff; animation: pulse-light 2.5s ease-in-out infinite 0.3s;"></div>
    <div style="position: absolute; bottom: 22%; left: 15%; width: 7px; height: 7px; background: #0099ff; border-radius: 50%; box-shadow: 0 0 15px #0099ff; animation: pulse-light 2.2s ease-in-out infinite 0.6s;"></div>
    <div style="position: absolute; bottom: 27%; right: 19%; width: 6px; height: 6px; background: #00ccff; border-radius: 50%; box-shadow: 0 0 15px #00ccff; animation: pulse-light 2.8s ease-in-out infinite 0.9s;"></div>

    <!-- 内容区 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
      <div style="position: relative; padding: 45px 70px; background: rgba(15, 12, 41, 0.7); backdrop-filter: blur(10px); border: 2px solid rgba(0, 212, 255, 0.6); box-shadow: 0 0 50px rgba(0, 212, 255, 0.4), inset 0 0 30px rgba(0, 212, 255, 0.1); clip-path: polygon(5% 0%, 100% 0%, 100% 95%, 95% 100%, 0% 100%, 0% 5%);">
        
        <!-- 角落全息标记 -->
        <svg style="position: absolute; top: -2px; left: -2px; width: 38px; height: 38px;">
          <circle cx="5" cy="5" r="4" fill="#00d4ff" opacity="0.8"/>
          <line x1="5" y1="5" x2="33" y2="5" stroke="#00d4ff" stroke-width="2"/>
          <line x1="5" y1="5" x2="5" y2="33" stroke="#00d4ff" stroke-width="2"/>
        </svg>
        <svg style="position: absolute; top: -2px; right: -2px; width: 38px; height: 38px;">
          <circle cx="33" cy="5" r="4" fill="#00d4ff" opacity="0.8"/>
          <line x1="5" y1="5" x2="33" y2="5" stroke="#00d4ff" stroke-width="2"/>
          <line x1="33" y1="5" x2="33" y2="33" stroke="#00d4ff" stroke-width="2"/>
        </svg>
        <svg style="position: absolute; bottom: -2px; left: -2px; width: 38px; height: 38px;">
          <circle cx="5" cy="33" r="4" fill="#00d4ff" opacity="0.8"/>
          <line x1="5" y1="5" x2="5" y2="33" stroke="#00d4ff" stroke-width="2"/>
          <line x1="5" y1="33" x2="33" y2="33" stroke="#00d4ff" stroke-width="2"/>
        </svg>
        <svg style="position: absolute; bottom: -2px; right: -2px; width: 38px; height: 38px;">
          <circle cx="33" cy="33" r="4" fill="#00d4ff" opacity="0.8"/>
          <line x1="33" y1="5" x2="33" y2="33" stroke="#00d4ff" stroke-width="2"/>
          <line x1="5" y1="33" x2="33" y2="33" stroke="#00d4ff" stroke-width="2"/>
        </svg>

        <div class="text-[56px] font-bold mb-10 text-center" style="background: linear-gradient(135deg, #00d4ff 0%, #00ffff 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; letter-spacing: 5px; filter: drop-shadow(0 0 20px rgba(0, 212, 255, 0.6));">
          谢谢
        </div>
        <div class="text-[28px] text-[#00d4ff] text-center" style="letter-spacing: 3px; font-family: 'Arial', sans-serif;">
          感谢您的关注与支持
        </div>

        <!-- 扫描线 -->
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 2px; background: linear-gradient(90deg, transparent, #00d4ff, transparent); animation: scan-horizontal 3s linear infinite;"></div>
      </div>
    </div>
  </div>

  <style>
    @keyframes rotate-ring {
      0% { transform: translate(-50%, -50%) rotate(0deg); }
      100% { transform: translate(-50%, -50%) rotate(360deg); }
    }
    @keyframes pulse-light {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.5); opacity: 0.6; }
    }
    @keyframes scan-horizontal {
      0% { top: 0; }
      100% { top: 100%; }
    }
  </style>
</div>
