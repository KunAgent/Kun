<div class="w-[1440px] h-[810px] bg-gradient-to-b from-[#0a0a0a] via-[#1a1a1a] to-[#0a0a0a] relative overflow-hidden">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- 皇冠装饰 -->
    <svg style="position: absolute; top: 70px; left: 50%; transform: translateX(-50%); width: 180px; height: 135px; opacity: 0.7;" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="crown-gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#ffd700;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#d4af37;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#ffd700;stop-opacity:1" />
        </linearGradient>
      </defs>
      <!-- 皇冠主体 -->
      <polygon points="18,90 36,45 54,72 72,36 90,72 108,45 126,90 162,108 90,117 18,108" fill="url(#crown-gold)" stroke="#b8860b" stroke-width="2"/>
      <!-- 顶部尖峰 -->
      <polygon points="36,45 31,27 36,18 41,27" fill="#ffd700"/>
      <polygon points="72,36 67,13 72,4 77,13" fill="#ffd700"/>
      <polygon points="108,45 103,27 108,18 113,27" fill="#ffd700"/>
      <!-- 宝石装饰 -->
      <circle cx="36" cy="63" r="4.5" fill="#ff6b6b"/>
      <circle cx="72" cy="58" r="5.5" fill="#ff6b6b"/>
      <circle cx="108" cy="63" r="4.5" fill="#ff6b6b"/>
    </svg>
    
    <!-- 装饰花纹 -->
    <svg style="position: absolute; top: 50%; left: 12%; width: 90px; height: 135px; opacity: 0.4;" xmlns="http://www.w3.org/2000/svg">
      <path d="M45,18 Q27,45 45,72 T45,126" fill="none" stroke="#d4af37" stroke-width="2"/>
      <circle cx="45" cy="18" r="7" fill="#ffd700"/>
      <circle cx="45" cy="72" r="5.5" fill="#d4af37"/>
      <circle cx="45" cy="126" r="7" fill="#ffd700"/>
    </svg>
    
    <svg style="position: absolute; top: 50%; right: 12%; width: 90px; height: 135px; opacity: 0.4;" xmlns="http://www.w3.org/2000/svg">
      <path d="M45,18 Q63,45 45,72 T45,126" fill="none" stroke="#d4af37" stroke-width="2"/>
      <circle cx="45" cy="18" r="7" fill="#ffd700"/>
      <circle cx="45" cy="72" r="5.5" fill="#d4af37"/>
      <circle cx="45" cy="126" r="7" fill="#ffd700"/>
    </svg>
    
    <!-- 金色光芒 -->
    <div style="position: absolute; top: 70px; left: 50%; transform: translateX(-50%); width: 270px; height: 2px; background: linear-gradient(90deg, transparent, #ffd700, transparent); opacity: 0.5;"></div>
    <div style="position: absolute; top: 80px; left: 50%; transform: translateX(-50%) rotate(20deg); width: 225px; height: 1px; background: linear-gradient(90deg, transparent, #d4af37, transparent); opacity: 0.4;"></div>
    <div style="position: absolute; top: 80px; left: 50%; transform: translateX(-50%) rotate(-20deg); width: 225px; height: 1px; background: linear-gradient(90deg, transparent, #d4af37, transparent); opacity: 0.4;"></div>
    
    <!-- 底部装饰线 -->
    <div style="position: absolute; bottom: 70px; left: 50%; transform: translateX(-50%); width: 360px; height: 2px; background: linear-gradient(90deg, transparent, #ffd700, transparent); opacity: 0.6;"></div>
    
    <!-- 金色粒子 -->
    <div style="position: absolute; top: 22%; left: 22%; width: 5px; height: 5px; border-radius: 50%; background: #ffd700; box-shadow: 0 0 15px #ffd700; animation: sparkle-crown 2s ease-in-out infinite;"></div>
    <div style="position: absolute; top: 27%; right: 25%; width: 6px; height: 6px; border-radius: 50%; background: #d4af37; box-shadow: 0 0 12px #d4af37; animation: sparkle-crown 2.5s ease-in-out infinite 0.5s;"></div>
    <div style="position: absolute; bottom: 22%; left: 27%; width: 4px; height: 4px; border-radius: 50%; background: #ffd700; box-shadow: 0 0 10px #ffd700; animation: sparkle-crown 3s ease-in-out infinite 1s;"></div>
    <div style="position: absolute; bottom: 27%; right: 29%; width: 5px; height: 5px; border-radius: 50%; background: #daa520; box-shadow: 0 0 12px #daa520; animation: sparkle-crown 2.8s ease-in-out infinite 1.5s;"></div>
    
    <!-- 内容区 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]" style="padding-top: 180px;">
      <div class="text-[56px] font-bold text-[#ffd700] mb-12" style="text-shadow: 0 0 30px rgba(255,215,0,0.8), 0 2px 10px rgba(0,0,0,0.8); letter-spacing: 3px;">
        谢谢
      </div>
      <div class="text-[28px] text-[#d4af37] text-center leading-relaxed font-medium">
        感谢您的耐心聆听
      </div>
    </div>
  </div>
</div>

<style>
@keyframes sparkle-crown {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(1.4); }
}
</style>
