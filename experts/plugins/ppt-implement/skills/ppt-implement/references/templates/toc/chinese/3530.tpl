<!-- 
模板ID: 3530
模板名称: 中国风-折扇式
适用场景: 优雅中国风主题目录页
设计特点: 扇形意境,水墨晕染,垂直排版
-->
<div class="w-[1440px] h-[810px] relative overflow-hidden flex items-center justify-center" style="background: #fdf6e3; background-image: radial-gradient(circle at center, #fdf6e3 0%, #f5e6c8 100%);">
  <!-- 水墨背景 -->
  <div class="absolute inset-0 opacity-20 pointer-events-none">
    <svg viewBox="0 0 1440 810" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 810C300 700 600 750 1440 600V810H0Z" fill="#1a1a1a" />
      <circle cx="1200" cy="200" r="150" fill="#cc3333" opacity="0.1" />
    </svg>
  </div>
  
  <!-- 装饰边框 -->
  <div class="absolute inset-10 border-[1px] border-amber-900/10 pointer-events-none"></div>
  <div class="absolute inset-12 border-[2px] border-amber-900/5 pointer-events-none"></div>

  <!-- 主体内容 -->
  <div class="w-full h-full flex items-center justify-between px-32 relative z-10">
    
    <!-- 左侧标题 -->
    <div class="flex flex-col items-start">
      <div class="flex items-center gap-4 mb-8">
        <div class="w-1 h-24 bg-red-800"></div>
        <div>
          <h1 class="text-7xl font-serif text-gray-900 leading-tight" style="writing-mode: vertical-rl; font-family: 'STKaiti', 'KaiTi', serif;">
            目录
          </h1>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-full border-2 border-red-800 flex items-center justify-center text-red-800 text-sm font-bold">印</div>
        <div class="text-amber-900/60 font-serif tracking-[0.5em] text-lg uppercase" style="writing-mode: vertical-rl;">CONTENTS</div>
      </div>
    </div>

    <!-- 右侧扇形目录 -->
    <div class="relative w-[800px] h-[600px] flex items-end justify-center">
      
      <div class="absolute origin-bottom transition-all duration-700 hover:scale-110 group cursor-pointer" 
           style="transform: rotate(deg) translateY(-50px); bottom: 0; height: 450px;">
        
        <!-- 扇骨 -->
        <div class="absolute left-1/2 -translate-x-1/2 bottom-0 w-[2px] h-full bg-gradient-to-t from-amber-900/40 to-transparent"></div>
        
        <!-- 内容卡片 (垂直排列) -->
        <div class="relative w-16 h-80 bg-white/80 backdrop-blur-sm rounded-t-full shadow-lg border border-amber-900/10 flex flex-col items-center py-8 group-hover:bg-white transition-colors">
          <!-- 序号 (红底白字，像印章) -->
          <div class="w-8 h-8 bg-red-800 text-white flex items-center justify-center text-lg font-bold mb-4 rotate-0" style="font-family: 'STKaiti', 'KaiTi', serif;">
            1
          </div>
          
          <!-- 章节名 (垂直排版) -->
          <div class="flex-1 flex items-center justify-center overflow-hidden">
            <span class="text-xl text-gray-800 font-serif leading-none h-[200px]" style="writing-mode: vertical-rl; font-family: 'STKaiti', 'KaiTi', serif;">
              项目背景
            </span>
          </div>
          
          <!-- 底部装饰 -->
          <div class="w-1 h-8 bg-amber-900/20 mt-4"></div>
        </div>
      </div>
      
      <div class="absolute origin-bottom transition-all duration-700 hover:scale-110 group cursor-pointer" 
           style="transform: rotate(deg) translateY(-50px); bottom: 0; height: 450px;">
        
        <!-- 扇骨 -->
        <div class="absolute left-1/2 -translate-x-1/2 bottom-0 w-[2px] h-full bg-gradient-to-t from-amber-900/40 to-transparent"></div>
        
        <!-- 内容卡片 (垂直排列) -->
        <div class="relative w-16 h-80 bg-white/80 backdrop-blur-sm rounded-t-full shadow-lg border border-amber-900/10 flex flex-col items-center py-8 group-hover:bg-white transition-colors">
          <!-- 序号 (红底白字，像印章) -->
          <div class="w-8 h-8 bg-red-800 text-white flex items-center justify-center text-lg font-bold mb-4 rotate-0" style="font-family: 'STKaiti', 'KaiTi', serif;">
            2
          </div>
          
          <!-- 章节名 (垂直排版) -->
          <div class="flex-1 flex items-center justify-center overflow-hidden">
            <span class="text-xl text-gray-800 font-serif leading-none h-[200px]" style="writing-mode: vertical-rl; font-family: 'STKaiti', 'KaiTi', serif;">
              核心功能
            </span>
          </div>
          
          <!-- 底部装饰 -->
          <div class="w-1 h-8 bg-amber-900/20 mt-4"></div>
        </div>
      </div>
      
      <div class="absolute origin-bottom transition-all duration-700 hover:scale-110 group cursor-pointer" 
           style="transform: rotate(deg) translateY(-50px); bottom: 0; height: 450px;">
        
        <!-- 扇骨 -->
        <div class="absolute left-1/2 -translate-x-1/2 bottom-0 w-[2px] h-full bg-gradient-to-t from-amber-900/40 to-transparent"></div>
        
        <!-- 内容卡片 (垂直排列) -->
        <div class="relative w-16 h-80 bg-white/80 backdrop-blur-sm rounded-t-full shadow-lg border border-amber-900/10 flex flex-col items-center py-8 group-hover:bg-white transition-colors">
          <!-- 序号 (红底白字，像印章) -->
          <div class="w-8 h-8 bg-red-800 text-white flex items-center justify-center text-lg font-bold mb-4 rotate-0" style="font-family: 'STKaiti', 'KaiTi', serif;">
            3
          </div>
          
          <!-- 章节名 (垂直排版) -->
          <div class="flex-1 flex items-center justify-center overflow-hidden">
            <span class="text-xl text-gray-800 font-serif leading-none h-[200px]" style="writing-mode: vertical-rl; font-family: 'STKaiti', 'KaiTi', serif;">
              技术架构
            </span>
          </div>
          
          <!-- 底部装饰 -->
          <div class="w-1 h-8 bg-amber-900/20 mt-4"></div>
        </div>
      </div>
      
      <div class="absolute origin-bottom transition-all duration-700 hover:scale-110 group cursor-pointer" 
           style="transform: rotate(deg) translateY(-50px); bottom: 0; height: 450px;">
        
        <!-- 扇骨 -->
        <div class="absolute left-1/2 -translate-x-1/2 bottom-0 w-[2px] h-full bg-gradient-to-t from-amber-900/40 to-transparent"></div>
        
        <!-- 内容卡片 (垂直排列) -->
        <div class="relative w-16 h-80 bg-white/80 backdrop-blur-sm rounded-t-full shadow-lg border border-amber-900/10 flex flex-col items-center py-8 group-hover:bg-white transition-colors">
          <!-- 序号 (红底白字，像印章) -->
          <div class="w-8 h-8 bg-red-800 text-white flex items-center justify-center text-lg font-bold mb-4 rotate-0" style="font-family: 'STKaiti', 'KaiTi', serif;">
            4
          </div>
          
          <!-- 章节名 (垂直排版) -->
          <div class="flex-1 flex items-center justify-center overflow-hidden">
            <span class="text-xl text-gray-800 font-serif leading-none h-[200px]" style="writing-mode: vertical-rl; font-family: 'STKaiti', 'KaiTi', serif;">
              实施计划
            </span>
          </div>
          
          <!-- 底部装饰 -->
          <div class="w-1 h-8 bg-amber-900/20 mt-4"></div>
        </div>
      </div>
      
      
      <!-- 扇轴心 -->
      <div class="absolute bottom-[-20px] w-12 h-12 bg-amber-950 rounded-full shadow-2xl z-20 flex items-center justify-center">
        <div class="w-4 h-4 rounded-full bg-red-800 animate-pulse"></div>
      </div>
    </div>

  </div>

  <!-- 随机墨点装饰 -->
  <div class="absolute top-20 right-40 w-12 h-12 bg-black opacity-5 rounded-full blur-xl"></div>
  <div class="absolute bottom-40 left-60 w-24 h-24 bg-black opacity-5 rounded-full blur-2xl"></div>
</div>
