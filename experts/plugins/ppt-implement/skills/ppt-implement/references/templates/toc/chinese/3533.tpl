<!-- 
模板ID: 3533
模板名称: 中国风-水墨书卷
适用场景: 古典中国风主题目录页
设计特点: 水墨意境,书卷气韵,淡雅留白
-->
<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(180deg, #faf8f5 0%, #f0ebe3 100%);">
  <!-- 水墨晕染背景 -->
  <div class="absolute top-0 right-0 w-1/2 h-full opacity-8">
    <svg viewBox="0 0 600 810" class="w-full h-full">
      <ellipse cx="400" cy="200" rx="250" ry="150" fill="#e8e4dc" opacity="0.5"/>
      <ellipse cx="350" cy="500" rx="200" ry="120" fill="#ddd8ce" opacity="0.4"/>
      <ellipse cx="450" cy="700" rx="180" ry="100" fill="#d5d0c6" opacity="0.3"/>
    </svg>
  </div>
  
  <!-- 远山剪影 -->
  <div class="absolute bottom-0 left-0 right-0 h-48 opacity-10">
    <svg viewBox="0 0 1440 200" preserveAspectRatio="none" class="w-full h-full">
      <path d="M0,200 Q120,120 240,160 T480,100 T720,140 T960,80 T1200,120 T1440,90 L1440,200 Z" fill="#4a4a4a"/>
    </svg>
  </div>

  <div class="w-[1350px] h-[720px] mx-auto my-[45px] relative z-10 flex">
    <!-- 左侧装饰区 -->
    <div class="w-48 flex flex-col items-center justify-center">
      <!-- 竹节装饰 -->
      <div class="w-px h-32 mb-6" style="background: linear-gradient(to bottom, transparent, #8b7355, transparent);"></div>
      <div class="w-3 h-1 rounded-full mb-1" style="background: #8b7355;"></div>
      <div class="w-px h-24 mb-1" style="background: #8b7355;"></div>
      <div class="w-3 h-1 rounded-full mb-1" style="background: #8b7355;"></div>
      <div class="w-px h-24 mb-1" style="background: #8b7355;"></div>
      <div class="w-3 h-1 rounded-full mb-6" style="background: #8b7355;"></div>
      <div class="w-px h-32" style="background: linear-gradient(to bottom, #8b7355, transparent);"></div>
    </div>

    <!-- 主内容区 -->
    <div class="flex-1 flex flex-col justify-center pl-8">
      <!-- 标题 -->
      <div class="mb-16">
        <div class="flex items-end gap-6">
          <span class="text-7xl font-light" style="color: #3d3d3d; font-family: 'KaiTi', 'STKaiti', serif;">目录</span>
          <div class="flex items-center gap-3 pb-3">
            <div class="w-16 h-px" style="background: #a0937d;"></div>
            <span class="text-sm tracking-widest" style="color: #a0937d;">CONTENTS</span>
          </div>
        </div>
      </div>

      <!-- 章节列表 -->
      <div class="space-y-6">
        <!-- 章节1 -->
        <div class="group cursor-pointer flex items-center">
          <div class="w-20 text-center">
            <span class="text-3xl" style="color: #c9b896; font-family: 'KaiTi', 'STKaiti', serif;">一</span>
          </div>
          <div class="flex-1 flex items-center gap-4 py-4 border-b" style="border-color: #e5e0d8;">
            <h3 class="text-2xl" style="color: #4a4036; font-family: 'KaiTi', 'STKaiti', serif;">项目背景</h3>
            <div class="flex-1 h-px opacity-0 group-hover:opacity-100 transition-opacity" style="background: linear-gradient(to right, #a0937d, transparent);"></div>
          </div>
        </div>

        <!-- 章节2 -->
        <div class="group cursor-pointer flex items-center">
          <div class="w-20 text-center">
            <span class="text-3xl" style="color: #c9b896; font-family: 'KaiTi', 'STKaiti', serif;">二</span>
          </div>
          <div class="flex-1 flex items-center gap-4 py-4 border-b" style="border-color: #e5e0d8;">
            <h3 class="text-2xl" style="color: #4a4036; font-family: 'KaiTi', 'STKaiti', serif;">核心功能</h3>
            <div class="flex-1 h-px opacity-0 group-hover:opacity-100 transition-opacity" style="background: linear-gradient(to right, #a0937d, transparent);"></div>
          </div>
        </div>

        <!-- 章节3 -->
        <div class="group cursor-pointer flex items-center">
          <div class="w-20 text-center">
            <span class="text-3xl" style="color: #c9b896; font-family: 'KaiTi', 'STKaiti', serif;">三</span>
          </div>
          <div class="flex-1 flex items-center gap-4 py-4 border-b" style="border-color: #e5e0d8;">
            <h3 class="text-2xl" style="color: #4a4036; font-family: 'KaiTi', 'STKaiti', serif;">技术架构</h3>
            <div class="flex-1 h-px opacity-0 group-hover:opacity-100 transition-opacity" style="background: linear-gradient(to right, #a0937d, transparent);"></div>
          </div>
        </div>

        <!-- 章节4 -->
        <div class="group cursor-pointer flex items-center">
          <div class="w-20 text-center">
            <span class="text-3xl" style="color: #c9b896; font-family: 'KaiTi', 'STKaiti', serif;">四</span>
          </div>
          <div class="flex-1 flex items-center gap-4 py-4 border-b" style="border-color: #e5e0d8;">
            <h3 class="text-2xl" style="color: #4a4036; font-family: 'KaiTi', 'STKaiti', serif;">实施计划</h3>
            <div class="flex-1 h-px opacity-0 group-hover:opacity-100 transition-opacity" style="background: linear-gradient(to right, #a0937d, transparent);"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧印章 -->
    <div class="w-32 flex items-start justify-center pt-20">
      <div class="w-14 h-14 flex items-center justify-center" style="border: 2px solid #a65a4c;">
        <span class="text-lg" style="color: #a65a4c; font-family: 'KaiTi', 'STKaiti', serif;">录</span>
      </div>
    </div>
  </div>
</div>
