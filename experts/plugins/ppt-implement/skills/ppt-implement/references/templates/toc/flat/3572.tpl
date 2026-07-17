<!-- 
模板ID: 3572
模板名称: 扁平风-阶梯式
适用场景: 清爽扁平风目录页
设计特点: 阶梯布局,色彩渐变,视觉层次感
-->
<div class="w-[1440px] h-[810px] bg-slate-50 relative overflow-hidden">
  <!-- 背景装饰 -->
  <div class="absolute top-0 right-0 w-96 h-96 rounded-full opacity-20" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); filter: blur(80px);"></div>
  <div class="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-15" style="background: linear-gradient(135deg, #06b6d4, #3b82f6); filter: blur(60px);"></div>
  
  <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex items-center relative z-10">
    <!-- 左侧标题区 -->
    <div class="w-80 flex-shrink-0">
      <div class="inline-block">
        <h2 class="text-6xl font-black text-slate-800 tracking-tight">目录</h2>
        <div class="mt-3 text-lg text-slate-500 font-medium">CONTENTS</div>
        <div class="mt-4 flex gap-2">
          <div class="w-12 h-1.5 rounded-full bg-indigo-500"></div>
          <div class="w-6 h-1.5 rounded-full bg-violet-500"></div>
          <div class="w-3 h-1.5 rounded-full bg-cyan-500"></div>
        </div>
      </div>
    </div>
    
    <!-- 右侧阶梯式章节 -->
    <div class="flex-1 flex flex-col gap-4">
      <!-- 第一章 -->
      <div class="flex items-stretch" style="margin-left: 0;">
        <div class="w-20 flex-shrink-0 rounded-l-2xl flex items-center justify-center" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);">
          <span class="text-3xl font-black text-white">01</span>
        </div>
        <div class="flex-1 bg-white rounded-r-2xl p-5 flex items-center shadow-lg shadow-indigo-100/50 border-l-0" style="border: 2px solid #e0e7ff; border-left: none;">
          <div>
            <div class="text-xl font-bold text-slate-800">项目背景</div>
            <div class="text-sm text-slate-500 mt-1">了解项目的起源与发展目标</div>
          </div>
        </div>
      </div>
      
      <!-- 第二章 - 稍微右移 -->
      <div class="flex items-stretch" style="margin-left: 40px;">
        <div class="w-20 flex-shrink-0 rounded-l-2xl flex items-center justify-center" style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);">
          <span class="text-3xl font-black text-white">02</span>
        </div>
        <div class="flex-1 bg-white rounded-r-2xl p-5 flex items-center shadow-lg shadow-violet-100/50 border-l-0" style="border: 2px solid #ede9fe; border-left: none;">
          <div>
            <div class="text-xl font-bold text-slate-800">核心功能</div>
            <div class="text-sm text-slate-500 mt-1">产品的主要功能与特性介绍</div>
          </div>
        </div>
      </div>
      
      <!-- 第三章 - 继续右移 -->
      <div class="flex items-stretch" style="margin-left: 80px;">
        <div class="w-20 flex-shrink-0 rounded-l-2xl flex items-center justify-center" style="background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);">
          <span class="text-3xl font-black text-white">03</span>
        </div>
        <div class="flex-1 bg-white rounded-r-2xl p-5 flex items-center shadow-lg shadow-cyan-100/50 border-l-0" style="border: 2px solid #cffafe; border-left: none;">
          <div>
            <div class="text-xl font-bold text-slate-800">技术架构</div>
            <div class="text-sm text-slate-500 mt-1">系统设计与技术选型方案</div>
          </div>
        </div>
      </div>
      
      <!-- 第四章 - 最右 -->
      <div class="flex items-stretch" style="margin-left: 120px;">
        <div class="w-20 flex-shrink-0 rounded-l-2xl flex items-center justify-center" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
          <span class="text-3xl font-black text-white">04</span>
        </div>
        <div class="flex-1 bg-white rounded-r-2xl p-5 flex items-center shadow-lg shadow-emerald-100/50 border-l-0" style="border: 2px solid #d1fae5; border-left: none;">
          <div>
            <div class="text-xl font-bold text-slate-800">实施计划</div>
            <div class="text-sm text-slate-500 mt-1">项目推进时间与里程碑</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- 右下角装饰数字 -->
  <div class="absolute bottom-10 right-16 text-9xl font-black text-slate-200 opacity-50 select-none">04</div>
</div>
