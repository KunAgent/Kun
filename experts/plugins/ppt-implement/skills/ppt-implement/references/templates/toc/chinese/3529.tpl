<!-- 
模板ID: 3529
模板名称: 中国风-窗格式
适用场景: 古典中国风主题目录页
设计特点: 传统窗格造型,水墨意境,古典美学
-->
<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(180deg, #f7f3e9 0%, #ebe4d4 100%);">
  <!-- 水墨山水背景 -->
  <div class="absolute bottom-0 left-0 w-full h-1/2 opacity-8">
    <svg viewBox="0 0 1440 400" class="w-full h-full">
      <path d="M0,400 Q200,300 400,350 T800,280 T1200,320 T1440,300 L1440,400 Z" fill="#d4cfc4" opacity="0.3"/>
      <path d="M0,400 Q300,320 600,360 T1100,300 T1440,340 L1440,400 Z" fill="#c9c4b9" opacity="0.25"/>
    </svg>
  </div>
  
  <!-- 左上角印章 -->
  <div class="absolute top-8 left-10 w-16 h-16 flex items-center justify-center" style="border: 2px solid #8b2500;">
    <span class="text-2xl font-bold" style="color: #8b2500; font-family: 'KaiTi', 'STKaiti', serif;">录</span>
  </div>
  
  <!-- 右上角装饰纹 -->
  <div class="absolute top-6 right-8 opacity-20">
    <svg width="80" height="80" viewBox="0 0 80 80">
      <circle cx="40" cy="40" r="35" stroke="#8b4513" stroke-width="1" fill="none"/>
      <circle cx="40" cy="40" r="25" stroke="#8b4513" stroke-width="1" fill="none"/>
      <path d="M40,5 Q60,40 40,75 Q20,40 40,5" stroke="#8b4513" stroke-width="1" fill="none"/>
    </svg>
  </div>

  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative z-10 flex">
    <!-- 左侧标题区 -->
    <div class="w-1/4 flex flex-col items-center justify-center pr-8" style="border-right: 1px solid #c9b896;">
      <div class="writing-vertical text-center">
        <span class="text-6xl font-light tracking-widest" style="color: #4a3728; font-family: 'KaiTi', 'STKaiti', serif; writing-mode: vertical-rl;">目录</span>
      </div>
      <div class="mt-8 w-px h-20" style="background: linear-gradient(to bottom, transparent, #8b4513, transparent);"></div>
      <span class="mt-4 text-xs tracking-[0.3em]" style="color: #9c8b7a;">CONTENTS</span>
    </div>
    
    <!-- 右侧章节 - 古典窗格布局 -->
    <div class="w-3/4 pl-12 flex items-center">
      <div class="grid grid-cols-2 gap-6 w-full">
        <!-- 章节卡片 - 古典窗格样式 -->
        <div class="group cursor-pointer relative" style="background: rgba(255,252,245,0.7); border: 1px solid #c9b896; padding: 24px;">
          <!-- 角花装饰 -->
          <div class="absolute top-0 left-0 w-4 h-4" style="border-top: 2px solid #8b4513; border-left: 2px solid #8b4513;"></div>
          <div class="absolute top-0 right-0 w-4 h-4" style="border-top: 2px solid #8b4513; border-right: 2px solid #8b4513;"></div>
          <div class="absolute bottom-0 left-0 w-4 h-4" style="border-bottom: 2px solid #8b4513; border-left: 2px solid #8b4513;"></div>
          <div class="absolute bottom-0 right-0 w-4 h-4" style="border-bottom: 2px solid #8b4513; border-right: 2px solid #8b4513;"></div>
          
          <div class="flex items-center gap-5">
            <span class="text-4xl font-light" style="color: #c9b896; font-family: 'KaiTi', 'STKaiti', serif;">壹</span>
            <div class="flex-1">
              <h3 class="text-xl font-medium mb-1" style="color: #4a3728; font-family: 'KaiTi', 'STKaiti', serif;">项目背景</h3>
              <div class="w-12 h-px group-hover:w-full transition-all duration-500" style="background: #8b4513;"></div>
            </div>
          </div>
        </div>

        <div class="group cursor-pointer relative" style="background: rgba(255,252,245,0.7); border: 1px solid #c9b896; padding: 24px;">
          <div class="absolute top-0 left-0 w-4 h-4" style="border-top: 2px solid #8b4513; border-left: 2px solid #8b4513;"></div>
          <div class="absolute top-0 right-0 w-4 h-4" style="border-top: 2px solid #8b4513; border-right: 2px solid #8b4513;"></div>
          <div class="absolute bottom-0 left-0 w-4 h-4" style="border-bottom: 2px solid #8b4513; border-left: 2px solid #8b4513;"></div>
          <div class="absolute bottom-0 right-0 w-4 h-4" style="border-bottom: 2px solid #8b4513; border-right: 2px solid #8b4513;"></div>
          
          <div class="flex items-center gap-5">
            <span class="text-4xl font-light" style="color: #c9b896; font-family: 'KaiTi', 'STKaiti', serif;">贰</span>
            <div class="flex-1">
              <h3 class="text-xl font-medium mb-1" style="color: #4a3728; font-family: 'KaiTi', 'STKaiti', serif;">核心功能</h3>
              <div class="w-12 h-px group-hover:w-full transition-all duration-500" style="background: #8b4513;"></div>
            </div>
          </div>
        </div>

        <div class="group cursor-pointer relative" style="background: rgba(255,252,245,0.7); border: 1px solid #c9b896; padding: 24px;">
          <div class="absolute top-0 left-0 w-4 h-4" style="border-top: 2px solid #8b4513; border-left: 2px solid #8b4513;"></div>
          <div class="absolute top-0 right-0 w-4 h-4" style="border-top: 2px solid #8b4513; border-right: 2px solid #8b4513;"></div>
          <div class="absolute bottom-0 left-0 w-4 h-4" style="border-bottom: 2px solid #8b4513; border-left: 2px solid #8b4513;"></div>
          <div class="absolute bottom-0 right-0 w-4 h-4" style="border-bottom: 2px solid #8b4513; border-right: 2px solid #8b4513;"></div>
          
          <div class="flex items-center gap-5">
            <span class="text-4xl font-light" style="color: #c9b896; font-family: 'KaiTi', 'STKaiti', serif;">叁</span>
            <div class="flex-1">
              <h3 class="text-xl font-medium mb-1" style="color: #4a3728; font-family: 'KaiTi', 'STKaiti', serif;">技术架构</h3>
              <div class="w-12 h-px group-hover:w-full transition-all duration-500" style="background: #8b4513;"></div>
            </div>
          </div>
        </div>

        <div class="group cursor-pointer relative" style="background: rgba(255,252,245,0.7); border: 1px solid #c9b896; padding: 24px;">
          <div class="absolute top-0 left-0 w-4 h-4" style="border-top: 2px solid #8b4513; border-left: 2px solid #8b4513;"></div>
          <div class="absolute top-0 right-0 w-4 h-4" style="border-top: 2px solid #8b4513; border-right: 2px solid #8b4513;"></div>
          <div class="absolute bottom-0 left-0 w-4 h-4" style="border-bottom: 2px solid #8b4513; border-left: 2px solid #8b4513;"></div>
          <div class="absolute bottom-0 right-0 w-4 h-4" style="border-bottom: 2px solid #8b4513; border-right: 2px solid #8b4513;"></div>
          
          <div class="flex items-center gap-5">
            <span class="text-4xl font-light" style="color: #c9b896; font-family: 'KaiTi', 'STKaiti', serif;">肆</span>
            <div class="flex-1">
              <h3 class="text-xl font-medium mb-1" style="color: #4a3728; font-family: 'KaiTi', 'STKaiti', serif;">实施计划</h3>
              <div class="w-12 h-px group-hover:w-full transition-all duration-500" style="background: #8b4513;"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- 底部装饰线 -->
  <div class="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-4">
    <div class="w-24 h-px" style="background: linear-gradient(to right, transparent, #8b4513);"></div>
    <div class="w-2 h-2 rotate-45" style="border: 1px solid #8b4513;"></div>
    <div class="w-24 h-px" style="background: linear-gradient(to left, transparent, #8b4513);"></div>
  </div>
</div>
