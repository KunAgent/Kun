<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #f6d365 0%, #fda085 100%);">
  <!-- 放射线 -->
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-[150%] bg-[rgba(255,255,255,0.15)]" style="transform-origin: center;"></div>
  <div class="absolute top-1/2 left-1/2 w-[2px] h-[150%] bg-[rgba(255,255,255,0.12)]" style="transform: translate(-50%, -50%) rotate(30deg); transform-origin: center;"></div>
  <div class="absolute top-1/2 left-1/2 w-[2px] h-[150%] bg-[rgba(255,255,255,0.15)]" style="transform: translate(-50%, -50%) rotate(60deg); transform-origin: center;"></div>
  <div class="absolute top-1/2 left-1/2 w-[2px] h-[150%] bg-[rgba(255,255,255,0.12)]" style="transform: translate(-50%, -50%) rotate(90deg); transform-origin: center;"></div>
  <div class="absolute top-1/2 left-1/2 w-[2px] h-[150%] bg-[rgba(255,255,255,0.15)]" style="transform: translate(-50%, -50%) rotate(120deg); transform-origin: center;"></div>
  <div class="absolute top-1/2 left-1/2 w-[2px] h-[150%] bg-[rgba(255,255,255,0.12)]" style="transform: translate(-50%, -50%) rotate(150deg); transform-origin: center;"></div>
  
  <!-- 星形装饰 -->
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] bg-[rgba(255,255,255,0.15)]" style="clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); animation: rotate 20s linear infinite;"></div>
  
  <!-- 同心圆 -->
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full border-2 border-[rgba(255,255,255,0.25)]"></div>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] h-[250px] rounded-full border-2 border-[rgba(255,255,255,0.2)]"></div>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] rounded-full border-2 border-[rgba(255,255,255,0.15)]"></div>
  
  <!-- 内容区域 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col items-center justify-center relative z-[2]">
    <h1 class="text-[56px] font-bold text-white mb-[40px]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,0.2);">谢谢观看</h1>
    <p class="text-[28px] text-[rgba(255,255,255,0.95)] leading-[1.6]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif;">欢迎提出宝贵建议</p>
  </div>
  
  <!-- 小星星装饰 -->
  <div class="absolute top-[15%] left-[15%] w-[30px] h-[30px] bg-[rgba(255,255,255,0.3)]" style="clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); animation: twinkle 2s ease-in-out infinite;"></div>
  <div class="absolute top-[70%] right-[15%] w-[35px] h-[35px] bg-[rgba(255,255,255,0.35)]" style="clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); animation: twinkle 2.5s ease-in-out infinite 0.5s;"></div>
  <div class="absolute bottom-[10%] left-[20%] w-[28px] h-[28px] bg-[rgba(255,255,255,0.28)]" style="clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); animation: twinkle 3s ease-in-out infinite 1s;"></div>

  <style>
    @keyframes rotate {
      from { transform: translate(-50%, -50%) rotate(0deg); }
      to { transform: translate(-50%, -50%) rotate(360deg); }
    }
    @keyframes twinkle {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
  </style>
</div>
