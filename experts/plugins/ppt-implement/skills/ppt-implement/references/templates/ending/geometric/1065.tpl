<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
  <!-- 立方体透视网格 -->
  <svg class="absolute top-0 left-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="isometric" x="0" y="0" width="60" height="104" patternUnits="userSpaceOnUse" patternTransform="scale(1.5)">
        <path d="M30,0 L60,17 L60,52 L30,69 L0,52 L0,17 Z" fill="none" stroke="white" stroke-width="0.5"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#isometric)"/>
  </svg>
  
  <!-- 3D立方体装饰 -->
  <div class="absolute top-[15%] left-[10%] w-[100px] h-[100px]" style="transform-style: preserve-3d; transform: rotateX(30deg) rotateY(45deg); animation: rotate3d 8s linear infinite;">
    <div class="absolute w-[100px] h-[100px] bg-[rgba(255,255,255,0.15)]" style="transform: translateZ(50px);"></div>
    <div class="absolute w-[100px] h-[100px] bg-[rgba(255,255,255,0.1)]" style="transform: rotateY(90deg) translateZ(50px);"></div>
    <div class="absolute w-[100px] h-[100px] bg-[rgba(255,255,255,0.08)]" style="transform: rotateX(90deg) translateZ(50px);"></div>
  </div>
  
  <div class="absolute bottom-[20%] right-[12%] w-[120px] h-[120px]" style="transform-style: preserve-3d; transform: rotateX(-30deg) rotateY(-45deg); animation: rotate3d 10s linear infinite reverse;">
    <div class="absolute w-[120px] h-[120px] bg-[rgba(255,255,255,0.12)]" style="transform: translateZ(60px);"></div>
    <div class="absolute w-[120px] h-[120px] bg-[rgba(255,255,255,0.08)]" style="transform: rotateY(90deg) translateZ(60px);"></div>
    <div class="absolute w-[120px] h-[120px] bg-[rgba(255,255,255,0.06)]" style="transform: rotateX(90deg) translateZ(60px);"></div>
  </div>
  
  <!-- 中心框架 -->
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[250px] border-[3px] border-[rgba(255,255,255,0.3)]" style="perspective: 800px;">
    <div class="absolute top-0 left-0 w-full h-full border-2 border-[rgba(255,255,255,0.2)]" style="transform: translateZ(20px);"></div>
  </div>
  
  <!-- 内容区域 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col items-center justify-center relative z-[2]">
    <h1 class="text-[56px] font-bold text-white mb-[40px]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,0.3);">谢谢</h1>
    <p class="text-[28px] text-[rgba(255,255,255,0.95)] leading-[1.6]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif;">感谢您的宝贵时间</p>
  </div>

  <style>
    @keyframes rotate3d {
      from { transform: rotateX(30deg) rotateY(45deg); }
      to { transform: rotateX(30deg) rotateY(405deg); }
    }
  </style>
</div>
