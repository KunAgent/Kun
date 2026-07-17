<!-- Template: 黑金风-金色旋涡 (Ending #1097) -->
<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: radial-gradient(circle at 30% 40%, #1a1a2e 0%, #000000 100%);">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- 金色旋涡装饰 -->
    <svg class="absolute top-1/2 left-1/2 w-[550px] h-[550px] opacity-30" style="transform: translate(-50%, -50%);" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="spiral-gold-1097" cx="50%" cy="50%">
          <stop offset="0%" style="stop-color:#ffd700;stop-opacity:0.8" />
          <stop offset="50%" style="stop-color:#d4af37;stop-opacity:0.5" />
          <stop offset="100%" style="stop-color:#daa520;stop-opacity:0" />
        </radialGradient>
      </defs>
      <circle cx="275" cy="275" r="230" fill="none" stroke="url(#spiral-gold-1097)" stroke-width="2" opacity="0.8"/>
      <circle cx="275" cy="275" r="200" fill="none" stroke="url(#spiral-gold-1097)" stroke-width="2" opacity="0.7"/>
      <circle cx="275" cy="275" r="170" fill="none" stroke="url(#spiral-gold-1097)" stroke-width="2" opacity="0.6"/>
      <circle cx="275" cy="275" r="140" fill="none" stroke="url(#spiral-gold-1097)" stroke-width="2" opacity="0.5"/>
      <circle cx="275" cy="275" r="110" fill="none" stroke="url(#spiral-gold-1097)" stroke-width="2" opacity="0.4"/>
      <circle cx="275" cy="275" r="80" fill="none" stroke="url(#spiral-gold-1097)" stroke-width="2" opacity="0.3"/>
    </svg>
    
    <!-- 旋转螺旋线 -->
    <div class="absolute top-1/2 left-1/2 w-[360px] h-[360px] rounded-full border-2 border-yellow-400/30 animate-[spiral-rotate_8s_linear_infinite]" style="transform: translate(-50%, -50%); border-top-color: rgba(255,215,0,0.7);"></div>
    <div class="absolute top-1/2 left-1/2 w-[310px] h-[310px] rounded-full border-2 animate-[spiral-rotate_10s_linear_infinite_reverse]" style="transform: translate(-50%, -50%); border-color: rgba(212,175,55,0.25); border-top-color: rgba(212,175,55,0.6);"></div>
    <div class="absolute top-1/2 left-1/2 w-[260px] h-[260px] rounded-full border-2 animate-[spiral-rotate_12s_linear_infinite]" style="transform: translate(-50%, -50%); border-color: rgba(255,215,0,0.2); border-top-color: rgba(255,215,0,0.5);"></div>
    
    <!-- 中心光点 -->
    <div class="absolute top-1/2 left-1/2 w-20 h-20 rounded-full animate-[center-pulse_2s_ease-in-out_infinite]" style="transform: translate(-50%, -50%); background: radial-gradient(circle, rgba(255,215,0,0.6), transparent);"></div>
    
    <!-- 金色光线 -->
    <div class="absolute top-1/2 left-1/2 w-[280px] h-0.5 animate-[ray-rotate_6s_linear_infinite]" style="transform: translate(-50%, -50%) rotate(0deg); background: linear-gradient(90deg, rgba(255,215,0,0.6), transparent);"></div>
    <div class="absolute top-1/2 left-1/2 w-[260px] h-0.5 animate-[ray-rotate_6s_linear_infinite]" style="transform: translate(-50%, -50%) rotate(60deg); background: linear-gradient(90deg, rgba(212,175,55,0.5), transparent);"></div>
    <div class="absolute top-1/2 left-1/2 w-[280px] h-0.5 animate-[ray-rotate_6s_linear_infinite]" style="transform: translate(-50%, -50%) rotate(120deg); background: linear-gradient(90deg, rgba(255,215,0,0.6), transparent);"></div>
    
    <!-- 内容区域 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
      <div class="text-5xl font-bold text-yellow-400 mb-10 text-center" style="text-shadow: 0 0 30px rgba(255,215,0,0.9), 0 0 15px rgba(255,215,0,0.6), 0 2px 10px rgba(0,0,0,0.8);">感谢聆听</div>
      <div class="text-2xl leading-relaxed font-medium text-center" style="color: #d4af37; text-shadow: 0 0 10px rgba(212,175,55,0.6);">期待下次再见</div>
    </div>
  </div>
</div>

<style>
@keyframes spiral-rotate {
  from { transform: translate(-50%, -50%) rotate(0deg); }
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
@keyframes ray-rotate {
  from { transform: translate(-50%, -50%) rotate(0deg); }
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
@keyframes center-pulse {
  0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.6; transform: translate(-50%, -50%) scale(1.2); }
}
</style>
