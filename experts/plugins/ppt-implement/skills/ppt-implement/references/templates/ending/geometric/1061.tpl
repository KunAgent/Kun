<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
  <!-- 菱形网格背景 -->
  <svg class="absolute top-0 left-0 w-full h-full opacity-[0.12]" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="diamonds" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
        <path d="M40,0 L80,40 L40,80 L0,40 Z" fill="none" stroke="white" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#diamonds)"/>
  </svg>
  
  <!-- 大菱形装饰 -->
  <div class="absolute top-1/2 left-1/2 w-[250px] h-[250px] rotate-45 bg-[rgba(255,255,255,0.08)] border-[3px] border-[rgba(255,255,255,0.25)]" style="transform: translate(-50%, -50%) rotate(45deg);"></div>
  <div class="absolute top-1/2 left-1/2 w-[180px] h-[180px] rotate-45 bg-[rgba(255,255,255,0.06)] border-2 border-[rgba(255,255,255,0.2)]" style="transform: translate(-50%, -50%) rotate(45deg);"></div>
  
  <!-- 内容区域 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col items-center justify-center relative z-[2]">
    <h1 class="text-[56px] font-bold text-white mb-[40px]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,0.2);">谢谢</h1>
    <p class="text-[28px] text-[rgba(255,255,255,0.95)] leading-[1.6]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif;">感谢您的关注与支持</p>
  </div>
  
  <!-- 小菱形装饰 -->
  <div class="absolute top-[12%] left-[8%] w-[50px] h-[50px] rotate-45 bg-[rgba(255,255,255,0.2)]" style="animation: rotate 8s linear infinite;"></div>
  <div class="absolute top-[75%] right-[12%] w-[60px] h-[60px] rotate-45 bg-[rgba(255,255,255,0.15)]" style="animation: rotate 10s linear infinite reverse;"></div>
  <div class="absolute bottom-[10%] left-[15%] w-[45px] h-[45px] rotate-45 bg-[rgba(255,255,255,0.18)]" style="animation: rotate 9s linear infinite;"></div>

  <style>
    @keyframes rotate {
      from { transform: rotate(45deg); }
      to { transform: rotate(405deg); }
    }
  </style>
</div>
