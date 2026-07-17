<div class="w-[1440px] h-[810px] relative overflow-hidden bg-[#f9f7f1]">
  <!-- 信纸横线 -->
  <svg class="absolute top-0 left-0 w-full h-full opacity-[0.15]" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="lines" x="0" y="0" width="100%" height="40" patternUnits="userSpaceOnUse">
        <line x1="10%" y1="39" x2="90%" y2="39" stroke="#b8a890" stroke-width="0.5"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#lines)"/>
  </svg>
  
  <!-- 信纸边距 -->
  <div class="absolute top-0 left-[120px] w-[2px] h-full bg-[rgba(220,180,140,0.3)]"></div>
  <div class="absolute top-0 left-[125px] w-[2px] h-full bg-[rgba(220,180,140,0.15)]"></div>
  
  <!-- 邮票装饰 -->
  <div class="absolute top-[60px] right-[80px] w-[100px] h-[120px]" style="background: linear-gradient(135deg, rgba(200,180,160,0.15), rgba(180,160,140,0.2)); border: 8px solid transparent; border-image: repeating-linear-gradient(0deg, #c8b49a 0px, #c8b49a 4px, transparent 4px, transparent 8px) 8; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[40px] opacity-30">✉</div>
  </div>
  
  <!-- 手写体装饰 -->
  <svg class="absolute top-[25%] left-[15%] w-[150px] h-[100px] opacity-[0.12]" xmlns="http://www.w3.org/2000/svg">
    <text x="10" y="30" font-size="18" fill="#8b7355" font-family="'Brush Script MT', cursive">Dear Friend,</text>
    <text x="10" y="60" font-size="16" fill="#8b7355" font-family="'Brush Script MT', cursive">Thank you so much</text>
  </svg>
  
  <!-- 内容区域 -->
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex flex-col items-center justify-center relative z-[2]">
    <h1 class="text-[56px] font-light text-[#6b5d4f] mb-[40px] tracking-[1px]" style="font-family: 'Georgia', serif;">谢谢观看</h1>
    <p class="text-[28px] text-[#8b7355] font-light leading-[2] text-center max-w-[700px]" style="font-family: 'Georgia', serif;">欢迎提出宝贵建议</p>
  </div>
  
  <!-- 签名装饰 -->
  <svg class="absolute bottom-[120px] left-1/2 -translate-x-1/2 w-[180px] h-[60px] opacity-25" xmlns="http://www.w3.org/2000/svg">
    <path d="M20,30 Q40,15 60,28 T100,35 Q120,38 140,25 T170,35" fill="none" stroke="#8b7355" stroke-width="2" stroke-linecap="round"/>
  </svg>
  
  <!-- 爱心装饰 -->
  <div class="absolute bottom-[100px] right-[100px] text-[24px] text-[rgba(200,140,140,0.4)]">♡</div>
</div>
