<!-- Template: 卡通风-彩虹告别 (Ending #1039) -->
<div class="w-[1440px] h-[810px] relative overflow-hidden bg-gradient-to-b from-[#e0f7ff] to-[#fff5e0]">
  <!-- 彩虹装饰 -->
  <div class="absolute -top-[15%] left-1/2 -translate-x-1/2 w-[140%]">
    <div class="w-full h-[300px]" style="background: radial-gradient(ellipse at 50% 100%, transparent 35%, rgba(255, 107, 107, 0.4) 35%, rgba(255, 107, 107, 0.4) 38%, transparent 38%), radial-gradient(ellipse at 50% 100%, transparent 40%, rgba(255, 179, 71, 0.4) 40%, rgba(255, 179, 71, 0.4) 43%, transparent 43%), radial-gradient(ellipse at 50% 100%, transparent 45%, rgba(255, 234, 92, 0.4) 45%, rgba(255, 234, 92, 0.4) 48%, transparent 48%), radial-gradient(ellipse at 50% 100%, transparent 50%, rgba(119, 221, 119, 0.4) 50%, rgba(119, 221, 119, 0.4) 53%, transparent 53%), radial-gradient(ellipse at 50% 100%, transparent 55%, rgba(102, 204, 255, 0.4) 55%, rgba(102, 204, 255, 0.4) 58%, transparent 58%), radial-gradient(ellipse at 50% 100%, transparent 60%, rgba(179, 136, 255, 0.4) 60%, rgba(179, 136, 255, 0.4) 63%, transparent 63%);"></div>
  </div>

  <!-- 云朵装饰 - 左 -->
  <div class="absolute top-[15%] left-[10%] flex -gap-[15px]">
    <div class="w-[50px] h-[50px] bg-white rounded-full shadow-md"></div>
    <div class="w-[70px] h-[70px] bg-white rounded-full shadow-md -mt-[10px]"></div>
    <div class="w-[50px] h-[50px] bg-white rounded-full shadow-md"></div>
  </div>

  <!-- 云朵装饰 - 右 -->
  <div class="absolute top-[20%] right-[12%] flex -gap-[10px]">
    <div class="w-[40px] h-[40px] bg-white rounded-full shadow-md"></div>
    <div class="w-[55px] h-[55px] bg-white rounded-full shadow-md -mt-[8px]"></div>
    <div class="w-[40px] h-[40px] bg-white rounded-full shadow-md"></div>
  </div>

  <!-- 星星装饰 -->
  <div class="absolute bottom-[20%] left-[15%] text-[40px] text-[#ffea5c] -rotate-[15deg] animate-twinkle">⭐</div>
  <div class="absolute bottom-[25%] right-[18%] text-[35px] text-[#ffea5c] rotate-[15deg] animate-twinkle-slow">⭐</div>

  <!-- 主要内容区域 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col justify-center">
    <div class="text-center max-w-[75%] mx-auto" style="margin-top: 20px;">
      <h1 class="text-[68px] text-[#ff6b6b] mb-10 font-bold" style="font-family: 'Comic Sans MS', 'Arial Rounded MT Bold', sans-serif; text-shadow: 3px 3px 0 rgba(255, 107, 107, 0.2);">谢谢观看</h1>
      
      <div class="flex items-center justify-center gap-3 mb-9">
        <div class="w-[16px] h-[16px] bg-[#ff6b6b] rounded-full"></div>
        <div class="w-[16px] h-[16px] bg-[#ffb347] rounded-full"></div>
        <div class="w-[16px] h-[16px] bg-[#ffea5c] rounded-full"></div>
        <div class="w-[16px] h-[16px] bg-[#77dd77] rounded-full"></div>
        <div class="w-[16px] h-[16px] bg-[#66ccff] rounded-full"></div>
      </div>
      
      <p class="text-[24px] text-gray-600 leading-relaxed font-semibold" style="font-family: 'Comic Sans MS', 'Arial Rounded MT Bold', sans-serif;">感谢您的聆听</p>
    </div>
  </div>

  <style>
    @keyframes twinkle {
      0%, 100% { opacity: 1; transform: scale(1) rotate(-15deg); }
      50% { opacity: 0.6; transform: scale(1.2) rotate(-15deg); }
    }
    .animate-twinkle {
      animation: twinkle 2s ease-in-out infinite;
    }
    .animate-twinkle-slow {
      animation: twinkle 2.5s ease-in-out infinite;
    }
  </style>
</div>
