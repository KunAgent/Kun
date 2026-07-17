<div class="w-[1440px] h-[810px] bg-gradient-to-br from-[#0a0e1a] to-[#1a1f2e] relative overflow-hidden">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- 数据流背景 -->
    <svg style="position: absolute; width: 100%; height: 100%; opacity: 0.3;">
      <defs>
        <linearGradient id="data-flow-1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#00ffff;stop-opacity:0"/>
          <stop offset="50%" style="stop-color:#00ffff;stop-opacity:1"/>
          <stop offset="100%" style="stop-color:#00ffff;stop-opacity:0"/>
        </linearGradient>
      </defs>
      <rect x="0" y="20%" width="100%" height="2" fill="url(#data-flow-1)">
        <animate attributeName="y" values="0%;100%" dur="4s" repeatCount="indefinite"/>
      </rect>
      <rect x="0" y="40%" width="100%" height="2" fill="url(#data-flow-1)">
        <animate attributeName="y" values="0%;100%" dur="5s" repeatCount="indefinite"/>
      </rect>
      <rect x="0" y="60%" width="100%" height="2" fill="url(#data-flow-1)">
        <animate attributeName="y" values="0%;100%" dur="4.5s" repeatCount="indefinite"/>
      </rect>
    </svg>

    <!-- 内容区 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
      <div style="position: relative; padding: 50px 80px; background: rgba(10, 14, 26, 0.9); border: 2px solid #00ffff; box-shadow: 0 0 50px rgba(0, 255, 255, 0.4);">
        <div class="text-[56px] font-bold text-[#00ffff] mb-10 text-center" style="letter-spacing: 5px; text-shadow: 0 0 30px rgba(0, 255, 255, 0.6);">
          谢谢
        </div>
        <div class="text-[28px] text-[#00ffff] text-center" style="letter-spacing: 3px; font-family: 'Courier New', monospace;">
          感谢您的耐心聆听
        </div>
      </div>
    </div>
  </div>
</div>