<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);">
  <!-- 箭头装饰 -->
  <div class="absolute top-[15%] left-[10%] w-[80px] h-[60px] rotate-45 bg-[rgba(255,255,255,0.2)]" style="clip-path: polygon(0% 50%, 60% 50%, 60% 0%, 100% 50%, 60% 100%, 60% 50%); animation: arrow-move 2s ease-in-out infinite;"></div>
  
  <div class="absolute top-1/2 right-[8%] w-[90px] h-[70px] -rotate-90 bg-[rgba(255,255,255,0.18)]" style="clip-path: polygon(0% 50%, 60% 50%, 60% 0%, 100% 50%, 60% 100%, 60% 50%); animation: arrow-move 2.5s ease-in-out infinite 0.5s;"></div>
  
  <div class="absolute bottom-[12%] left-[15%] w-[85px] h-[65px] rotate-[135deg] bg-[rgba(255,255,255,0.22)]" style="clip-path: polygon(0% 50%, 60% 50%, 60% 0%, 100% 50%, 60% 100%, 60% 50%); animation: arrow-move 3s ease-in-out infinite 1s;"></div>
  
  <div class="absolute bottom-[18%] right-[12%] w-[75px] h-[55px] rotate-[225deg] bg-[rgba(255,255,255,0.15)]" style="clip-path: polygon(0% 50%, 60% 50%, 60% 0%, 100% 50%, 60% 100%, 60% 50%); animation: arrow-move 2.8s ease-in-out infinite 1.5s;"></div>
  
  <!-- 中心几何框 -->
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[280px] border-[3px] border-[rgba(255,255,255,0.35)] bg-[rgba(255,255,255,0.05)]"></div>
  <div class="absolute top-1/2 left-1/2 w-[250px] h-[250px] rotate-45 border-2 border-[rgba(255,255,255,0.25)]" style="transform: translate(-50%, -50%) rotate(45deg);"></div>
  
  <!-- 内容区域 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col items-center justify-center relative z-[2]">
    <h1 class="text-[56px] font-bold text-white mb-[40px]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,0.2);">谢谢</h1>
    <p class="text-[28px] text-[rgba(255,255,255,0.95)] leading-[1.6]" style="font-family: 'Arial', 'Microsoft YaHei', sans-serif;">感谢您的耐心聆听</p>
  </div>
  
  <!-- 小箭头指示 -->
  <div class="absolute top-[30%] left-[25%] w-[40px] h-[30px] bg-[rgba(255,255,255,0.3)]" style="clip-path: polygon(0% 50%, 60% 50%, 60% 0%, 100% 50%, 60% 100%, 60% 50%); animation: pulse-arrow 2s ease-in-out infinite;"></div>
  <div class="absolute top-[60%] right-[28%] w-[45px] h-[35px] bg-[rgba(255,255,255,0.28)]" style="clip-path: polygon(0% 50%, 60% 50%, 60% 0%, 100% 50%, 60% 100%, 60% 50%); animation: pulse-arrow 2.3s ease-in-out infinite 0.6s;"></div>

  <style>
    @keyframes arrow-move {
      0%, 100% { transform: translateX(0) translateY(0); }
      50% { transform: translateX(-10px) translateY(-10px); }
    }
    @keyframes pulse-arrow {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.15); }
    }
  </style>
</div>
