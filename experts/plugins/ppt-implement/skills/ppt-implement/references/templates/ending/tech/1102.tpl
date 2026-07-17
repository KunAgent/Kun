<div class="w-[1440px] h-[810px] bg-gradient-to-br from-[#0a0e1a] to-[#1c1f2e] relative overflow-hidden">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- HUD圆环装饰 -->
    <svg style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 630px; height: 630px; opacity: 0.4;">
      <circle cx="315" cy="315" r="270" fill="none" stroke="#0f0" stroke-width="2" stroke-dasharray="10,5">
        <animateTransform attributeName="transform" type="rotate" from="0 315 315" to="360 315 315" dur="30s" repeatCount="indefinite"/>
      </circle>
      <circle cx="315" cy="315" r="225" fill="none" stroke="#0ff" stroke-width="1.5" stroke-dasharray="15,10">
        <animateTransform attributeName="transform" type="rotate" from="360 315 315" to="0 315 315" dur="25s" repeatCount="indefinite"/>
      </circle>
      <circle cx="315" cy="315" r="180" fill="none" stroke="#f0f" stroke-width="1" stroke-dasharray="20,15">
        <animateTransform attributeName="transform" type="rotate" from="0 315 315" to="360 315 315" dur="20s" repeatCount="indefinite"/>
      </circle>
    </svg>

    <!-- 准星装饰 -->
    <svg style="position: absolute; width: 100%; height: 100%; opacity: 0.3;">
      <line x1="50%" y1="46%" x2="50%" y2="43%" stroke="#0f0" stroke-width="2"/>
      <line x1="50%" y1="54%" x2="50%" y2="57%" stroke="#0f0" stroke-width="2"/>
      <line x1="46%" y1="50%" x2="43%" y2="50%" stroke="#0f0" stroke-width="2"/>
      <line x1="54%" y1="50%" x2="57%" y2="50%" stroke="#0f0" stroke-width="2"/>
      <circle cx="50%" cy="50%" r="13" fill="none" stroke="#0f0" stroke-width="1.5"/>
      <circle cx="50%" cy="50%" r="7" fill="none" stroke="#0ff" stroke-width="1"/>
    </svg>

    <!-- 角落HUD信息 -->
    <div style="position: absolute; top: 15px; left: 15px; font-family: 'Courier New', monospace; color: #0f0; font-size: 13px; line-height: 1.5; opacity: 0.7;">
      <div>[SYS: ONLINE]</div>
      <div>[PWR: 100%]</div>
      <div>[CONN: STABLE]</div>
    </div>
    <div style="position: absolute; top: 15px; right: 15px; font-family: 'Courier New', monospace; color: #0ff; font-size: 13px; text-align: right; line-height: 1.5; opacity: 0.7;">
      <div>[TIME: 23:59:59]</div>
      <div>[LAT: 39.9042°N]</div>
      <div>[LON: 116.4074°E]</div>
    </div>

    <!-- 底部状态栏 -->
    <div style="position: absolute; bottom: 15px; left: 15px; right: 15px; height: 36px; border: 1px solid rgba(0, 255, 0, 0.3); background: rgba(0, 255, 0, 0.05); display: flex; align-items: center; padding: 0 12px; font-family: 'Courier New', monospace; font-size: 12px; color: #0f0;">
      <div style="flex: 1;">[STATUS: PRESENTATION COMPLETE]</div>
      <div style="width: 180px; height: 7px; background: rgba(0, 255, 0, 0.2); position: relative; margin: 0 12px;">
        <div style="width: 100%; height: 100%; background: #0f0; animation: progress-fill 2s ease-in-out;"></div>
      </div>
      <div>[100%]</div>
    </div>

    <!-- 内容区 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
      <div style="position: relative; padding: 50px 80px; background: rgba(10, 14, 26, 0.85); border: 2px solid #0f0; box-shadow: 0 0 40px rgba(0, 255, 0, 0.3), inset 0 0 20px rgba(0, 255, 0, 0.05); clip-path: polygon(0% 0%, 98% 0%, 100% 2%, 100% 100%, 2% 100%, 0% 98%);">
        
        <!-- 扫描线 -->
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden;">
          <div style="width: 100%; height: 2px; background: linear-gradient(90deg, transparent, #0f0, transparent); animation: scan-hud 3s linear infinite;"></div>
        </div>

        <div class="text-[56px] font-bold text-[#0f0] mb-10 text-center" style="letter-spacing: 7px; text-shadow: 0 0 20px rgba(0, 255, 0, 0.8), 0 0 40px rgba(0, 255, 0, 0.4); font-family: 'Arial', sans-serif;">
          致谢
        </div>
        <div class="text-[26px] text-[#0ff] text-center" style="letter-spacing: 3px; font-family: 'Courier New', monospace;">
          欢迎交流与指导
        </div>

        <!-- 角落标记 -->
        <div style="position: absolute; top: -1px; left: -1px; width: 23px; height: 23px; border-top: 3px solid #0f0; border-left: 3px solid #0f0;"></div>
        <div style="position: absolute; top: -1px; right: -1px; width: 23px; height: 23px; border-top: 3px solid #0f0; border-right: 3px solid #0f0;"></div>
        <div style="position: absolute; bottom: -1px; left: -1px; width: 23px; height: 23px; border-bottom: 3px solid #0f0; border-left: 3px solid #0f0;"></div>
        <div style="position: absolute; bottom: -1px; right: -1px; width: 23px; height: 23px; border-bottom: 3px solid #0f0; border-right: 3px solid #0f0;"></div>
      </div>

      <!-- 浮动指示器 -->
      <div style="position: absolute; top: 22%; left: 10%; width: 45px; height: 45px; border: 2px solid #0ff; transform: rotate(45deg); animation: rotate-indicator 4s linear infinite;"></div>
      <div style="position: absolute; bottom: 25%; right: 12%; width: 38px; height: 38px; border: 2px solid #f0f; transform: rotate(45deg); animation: rotate-indicator 5s linear infinite reverse;"></div>
    </div>
  </div>

  <style>
    @keyframes scan-hud {
      0% { transform: translateY(0); }
      100% { transform: translateY(450px); }
    }
    @keyframes progress-fill {
      0% { width: 0%; }
      100% { width: 100%; }
    }
    @keyframes rotate-indicator {
      0% { transform: rotate(45deg); }
      100% { transform: rotate(405deg); }
    }
  </style>
</div>
