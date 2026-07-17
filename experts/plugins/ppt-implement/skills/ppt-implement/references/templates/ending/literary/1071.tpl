<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #fff5ee 0%, #ffe4e1 100%);">
  <!-- 手绘花卉装饰 -->
  <svg class="absolute top-[50px] left-[50px] w-[200px] h-[200px] opacity-40" xmlns="http://www.w3.org/2000/svg">
    <!-- 花朵1 -->
    <circle cx="60" cy="60" r="15" fill="none" stroke="#e8b4b8" stroke-width="2"/>
    <circle cx="75" cy="50" r="15" fill="none" stroke="#e8b4b8" stroke-width="2"/>
    <circle cx="75" cy="70" r="15" fill="none" stroke="#e8b4b8" stroke-width="2"/>
    <circle cx="45" cy="50" r="15" fill="none" stroke="#e8b4b8" stroke-width="2"/>
    <circle cx="45" cy="70" r="15" fill="none" stroke="#e8b4b8" stroke-width="2"/>
    <circle cx="60" cy="60" r="8" fill="#e8b4b8" opacity="0.3"/>
    <!-- 枝条 -->
    <path d="M60,75 Q55,100 50,130" fill="none" stroke="#c9a896" stroke-width="2"/>
    <path d="M58,85 Q45,95 35,100" fill="none" stroke="#c9a896" stroke-width="1.5"/>
  </svg>
  
  <svg class="absolute bottom-[50px] right-[50px] w-[220px] h-[220px] opacity-40" xmlns="http://www.w3.org/2000/svg">
    <!-- 花朵2 -->
    <circle cx="160" cy="160" r="18" fill="none" stroke="#d4b8c5" stroke-width="2"/>
    <circle cx="180" cy="148" r="18" fill="none" stroke="#d4b8c5" stroke-width="2"/>
    <circle cx="180" cy="172" r="18" fill="none" stroke="#d4b8c5" stroke-width="2"/>
    <circle cx="140" cy="148" r="18" fill="none" stroke="#d4b8c5" stroke-width="2"/>
    <circle cx="140" cy="172" r="18" fill="none" stroke="#d4b8c5" stroke-width="2"/>
    <circle cx="160" cy="160" r="10" fill="#d4b8c5" opacity="0.3"/>
    <!-- 叶子 -->
    <ellipse cx="120" cy="180" rx="20" ry="12" fill="none" stroke="#c9a896" stroke-width="1.5" transform="rotate(-30 120 180)"/>
  </svg>
  
  <!-- 顶部装饰 -->
  <svg class="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[80px] opacity-30" xmlns="http://www.w3.org/2000/svg">
    <path d="M50,50 Q100,20 150,50 T250,50" fill="none" stroke="#d4b8c5" stroke-width="1.5"/>
    <circle cx="150" cy="50" r="4" fill="#d4b8c5"/>
  </svg>
  
  <!-- 内容区域 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col items-center justify-center relative z-[2]">
    <h1 class="text-[56px] font-light text-[#8b6f78] mb-[40px]" style="font-family: 'Georgia', serif;">谢谢</h1>
    <p class="text-[28px] text-[#a68a96] font-light leading-[1.8]" style="font-family: 'Georgia', serif;">感谢您的关注与支持</p>
  </div>
  
  <!-- 小装饰点 -->
  <div class="absolute top-[30%] left-[25%] w-[6px] h-[6px] rounded-full bg-[#e8b4b8]" style="animation: twinkle 2s ease-in-out infinite;"></div>
  <div class="absolute top-[65%] right-[28%] w-[8px] h-[8px] rounded-full bg-[#d4b8c5]" style="animation: twinkle 2.5s ease-in-out infinite 0.5s;"></div>

  <style>
    @keyframes twinkle {
      0%, 100% { opacity: 0.4; transform: scale(1); }
      50% { opacity: 0.8; transform: scale(1.3); }
    }
  </style>
</div>
