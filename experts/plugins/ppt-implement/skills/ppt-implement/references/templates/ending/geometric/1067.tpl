<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%);">
  <!-- 波纹圆环 -->
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150px] h-[150px] rounded-full border-[3px]" style="border-color: rgba(255,255,255,0.4); animation: ripple 3s ease-out infinite;"></div>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150px] h-[150px] rounded-full border-[3px]" style="border-color: rgba(255,255,255,0.35); animation: ripple 3s ease-out infinite 0.5s;"></div>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150px] h-[150px] rounded-full border-[3px]" style="border-color: rgba(255,255,255,0.3); animation: ripple 3s ease-out infinite 1s;"></div>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150px] h-[150px] rounded-full border-[3px]" style="border-color: rgba(255,255,255,0.25); animation: ripple 3s ease-out infinite 1.5s;"></div>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150px] h-[150px] rounded-full border-[3px]" style="border-color: rgba(255,255,255,0.2); animation: ripple 3s ease-out infinite 2s;"></div>
  
  <!-- 中心圆 -->
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120px] h-[120px] rounded-full bg-[rgba(255,255,255,0.15)]" style="animation: pulse-center 2s ease-in-out infinite;"></div>
  
  <!-- 内容区域 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col items-center justify-center relative z-[2]">
    <h1 class="text-[56px] font-bold text-white mb-[40px]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,0.3);">感谢聆听</h1>
    <p class="text-[28px] text-[rgba(255,255,255,0.95)] leading-[1.6]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif;">期待下次再见</p>
  </div>
  
  <!-- 装饰圆点 -->
  <div class="absolute top-[20%] left-[20%] w-[15px] h-[15px] rounded-full bg-[rgba(255,255,255,0.4)]" style="animation: float-dot 3s ease-in-out infinite;"></div>
  <div class="absolute top-[25%] right-[18%] w-[18px] h-[18px] rounded-full bg-[rgba(255,255,255,0.35)]" style="animation: float-dot 3.5s ease-in-out infinite 0.5s;"></div>
  <div class="absolute bottom-[22%] left-[15%] w-[20px] h-[20px] rounded-full bg-[rgba(255,255,255,0.3)]" style="animation: float-dot 4s ease-in-out infinite 1s;"></div>
  <div class="absolute bottom-[18%] right-[22%] w-[16px] h-[16px] rounded-full bg-[rgba(255,255,255,0.38)]" style="animation: float-dot 3.8s ease-in-out infinite 1.5s;"></div>

  <style>
    @keyframes ripple {
      0% { width: 150px; height: 150px; opacity: 1; }
      100% { width: 500px; height: 500px; opacity: 0; }
    }
    @keyframes pulse-center {
      0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.15; }
      50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.25; }
    }
    @keyframes float-dot {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-20px); }
    }
  </style>
</div>
