<div class="w-[1440px] h-[810px] bg-gradient-to-br from-[#050510] to-[#1a1a2e] relative overflow-hidden">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- 能量波背景 -->
    <svg style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 900px; height: 900px; opacity: 0.3;">
      <circle cx="450" cy="450" r="100" fill="none" stroke="#00d4ff" stroke-width="2" opacity="0.8">
        <animate attributeName="r" values="100;360;100" dur="4s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.8;0.2;0.8" dur="4s" repeatCount="indefinite"/>
      </circle>
      <circle cx="450" cy="450" r="150" fill="none" stroke="#00ffcc" stroke-width="2" opacity="0.7">
        <animate attributeName="r" values="150;410;150" dur="4.5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.7;0.15;0.7" dur="4.5s" repeatCount="indefinite"/>
      </circle>
      <circle cx="450" cy="450" r="200" fill="none" stroke="#00ff99" stroke-width="2" opacity="0.6">
        <animate attributeName="r" values="200;450;200" dur="5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.6;0.1;0.6" dur="5s" repeatCount="indefinite"/>
      </circle>
      <circle cx="450" cy="450" r="250" fill="none" stroke="#00ffff" stroke-width="2" opacity="0.5">
        <animate attributeName="r" values="250;500;250" dur="5.5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.5;0.05;0.5" dur="5.5s" repeatCount="indefinite"/>
      </circle>
    </svg>

    <!-- 中心能量核心 -->
    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 130px; height: 130px; background: radial-gradient(circle, rgba(0, 212, 255, 0.4), transparent 70%); border-radius: 50%; animation: energy-pulse 2s ease-in-out infinite;"></div>

    <!-- 能量粒子 -->
    <div style="position: absolute; top: 20%; left: 15%; width: 8px; height: 8px; background: #00d4ff; border-radius: 50%; box-shadow: 0 0 20px #00d4ff; animation: orbit-1 6s linear infinite;"></div>
    <div style="position: absolute; bottom: 18%; right: 12%; width: 6px; height: 6px; background: #00ffcc; border-radius: 50%; box-shadow: 0 0 15px #00ffcc; animation: orbit-2 7s linear infinite;"></div>
    <div style="position: absolute; top: 30%; right: 15%; width: 7px; height: 7px; background: #00ff99; border-radius: 50%; box-shadow: 0 0 18px #00ff99; animation: orbit-3 6.5s linear infinite;"></div>
    <div style="position: absolute; top: 65%; right: 18%; width: 9px; height: 9px; background: #00ffff; border-radius: 50%; box-shadow: 0 0 22px #00ffff; animation: orbit-4 7.5s linear infinite;"></div>

    <!-- 内容区 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
      <div style="position: relative; padding: 50px 85px; background: rgba(5, 5, 16, 0.9); backdrop-filter: blur(15px); border: 2px solid rgba(0, 212, 255, 0.6); box-shadow: 0 0 60px rgba(0, 212, 255, 0.4), inset 0 0 40px rgba(0, 212, 255, 0.1);">
        
        <!-- 能量节点装饰 -->
        <div style="position: absolute; top: -8px; left: 50%; transform: translateX(-50%); width: 14px; height: 14px; background: #00d4ff; border-radius: 50%; box-shadow: 0 0 25px #00d4ff; animation: node-pulse 2s ease-in-out infinite;"></div>
        <div style="position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); width: 14px; height: 14px; background: #00d4ff; border-radius: 50%; box-shadow: 0 0 25px #00d4ff; animation: node-pulse 2s ease-in-out infinite 0.5s;"></div>
        <div style="position: absolute; left: -8px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; background: #00ffcc; border-radius: 50%; box-shadow: 0 0 25px #00ffcc; animation: node-pulse 2s ease-in-out infinite 0.25s;"></div>
        <div style="position: absolute; right: -8px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; background: #00ffcc; border-radius: 50%; box-shadow: 0 0 25px #00ffcc; animation: node-pulse 2s ease-in-out infinite 0.75s;"></div>

        <!-- 能量连接线 -->
        <svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;">
          <line x1="50%" y1="0" x2="0" y2="50%" stroke="#00d4ff" stroke-width="1" opacity="0.4">
            <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" repeatCount="indefinite"/>
          </line>
          <line x1="50%" y1="0" x2="100%" y2="50%" stroke="#00d4ff" stroke-width="1" opacity="0.4">
            <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" repeatCount="indefinite" begin="0.5s"/>
          </line>
          <line x1="0" y1="50%" x2="50%" y2="100%" stroke="#00ffcc" stroke-width="1" opacity="0.4">
            <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" repeatCount="indefinite" begin="0.25s"/>
          </line>
          <line x1="100%" y1="50%" x2="50%" y2="100%" stroke="#00ffcc" stroke-width="1" opacity="0.4">
            <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" repeatCount="indefinite" begin="0.75s"/>
          </line>
        </svg>

        <div class="text-[56px] font-bold mb-10 text-center" style="background: linear-gradient(135deg, #00d4ff 0%, #00ffcc 50%, #00ff99 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; letter-spacing: 6px; filter: drop-shadow(0 0 30px rgba(0, 212, 255, 0.6));">
          谢谢观看
        </div>
        <div class="text-[28px] text-[#00d4ff] text-center" style="letter-spacing: 3px; font-family: 'Arial', sans-serif; text-shadow: 0 0 20px rgba(0, 212, 255, 0.6);">
          欢迎提出宝贵建议
        </div>

        <!-- 内部能量光晕 -->
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 100%; height: 100%; background: radial-gradient(ellipse at center, rgba(0, 212, 255, 0.05), transparent 70%); pointer-events: none; animation: inner-glow 3s ease-in-out infinite;"></div>
      </div>
    </div>

    <!-- 能量指示器 -->
    <div style="position: absolute; bottom: 25px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; align-items: center;">
      <div style="width: 8px; height: 8px; background: #00d4ff; border-radius: 50%; box-shadow: 0 0 15px #00d4ff; animation: indicator-blink 1s ease-in-out infinite;"></div>
      <div style="width: 8px; height: 8px; background: #00ffcc; border-radius: 50%; box-shadow: 0 0 15px #00ffcc; animation: indicator-blink 1s ease-in-out infinite 0.3s;"></div>
      <div style="width: 8px; height: 8px; background: #00ff99; border-radius: 50%; box-shadow: 0 0 15px #00ff99; animation: indicator-blink 1s ease-in-out infinite 0.6s;"></div>
    </div>
  </div>

  <style>
    @keyframes energy-pulse {
      0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.4; }
      50% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.6; }
    }
    @keyframes orbit-1 {
      0% { transform: rotate(0deg) translateX(280px) rotate(0deg); }
      100% { transform: rotate(360deg) translateX(280px) rotate(-360deg); }
    }
    @keyframes orbit-2 {
      0% { transform: rotate(90deg) translateX(300px) rotate(-90deg); }
      100% { transform: rotate(450deg) translateX(300px) rotate(-450deg); }
    }
    @keyframes orbit-3 {
      0% { transform: rotate(180deg) translateX(290px) rotate(-180deg); }
      100% { transform: rotate(540deg) translateX(290px) rotate(-540deg); }
    }
    @keyframes orbit-4 {
      0% { transform: rotate(270deg) translateX(310px) rotate(-270deg); }
      100% { transform: rotate(630deg) translateX(310px) rotate(-630deg); }
    }
    @keyframes node-pulse {
      0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 25px currentColor; }
      50% { transform: translate(-50%, -50%) scale(1.3); box-shadow: 0 0 40px currentColor; }
    }
    @keyframes inner-glow {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 0.8; }
    }
    @keyframes indicator-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  </style>
</div>
