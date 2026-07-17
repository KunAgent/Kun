<div class="w-[1440px] h-[810px] bg-gradient-to-br from-[#0c0d16] to-[#1a1c2e] relative overflow-hidden">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- 激光扫描线 -->
    <div style="position: absolute; top: 0; left: 0; width: 2px; height: 100%; background: linear-gradient(180deg, transparent, #00ff00, transparent); animation: laser-scan-vertical 3s linear infinite;"></div>
    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 2px; background: linear-gradient(90deg, transparent, #00ffff, transparent); animation: laser-scan-horizontal 4s linear infinite;"></div>

    <!-- 网格背景 -->
    <svg style="position: absolute; width: 100%; height: 100%; opacity: 0.15;">
      <defs>
        <pattern id="laser-grid" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="50" height="50" fill="none" stroke="#00ff00" stroke-width="0.5"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#laser-grid)"/>
    </svg>

    <!-- 角落激光发射点 -->
    <div style="position: absolute; top: 10px; left: 10px; width: 18px; height: 18px; background: radial-gradient(circle, #00ff00, transparent); box-shadow: 0 0 20px #00ff00; animation: laser-pulse 2s ease-in-out infinite;"></div>
    <div style="position: absolute; top: 10px; right: 10px; width: 18px; height: 18px; background: radial-gradient(circle, #00ffff, transparent); box-shadow: 0 0 20px #00ffff; animation: laser-pulse 2s ease-in-out infinite 0.5s;"></div>
    <div style="position: absolute; bottom: 10px; left: 10px; width: 18px; height: 18px; background: radial-gradient(circle, #ff00ff, transparent); box-shadow: 0 0 20px #ff00ff; animation: laser-pulse 2s ease-in-out infinite 1s;"></div>
    <div style="position: absolute; bottom: 10px; right: 10px; width: 18px; height: 18px; background: radial-gradient(circle, #ffff00, transparent); box-shadow: 0 0 20px #ffff00; animation: laser-pulse 2s ease-in-out infinite 1.5s;"></div>

    <!-- 内容区 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
      <!-- 激光边框容器 -->
      <div style="position: relative; padding: 70px 110px;">
        
        <!-- 四边激光边框 -->
        <!-- 顶部 -->
        <div style="position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 80%; height: 3px; background: linear-gradient(90deg, transparent, #00ff00 20%, #00ff00 80%, transparent); box-shadow: 0 0 20px #00ff00; animation: laser-border-h 2s ease-in-out infinite;"></div>
        <!-- 底部 -->
        <div style="position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 80%; height: 3px; background: linear-gradient(90deg, transparent, #00ff00 20%, #00ff00 80%, transparent); box-shadow: 0 0 20px #00ff00; animation: laser-border-h 2s ease-in-out infinite 1s;"></div>
        <!-- 左侧 -->
        <div style="position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 3px; height: 70%; background: linear-gradient(180deg, transparent, #00ffff 20%, #00ffff 80%, transparent); box-shadow: 0 0 20px #00ffff; animation: laser-border-v 2s ease-in-out infinite 0.5s;"></div>
        <!-- 右侧 -->
        <div style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 3px; height: 70%; background: linear-gradient(180deg, transparent, #00ffff 20%, #00ffff 80%, transparent); box-shadow: 0 0 20px #00ffff; animation: laser-border-v 2s ease-in-out infinite 1.5s;"></div>

        <!-- 激光角落装饰 -->
        <svg style="position: absolute; top: -2px; left: -2px; width: 55px; height: 55px;">
          <line x1="0" y1="13" x2="40" y2="13" stroke="#00ff00" stroke-width="2" opacity="0.8">
            <animate attributeName="x2" values="0;40;0" dur="2s" repeatCount="indefinite"/>
          </line>
          <line x1="13" y1="0" x2="13" y2="40" stroke="#00ff00" stroke-width="2" opacity="0.8">
            <animate attributeName="y2" values="0;40;0" dur="2s" repeatCount="indefinite"/>
          </line>
        </svg>
        <svg style="position: absolute; top: -2px; right: -2px; width: 55px; height: 55px;">
          <line x1="55" y1="13" x2="15" y2="13" stroke="#00ffff" stroke-width="2" opacity="0.8">
            <animate attributeName="x1" values="55;15;55" dur="2s" repeatCount="indefinite"/>
          </line>
          <line x1="42" y1="0" x2="42" y2="40" stroke="#00ffff" stroke-width="2" opacity="0.8">
            <animate attributeName="y2" values="0;40;0" dur="2s" repeatCount="indefinite"/>
          </line>
        </svg>
        <svg style="position: absolute; bottom: -2px; left: -2px; width: 55px; height: 55px;">
          <line x1="0" y1="42" x2="40" y2="42" stroke="#ff00ff" stroke-width="2" opacity="0.8">
            <animate attributeName="x2" values="0;40;0" dur="2s" repeatCount="indefinite"/>
          </line>
          <line x1="13" y1="55" x2="13" y2="15" stroke="#ff00ff" stroke-width="2" opacity="0.8">
            <animate attributeName="y1" values="55;15;55" dur="2s" repeatCount="indefinite"/>
          </line>
        </svg>
        <svg style="position: absolute; bottom: -2px; right: -2px; width: 55px; height: 55px;">
          <line x1="55" y1="42" x2="15" y2="42" stroke="#ffff00" stroke-width="2" opacity="0.8">
            <animate attributeName="x1" values="55;15;55" dur="2s" repeatCount="indefinite"/>
          </line>
          <line x1="42" y1="55" x2="42" y2="15" stroke="#ffff00" stroke-width="2" opacity="0.8">
            <animate attributeName="y1" values="55;15;55" dur="2s" repeatCount="indefinite"/>
          </line>
        </svg>

        <!-- 内容区域 -->
        <div style="position: relative; background: rgba(12, 13, 22, 0.9); padding: 35px 50px; border: 1px solid rgba(0, 255, 0, 0.3); box-shadow: inset 0 0 40px rgba(0, 255, 0, 0.08);">
          <div class="text-[56px] font-bold text-[#00ff00] mb-10 text-center" style="letter-spacing: 6px; text-shadow: 0 0 25px rgba(0, 255, 0, 0.8), 0 0 50px rgba(0, 255, 0, 0.4); font-family: 'Arial', sans-serif;">
            谢谢
          </div>
          <div class="text-[28px] text-[#00ffff] text-center" style="letter-spacing: 3px; font-family: 'Courier New', monospace; text-shadow: 0 0 15px rgba(0, 255, 255, 0.6);">
            感谢您的宝贵时间
          </div>
        </div>
      </div>

      <!-- 浮动激光点 -->
      <div style="position: absolute; top: 25%; left: 8%; width: 10px; height: 10px; background: #00ff00; border-radius: 50%; box-shadow: 0 0 20px #00ff00; animation: float-laser 3s ease-in-out infinite;"></div>
      <div style="position: absolute; top: 60%; right: 10%; width: 8px; height: 8px; background: #00ffff; border-radius: 50%; box-shadow: 0 0 20px #00ffff; animation: float-laser 3.5s ease-in-out infinite 0.5s;"></div>
    </div>
  </div>

  <style>
    @keyframes laser-scan-vertical {
      0% { left: 0; }
      100% { left: 100%; }
    }
    @keyframes laser-scan-horizontal {
      0% { top: 0; }
      100% { top: 100%; }
    }
    @keyframes laser-pulse {
      0%, 100% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.5); opacity: 1; }
    }
    @keyframes laser-border-h {
      0%, 100% { width: 80%; opacity: 0.8; }
      50% { width: 90%; opacity: 1; }
    }
    @keyframes laser-border-v {
      0%, 100% { height: 70%; opacity: 0.8; }
      50% { height: 80%; opacity: 1; }
    }
    @keyframes float-laser {
      0%, 100% { transform: translate(0, 0); }
      50% { transform: translate(0, -25px); }
    }
  </style>
</div>
