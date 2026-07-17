<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
  <!-- 三角形装饰 -->
  <div class="absolute top-0 left-0 w-0 h-0" style="border-left: 300px solid transparent; border-top: 300px solid rgba(255,255,255,0.1);"></div>
  <div class="absolute top-0 right-0 w-0 h-0" style="border-right: 250px solid transparent; border-top: 250px solid rgba(255,255,255,0.15);"></div>
  <div class="absolute bottom-0 left-0 w-0 h-0" style="border-left: 200px solid transparent; border-bottom: 200px solid rgba(255,255,255,0.12);"></div>
  <div class="absolute bottom-0 right-0 w-0 h-0" style="border-right: 280px solid transparent; border-bottom: 280px solid rgba(255,255,255,0.08);"></div>
  
  <!-- 中心三角形 -->
  <div class="absolute top-1/2 left-1/2 w-[150px] h-[150px] border-[3px] border-[rgba(255,255,255,0.3)]" style="transform: translate(-50%, -50%) rotate(30deg);"></div>
  <div class="absolute top-1/2 left-1/2 w-[150px] h-[150px] bg-[rgba(255,255,255,0.1)]" style="transform: translate(-50%, -50%) rotate(30deg); clip-path: polygon(50% 0%, 0% 100%, 100% 100%);"></div>
  
  <!-- 内容区域 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col items-center justify-center relative z-[2]">
    <h1 class="text-[56px] font-bold text-white mb-[40px]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,0.2);">谢谢观看</h1>
    <p class="text-[28px] text-[rgba(255,255,255,0.95)] leading-[1.6]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif;">感谢您的聆听</p>
  </div>
  
  <!-- 小三角形装饰 -->
  <div class="absolute top-[20%] left-[15%] w-[40px] h-[40px] bg-[rgba(255,255,255,0.2)]" style="clip-path: polygon(50% 0%, 0% 100%, 100% 100%); animation: float 3s ease-in-out infinite;"></div>
  <div class="absolute top-[70%] right-[20%] w-[50px] h-[50px] bg-[rgba(255,255,255,0.15)]" style="clip-path: polygon(50% 0%, 0% 100%, 100% 100%); animation: float 4s ease-in-out infinite 1s;"></div>

  <style>
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-20px); }
    }
  </style>
</div>
