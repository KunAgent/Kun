<!-- Template: 黑金风-金色光晕 (Ending #1092) -->
<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(to bottom, #000000 0%, #1a1a1a 50%, #000000 100%);">
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative">
    <!-- 中心金色光晕 -->
    <div class="absolute top-1/2 left-1/2 w-[370px] h-[370px] rounded-full" style="transform: translate(-50%, -50%); background: radial-gradient(circle, rgba(255,215,0,0.25) 0%, rgba(212,175,55,0.15) 30%, transparent 70%); filter: blur(28px);"></div>
    
    <!-- 金色光环 -->
    <div class="absolute top-1/2 left-1/2 w-[320px] h-[320px] rounded-full border-2 animate-[pulse-ring_3s_ease-in-out_infinite]" style="transform: translate(-50%, -50%); border-color: rgba(255,215,0,0.3);"></div>
    <div class="absolute top-1/2 left-1/2 w-[270px] h-[270px] rounded-full border animate-[pulse-ring_3s_ease-in-out_infinite_0.5s]" style="transform: translate(-50%, -50%); border-color: rgba(212,175,55,0.25);"></div>
    <div class="absolute top-1/2 left-1/2 w-[220px] h-[220px] rounded-full border animate-[pulse-ring_3s_ease-in-out_infinite_1s]" style="transform: translate(-50%, -50%); border-color: rgba(255,215,0,0.2);"></div>
    
    <!-- 光芒装饰 -->
    <div class="absolute top-1/2 left-1/2 w-0.5 h-[180px] opacity-40" style="transform: translate(-50%, -50%); background: linear-gradient(to bottom, transparent, #ffd700, transparent);"></div>
    <div class="absolute top-1/2 left-1/2 w-0.5 h-[160px] opacity-35" style="transform: translate(-50%, -50%) rotate(45deg); background: linear-gradient(to bottom, transparent, #d4af37, transparent);"></div>
    <div class="absolute top-1/2 left-1/2 w-0.5 h-[180px] opacity-40" style="transform: translate(-50%, -50%) rotate(90deg); background: linear-gradient(to bottom, transparent, #ffd700, transparent);"></div>
    <div class="absolute top-1/2 left-1/2 w-0.5 h-[160px] opacity-35" style="transform: translate(-50%, -50%) rotate(135deg); background: linear-gradient(to bottom, transparent, #d4af37, transparent);"></div>
    
    <!-- 发光粒子 -->
    <div class="absolute top-[18%] left-[23%] w-1.5 h-1.5 rounded-full bg-yellow-400 animate-[float-glow_4s_ease-in-out_infinite]" style="box-shadow: 0 0 15px #ffd700;"></div>
    <div class="absolute top-[68%] right-[26%] w-[5px] h-[5px] rounded-full animate-[float-glow_4.5s_ease-in-out_infinite_1s]" style="background: #d4af37; box-shadow: 0 0 12px #d4af37;"></div>
    <div class="absolute bottom-[23%] left-[28%] w-[7px] h-[7px] rounded-full bg-yellow-400 animate-[float-glow_5s_ease-in-out_infinite_2s]" style="box-shadow: 0 0 18px #ffd700;"></div>
    
    <!-- 内容区域 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
      <div class="text-5xl font-bold text-yellow-400 mb-10 text-center" style="text-shadow: 0 0 30px rgba(255,215,0,0.8), 0 0 15px rgba(255,215,0,0.6), 0 2px 10px rgba(0,0,0,0.8);">致谢</div>
      <div class="text-2xl leading-relaxed font-medium text-center" style="color: #d4af37; text-shadow: 0 0 10px rgba(212,175,55,0.5);">欢迎交流与指导</div>
    </div>
  </div>
</div>

<style>
@keyframes pulse-ring {
  0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.5; transform: translate(-50%, -50%) scale(1.05); }
}
@keyframes float-glow {
  0%, 100% { transform: translateY(0); opacity: 1; }
  50% { transform: translateY(-18px); opacity: 0.6; }
}
</style>
