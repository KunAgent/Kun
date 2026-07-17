<!-- Template: 中国风-水墨山水 (Cover #009) -->
<div class="cover-wrapper relative w-[1440px] h-[810px] overflow-hidden" style="background: linear-gradient(180deg, #f5f3ed 0%, #e8e4d9 100%);">
  <!-- 水墨晕染效果 -->
  <div class="absolute top-0 left-0 w-full h-full">
    <div class="absolute top-10 right-20 w-64 h-64 opacity-8" style="background: radial-gradient(ellipse, #4a5568 0%, transparent 70%); filter: blur(40px);"></div>
    <div class="absolute top-40 left-10 w-40 h-40 opacity-6" style="background: radial-gradient(ellipse, #4a5568 0%, transparent 70%); filter: blur(30px);"></div>
  </div>
  
  <!-- 远山层叠 -->
  <svg class="absolute bottom-0 left-0 w-full h-80" viewBox="0 0 1440 320" preserveAspectRatio="none">
    <!-- 最远的山 -->
    <path d="M0 320 L0 220 Q200 140 400 180 Q600 220 800 160 Q1000 100 1200 150 Q1350 190 1440 170 L1440 320 Z" fill="#c4c7cc" opacity="0.3"/>
    <!-- 中间的山 -->
    <path d="M0 320 L0 250 Q150 180 300 210 Q500 250 700 190 Q900 130 1100 180 Q1300 230 1440 200 L1440 320 Z" fill="#9ca3af" opacity="0.4"/>
    <!-- 最近的山 -->
    <path d="M0 320 L0 280 Q180 230 360 260 Q540 290 720 240 Q900 190 1080 230 Q1260 270 1440 250 L1440 320 Z" fill="#6b7280" opacity="0.5"/>
  </svg>
  
  <!-- 飞鸟点缀 -->
  <svg class="absolute top-24 left-1/3 w-40 h-20 opacity-40" viewBox="0 0 160 80">
    <path d="M20 40 Q30 30 40 40 Q50 30 60 40" stroke="#374151" stroke-width="2" fill="none"/>
    <path d="M70 35 Q78 27 86 35 Q94 27 102 35" stroke="#374151" stroke-width="1.5" fill="none"/>
    <path d="M110 45 Q116 39 122 45 Q128 39 134 45" stroke="#374151" stroke-width="1" fill="none"/>
  </svg>
  
  <!-- 竹子装饰 - 左侧 -->
  <div class="absolute left-16 top-0 bottom-0 flex gap-4 opacity-20">
    <div class="w-3 h-full" style="background: linear-gradient(180deg, #3d5a3a 0%, #2d4a2a 100%);"></div>
    <div class="w-2 h-4/5 mt-20" style="background: linear-gradient(180deg, #4a6b4a 0%, #3d5a3a 100%);"></div>
  </div>
  
  <!-- 主内容区域 -->
  <div class="absolute inset-0 flex items-center justify-center">
    <div class="text-center relative z-10">
      <!-- 印章装饰 -->
      <div class="absolute -top-20 -right-24 w-14 h-14 flex items-center justify-center opacity-70 rotate-12" style="border: 2px solid #b91c1c;">
        <span class="text-lg" style="font-family: 'STKaiti', serif; color: #b91c1c;">印</span>
      </div>
      
      <!-- 主标题 -->
      <h1 class="text-7xl tracking-[12px] mb-6" style="font-family: 'STKaiti', 'KaiTi', serif; color: #1f2937;">演示标题</h1>
      
      <!-- 装饰线 -->
      <div class="flex items-center justify-center gap-4 mb-6">
        <div class="w-16 h-px" style="background: linear-gradient(90deg, transparent, #6b7280);"></div>
        <div class="w-2 h-2 rounded-full bg-gray-500"></div>
        <div class="w-16 h-px" style="background: linear-gradient(90deg, #6b7280, transparent);"></div>
      </div>
      
      <!-- 副标题 -->
      <p class="text-2xl tracking-[6px]" style="font-family: 'STKaiti', serif; color: #4b5563;">副标题文字</p>
      
      <!-- 底部信息 -->
      <div class="mt-16 text-base tracking-widest" style="color: #6b7280;">
        <span style="font-family: 'STKaiti', serif;">汇报人：张三</span>
        <span class="mx-4">|</span>
        <span style="font-family: 'STKaiti', serif;">二〇二五年</span>
      </div>
    </div>
  </div>
  
  <!-- 右下角落款 -->
  <div class="absolute bottom-8 right-12 opacity-50">
    <div class="text-sm tracking-wider" style="font-family: 'STKaiti', serif; color: #6b7280; writing-mode: vertical-rl;">山水有清音</div>
  </div>
</div>
