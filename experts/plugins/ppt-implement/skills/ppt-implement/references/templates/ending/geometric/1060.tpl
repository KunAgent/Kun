<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
  <!-- 六边形网格 -->
  <svg class="absolute top-0 left-0 w-full h-full opacity-[0.15]" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="hexagons" x="0" y="0" width="100" height="87" patternUnits="userSpaceOnUse">
        <polygon points="50,0 100,25 100,75 50,100 0,75 0,25" fill="none" stroke="white" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#hexagons)"/>
  </svg>
  
  <!-- 大六边形装饰 -->
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[260px] bg-[rgba(255,255,255,0.1)] border-2 border-[rgba(255,255,255,0.3)]" style="clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);"></div>
  
  <!-- 内容区域 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col items-center justify-center relative z-[2]">
    <h1 class="text-[56px] font-bold text-white mb-[40px]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,0.2);">感谢聆听</h1>
    <p class="text-[28px] text-[rgba(255,255,255,0.95)] leading-[1.6]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif;">期待与您再次相见</p>
  </div>
  
  <!-- 小六边形装饰 -->
  <div class="absolute top-[15%] left-[10%] w-[60px] h-[52px] bg-[rgba(255,255,255,0.2)]" style="clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); animation: pulse 2s ease-in-out infinite;"></div>
  <div class="absolute top-[25%] right-[15%] w-[50px] h-[43px] bg-[rgba(255,255,255,0.25)]" style="clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); animation: pulse 2.5s ease-in-out infinite 0.5s;"></div>
  <div class="absolute bottom-[20%] left-[20%] w-[70px] h-[61px] bg-[rgba(255,255,255,0.18)]" style="clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); animation: pulse 3s ease-in-out infinite 1s;"></div>
  <div class="absolute bottom-[15%] right-[10%] w-[55px] h-[48px] bg-[rgba(255,255,255,0.22)]" style="clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); animation: pulse 2.8s ease-in-out infinite 1.5s;"></div>

  <style>
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.1); }
    }
  </style>
</div>
