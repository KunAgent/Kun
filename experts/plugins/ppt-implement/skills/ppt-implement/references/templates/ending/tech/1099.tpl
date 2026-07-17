<div class="w-[1440px] h-[810px] bg-gradient-to-br from-[#0a0e27] to-[#1a1f3a] relative overflow-hidden">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- 电路板网格背景 -->
    <svg style="position: absolute; width: 100%; height: 100%; opacity: 0.3;">
      <defs>
        <pattern id="circuit-grid" x="0" y="0" width="90" height="90" patternUnits="userSpaceOnUse">
          <line x1="0" y1="45" x2="90" y2="45" stroke="#00d9ff" stroke-width="1"/>
          <line x1="45" y1="0" x2="45" y2="90" stroke="#00d9ff" stroke-width="1"/>
          <circle cx="0" cy="0" r="3" fill="#00d9ff"/>
          <circle cx="90" cy="0" r="3" fill="#00d9ff"/>
          <circle cx="0" cy="90" r="3" fill="#00d9ff"/>
          <circle cx="90" cy="90" r="3" fill="#00d9ff"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#circuit-grid)"/>
    </svg>

    <!-- 电路节点装饰 -->
    <div style="position: absolute; top: 13%; left: 8%; width: 72px; height: 72px; border: 3px solid #00d9ff; border-radius: 50%; opacity: 0.6; animation: pulse-glow 2s ease-in-out infinite;"></div>
    <div style="position: absolute; top: 17%; right: 13%; width: 54px; height: 54px; border: 2px solid #00ff88; border-radius: 50%; opacity: 0.5; animation: pulse-glow 2.5s ease-in-out infinite 0.3s;"></div>
    <div style="position: absolute; bottom: 17%; left: 10%; width: 63px; height: 63px; border: 3px solid #ff00ff; border-radius: 50%; opacity: 0.5; animation: pulse-glow 2.2s ease-in-out infinite 0.6s;"></div>
    <div style="position: absolute; bottom: 15%; right: 15%; width: 58px; height: 58px; border: 2px solid #ffaa00; border-radius: 50%; opacity: 0.6; animation: pulse-glow 2.8s ease-in-out infinite 0.4s;"></div>

    <!-- 连接线 -->
    <svg style="position: absolute; width: 100%; height: 100%; opacity: 0.4;">
      <line x1="13%" y1="17%" x2="82%" y2="22%" stroke="#00d9ff" stroke-width="2" stroke-dasharray="5,5">
        <animate attributeName="stroke-dashoffset" from="0" to="10" dur="1s" repeatCount="indefinite"/>
      </line>
      <line x1="13%" y1="77%" x2="79%" y2="79%" stroke="#00ff88" stroke-width="2" stroke-dasharray="5,5">
        <animate attributeName="stroke-dashoffset" from="0" to="10" dur="1.2s" repeatCount="indefinite"/>
      </line>
    </svg>

    <!-- 内容区 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
      <div style="position: relative; padding: 42px 65px; border: 2px solid rgba(0, 217, 255, 0.5); background: rgba(10, 14, 39, 0.8); backdrop-filter: blur(10px); box-shadow: 0 0 30px rgba(0, 217, 255, 0.3), inset 0 0 20px rgba(0, 217, 255, 0.1);">
        
        <!-- 四角装饰 -->
        <div style="position: absolute; top: -2px; left: -2px; width: 18px; height: 18px; border-top: 3px solid #00d9ff; border-left: 3px solid #00d9ff;"></div>
        <div style="position: absolute; top: -2px; right: -2px; width: 18px; height: 18px; border-top: 3px solid #00d9ff; border-right: 3px solid #00d9ff;"></div>
        <div style="position: absolute; bottom: -2px; left: -2px; width: 18px; height: 18px; border-bottom: 3px solid #00d9ff; border-left: 3px solid #00d9ff;"></div>
        <div style="position: absolute; bottom: -2px; right: -2px; width: 18px; height: 18px; border-bottom: 3px solid #00d9ff; border-right: 3px solid #00d9ff;"></div>

        <div class="text-[56px] font-bold text-white mb-10 text-center" style="letter-spacing: 4px; text-shadow: 0 0 20px rgba(0, 217, 255, 0.8);">
          谢谢观看
        </div>
        <div class="text-[28px] text-[#00d9ff] text-center" style="letter-spacing: 2px; font-family: 'Courier New', monospace;">
          感谢您的聆听
        </div>
      </div>

      <!-- 发光粒子 -->
      <div style="position: absolute; top: 22%; left: 17%; width: 8px; height: 8px; background: #00d9ff; border-radius: 50%; box-shadow: 0 0 10px #00d9ff; animation: float-particle 3s ease-in-out infinite;"></div>
      <div style="position: absolute; top: 65%; right: 22%; width: 6px; height: 6px; background: #00ff88; border-radius: 50%; box-shadow: 0 0 8px #00ff88; animation: float-particle 3.5s ease-in-out infinite 0.5s;"></div>
      <div style="position: absolute; bottom: 27%; left: 27%; width: 7px; height: 7px; background: #ff00ff; border-radius: 50%; box-shadow: 0 0 10px #ff00ff; animation: float-particle 4s ease-in-out infinite 1s;"></div>
    </div>
  </div>

  <style>
    @keyframes pulse-glow {
      0%, 100% { transform: scale(1); opacity: 0.6; }
      50% { transform: scale(1.1); opacity: 0.8; }
    }
    @keyframes float-particle {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-13px); }
    }
  </style>
</div>
