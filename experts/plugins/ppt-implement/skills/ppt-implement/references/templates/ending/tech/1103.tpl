<div class="w-[1440px] h-[810px] bg-gradient-to-br from-[#0d1117] to-[#161b22] relative overflow-hidden">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- 网络节点背景 -->
    <svg style="position: absolute; width: 100%; height: 100%; opacity: 0.4;">
      <!-- 连接线 -->
      <line x1="13%" y1="17%" x2="32%" y2="32%" stroke="#58a6ff" stroke-width="1.5" opacity="0.6">
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2s" repeatCount="indefinite"/>
      </line>
      <line x1="32%" y1="32%" x2="48%" y2="48%" stroke="#58a6ff" stroke-width="1.5" opacity="0.6">
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2.3s" repeatCount="indefinite"/>
      </line>
      <line x1="48%" y1="48%" x2="63%" y2="32%" stroke="#58a6ff" stroke-width="1.5" opacity="0.6">
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2.5s" repeatCount="indefinite"/>
      </line>
      <line x1="63%" y1="32%" x2="82%" y2="17%" stroke="#58a6ff" stroke-width="1.5" opacity="0.6">
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2.7s" repeatCount="indefinite"/>
      </line>
      <line x1="13%" y1="78%" x2="32%" y2="63%" stroke="#58a6ff" stroke-width="1.5" opacity="0.6">
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2.2s" repeatCount="indefinite"/>
      </line>
      <line x1="32%" y1="63%" x2="48%" y2="48%" stroke="#58a6ff" stroke-width="1.5" opacity="0.6">
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2.6s" repeatCount="indefinite"/>
      </line>
      <line x1="48%" y1="48%" x2="63%" y2="63%" stroke="#58a6ff" stroke-width="1.5" opacity="0.6">
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2.4s" repeatCount="indefinite"/>
      </line>
      <line x1="63%" y1="63%" x2="82%" y2="78%" stroke="#58a6ff" stroke-width="1.5" opacity="0.6">
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2.8s" repeatCount="indefinite"/>
      </line>
      
      <!-- 节点 -->
      <circle cx="13%" cy="17%" r="6" fill="#58a6ff" opacity="0.8">
        <animate attributeName="r" values="6;8;6" dur="2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="32%" cy="32%" r="8" fill="#79c0ff" opacity="0.8">
        <animate attributeName="r" values="8;10;8" dur="2.3s" repeatCount="indefinite"/>
      </circle>
      <circle cx="48%" cy="48%" r="12" fill="#58a6ff" opacity="0.9">
        <animate attributeName="r" values="12;14;12" dur="2.5s" repeatCount="indefinite"/>
      </circle>
      <circle cx="63%" cy="32%" r="8" fill="#79c0ff" opacity="0.8">
        <animate attributeName="r" values="8;10;8" dur="2.7s" repeatCount="indefinite"/>
      </circle>
      <circle cx="82%" cy="17%" r="6" fill="#58a6ff" opacity="0.8">
        <animate attributeName="r" values="6;8;6" dur="2.2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="13%" cy="78%" r="6" fill="#58a6ff" opacity="0.8">
        <animate attributeName="r" values="6;8;6" dur="2.6s" repeatCount="indefinite"/>
      </circle>
      <circle cx="32%" cy="63%" r="8" fill="#79c0ff" opacity="0.8">
        <animate attributeName="r" values="8;10;8" dur="2.4s" repeatCount="indefinite"/>
      </circle>
      <circle cx="63%" cy="63%" r="8" fill="#79c0ff" opacity="0.8">
        <animate attributeName="r" values="8;10;8" dur="2.8s" repeatCount="indefinite"/>
      </circle>
      <circle cx="82%" cy="78%" r="6" fill="#58a6ff" opacity="0.8">
        <animate attributeName="r" values="6;8;6" dur="2.1s" repeatCount="indefinite"/>
      </circle>
    </svg>

    <!-- 数据流动粒子 -->
    <div style="position: absolute; top: 17%; left: 13%; width: 4px; height: 4px; background: #58a6ff; border-radius: 50%; box-shadow: 0 0 10px #58a6ff; animation: flow-particle-1 3s ease-in-out infinite;"></div>
    <div style="position: absolute; bottom: 17%; right: 13%; width: 4px; height: 4px; background: #79c0ff; border-radius: 50%; box-shadow: 0 0 10px #79c0ff; animation: flow-particle-2 3.5s ease-in-out infinite 0.5s;"></div>

    <!-- 内容区 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
      <div style="position: relative; padding: 45px 75px; background: rgba(13, 17, 23, 0.9); border: 2px solid #58a6ff; box-shadow: 0 0 50px rgba(88, 166, 255, 0.3), inset 0 0 30px rgba(88, 166, 255, 0.08);">
        
        <!-- 连接点装饰 -->
        <div style="position: absolute; top: -6px; left: -6px; width: 10px; height: 10px; background: #58a6ff; border-radius: 50%; box-shadow: 0 0 15px #58a6ff;"></div>
        <div style="position: absolute; top: -6px; right: -6px; width: 10px; height: 10px; background: #58a6ff; border-radius: 50%; box-shadow: 0 0 15px #58a6ff;"></div>
        <div style="position: absolute; bottom: -6px; left: -6px; width: 10px; height: 10px; background: #58a6ff; border-radius: 50%; box-shadow: 0 0 15px #58a6ff;"></div>
        <div style="position: absolute; bottom: -6px; right: -6px; width: 10px; height: 10px; background: #58a6ff; border-radius: 50%; box-shadow: 0 0 15px #58a6ff;"></div>
        <div style="position: absolute; top: 50%; left: -6px; transform: translateY(-50%); width: 10px; height: 10px; background: #79c0ff; border-radius: 50%; box-shadow: 0 0 15px #79c0ff;"></div>
        <div style="position: absolute; top: 50%; right: -6px; transform: translateY(-50%); width: 10px; height: 10px; background: #79c0ff; border-radius: 50%; box-shadow: 0 0 15px #79c0ff;"></div>

        <div class="text-[56px] font-bold text-white mb-10 text-center" style="letter-spacing: 5px; text-shadow: 0 0 25px rgba(88, 166, 255, 0.6), 0 0 50px rgba(88, 166, 255, 0.3);">
          谢谢观看
        </div>
        <div class="text-[28px] text-[#58a6ff] text-center" style="letter-spacing: 3px; font-family: 'Arial', sans-serif;">
          期待您的宝贵意见
        </div>

        <!-- 内部连接线装饰 -->
        <svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;">
          <line x1="0" y1="0" x2="30" y2="0" stroke="#58a6ff" stroke-width="1" opacity="0.5"/>
          <line x1="0" y1="0" x2="0" y2="30" stroke="#58a6ff" stroke-width="1" opacity="0.5"/>
          <line x1="100%" y1="0" x2="calc(100% - 30px)" y2="0" stroke="#58a6ff" stroke-width="1" opacity="0.5"/>
          <line x1="100%" y1="0" x2="100%" y2="30" stroke="#58a6ff" stroke-width="1" opacity="0.5"/>
          <line x1="0" y1="100%" x2="30" y2="100%" stroke="#58a6ff" stroke-width="1" opacity="0.5"/>
          <line x1="0" y1="100%" x2="0" y2="calc(100% - 30px)" stroke="#58a6ff" stroke-width="1" opacity="0.5"/>
          <line x1="100%" y1="100%" x2="calc(100% - 30px)" y2="100%" stroke="#58a6ff" stroke-width="1" opacity="0.5"/>
          <line x1="100%" y1="100%" x2="100%" y2="calc(100% - 30px)" stroke="#58a6ff" stroke-width="1" opacity="0.5"/>
        </svg>
      </div>

      <!-- 网络状态指示 -->
      <div style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; font-family: 'Courier New', monospace; font-size: 14px; color: #58a6ff; opacity: 0.7;">
        <div style="width: 8px; height: 8px; background: #58a6ff; border-radius: 50%; box-shadow: 0 0 10px #58a6ff; animation: blink-dot 1s ease-in-out infinite;"></div>
        <span>NETWORK STATUS: CONNECTED</span>
      </div>
    </div>
  </div>

  <style>
    @keyframes flow-particle-1 {
      0%, 100% { transform: translate(0, 0); opacity: 1; }
      50% { transform: translate(180px, 130px); opacity: 0.3; }
    }
    @keyframes flow-particle-2 {
      0%, 100% { transform: translate(0, 0); opacity: 1; }
      50% { transform: translate(-180px, -130px); opacity: 0.3; }
    }
    @keyframes blink-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  </style>
</div>
